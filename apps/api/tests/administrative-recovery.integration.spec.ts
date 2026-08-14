/**
 * Administrative recovery (T082, T078, US6, FR-001, FR-019, FR-020, FR-024, SC-005).
 *
 * The dangerous failure of a restore is not that it does not work. It is that
 * it works — on top of an installation that already held someone's notes.
 *
 * So the refusals are tested before the success, and there are more of them.
 * An import that overwrote a live workspace would be indistinguishable, to the
 * person who ran it, from a successful restore: the machine would come up, the
 * command would report what it adopted, and the data it replaced would be gone
 * with no error anywhere.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  readTargetOccupancy,
  schema,
  targetIsEmpty,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { createRecoveryKit, type RecoveryKit } from "@myownnotion/domain/security";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdministrativeRecoveryError,
  AdministrativeRecoveryService,
} from "../src/security/administrative-recovery-service.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const SOURCE_INSTALLATION = "018f2b7c-0000-7000-8000-0000000000c1";
const SOURCE_LINEAGE = "018f2b7c-0000-7000-8000-0000000000c2";
const KEY = Buffer.from(randomBytes(32));
const ROOT_KEY = new Uint8Array(randomBytes(32));

const key = { available: true, bytes: KEY };

function service(): AdministrativeRecoveryService {
  return new AdministrativeRecoveryService({
    db: handle.db,
    deploymentKey: () => (key.available ? key.bytes : null),
    now: () => new Date(),
  });
}

/** A kit as the source installation would have issued it. */
function makeKit(overrides: Partial<Parameters<typeof createRecoveryKit>[0]> = {}): RecoveryKit {
  return createRecoveryKit({
    installationId: SOURCE_INSTALLATION,
    sourceLineageId: SOURCE_LINEAGE,
    kitId: randomUUID(),
    recoveryEpoch: 3,
    secret: { kind: "deployment-key", deploymentKey: new Uint8Array(KEY) },
    payload: ROOT_KEY,
    supportedKeyGenerations: [1, 2],
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    downloadExpiresAt: new Date("2026-05-01T00:15:00.000Z"),
    ...overrides,
  });
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  key.available = true;
  key.bytes = KEY;
  await handle.db.execute(sql`
    TRUNCATE protected_envelopes, page_documents, placements, revision_parents,
      revisions, mutations, items, authorized_devices, passkey_credentials,
      password_credential_versions, data_key_generations, workspace_root_keys,
      wrapping_key_versions, recovery_kits, recovery_epochs, owners, installations,
      workspaces CASCADE
  `);
});

/** Makes the target look like a live installation with content in it. */
async function seedOccupiedTarget(): Promise<void> {
  const workspaceId = generateUuidV7();
  const installationId = generateUuidV7();
  await handle.db.insert(schema.workspaces).values({ id: workspaceId, schemaVersion: 1 });
  await createInstallation(handle.db, {
    id: installationId,
    sourceLineageId: installationId,
    schemaVersion: 1,
  });
  const mutationId = generateUuidV7();
  const revisionId = generateUuidV7();
  const itemId = generateUuidV7();
  await handle.db.insert(schema.mutations).values({
    id: mutationId,
    workspaceId,
    commandType: "create-item",
    status: "accepted",
    resultRevisionIds: [revisionId],
  });
  await handle.db.transaction(async (tx) => {
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
    await tx.insert(schema.items).values({
      id: itemId,
      workspaceId,
      kind: "page",
      name: "Somebody else's note",
      currentRevisionId: revisionId,
    });
    await tx.insert(schema.revisions).values({
      id: revisionId,
      itemId,
      mutationId,
      lineageDigest: "existing",
    });
  });
}

describe("what an import refuses", () => {
  it("refuses a target that already holds notes", async () => {
    await seedOccupiedTarget();

    await expect(service().import(makeKit())).rejects.toThrow(/not empty/i);
  });

  it("leaves the occupied target exactly as it found it", async () => {
    await seedOccupiedTarget();
    const before = await handle.db.select().from(schema.items);

    await service()
      .import(makeKit())
      .catch(() => undefined);

    // The refusal is only worth anything if it happens before any write. An
    // import that refused after adopting a lineage would leave a machine
    // claiming to be an installation it cannot read.
    const after = await handle.db.select().from(schema.items);
    expect(after).toEqual(before);
    expect(await handle.db.select().from(schema.workspaceRootKeys)).toHaveLength(0);
  });

  it("refuses a kit sealed under a different deployment key", async () => {
    const foreign = createRecoveryKit({
      installationId: SOURCE_INSTALLATION,
      sourceLineageId: SOURCE_LINEAGE,
      kitId: randomUUID(),
      recoveryEpoch: 1,
      secret: { kind: "deployment-key", deploymentKey: new Uint8Array(32).fill(9) },
      payload: ROOT_KEY,
      supportedKeyGenerations: [1],
      createdAt: new Date(),
      downloadExpiresAt: new Date(Date.now() + 60_000),
    });

    // The kit belongs to another installation, or the wrong key is mounted.
    // The message says both, because from here they are indistinguishable and
    // the operator can tell them apart.
    await expect(service().import(foreign)).rejects.toThrow(/does not open/i);
  });

  it("refuses when no deployment key is mounted", async () => {
    key.available = false;
    await expect(service().import(makeKit())).rejects.toThrow(/no deployment key/i);
  });

  it("reports every blocker at once rather than the first", async () => {
    await seedOccupiedTarget();
    key.bytes = Buffer.from(randomBytes(32));

    const report = await service().inspect(makeKit());

    // An operator in front of a restored machine at three in the morning
    // should learn everything that is wrong in one command.
    expect(report.blockers.length).toBeGreaterThan(1);
    expect(report.blockers.join(" ")).toMatch(/does not open/i);
    expect(report.blockers.join(" ")).toMatch(/not empty/i);
  });
});

describe("inspecting changes nothing", () => {
  it("reports on an occupied target without touching it", async () => {
    await seedOccupiedTarget();
    const before = await readTargetOccupancy(handle.db);

    const report = await service().inspect(makeKit());

    expect(report.targetEmpty).toBe(false);
    expect(await readTargetOccupancy(handle.db)).toEqual(before);
  });

  it("opens a superseded kit, because that is the question an operator has", async () => {
    // Deliberately permitted. Refusing would leave an operator unable to find
    // out whether an old kit is the one that matches their data.
    // Both halves of the pair: `superseded/prepared` is not one of the seven
    // legal combinations, and a fixture in an impossible state would be
    // testing something the application cannot produce.
    const superseded = {
      ...makeKit(),
      authorizationState: "superseded" as const,
      deliveryState: "confirmed" as const,
    };
    const report = await service().inspect(superseded);
    expect(report.kitOpens).toBe(true);
  });
});

describe("what an import adopts", () => {
  it("takes the source's identity verbatim", async () => {
    const result = await service().import(makeKit());

    // Regenerating any of these produces a machine holding the same notes and
    // denying it is the same installation — and feature-001's canonical
    // identity would stop matching the data it describes.
    expect(result.installationId).toBe(SOURCE_INSTALLATION);
    expect(result.sourceLineageId).toBe(SOURCE_LINEAGE);

    const installations = await handle.db.select().from(schema.installations);
    expect(installations).toHaveLength(1);
    expect(installations[0]?.id).toBe(SOURCE_INSTALLATION);
    expect(installations[0]?.sourceLineageId).toBe(SOURCE_LINEAGE);
    expect(installations[0]?.state).toBe("ready");
  });

  it("installs a root key the hierarchy can open", async () => {
    const result = await service().import(makeKit());

    // The whole point: after the import, the ordinary read path reaches the
    // same root key the source used, so restored records open.
    const hierarchy = new KeyHierarchy({
      db: handle.db,
      installationId: result.installationId,
      workspaceId: result.workspaceId,
      deploymentKey: () => KEY,
      now: () => new Date(),
    });
    expect(await hierarchy.exportRecoveryMaterial(handle.db)).toEqual(ROOT_KEY);
  });

  it("produces an installation that can seal and open a record", async () => {
    const result = await service().import(makeKit());
    const hierarchy = new KeyHierarchy({
      db: handle.db,
      installationId: result.installationId,
      workspaceId: result.workspaceId,
      deploymentKey: () => KEY,
      now: () => new Date(),
    });
    const records = new ProtectedRecordService({
      db: handle.db,
      keys: hierarchy,
      installationId: result.installationId,
      workspaceId: result.workspaceId,
      now: () => new Date(),
    });

    const entityId = generateUuidV7();
    await handle.db.transaction(async (tx) => {
      await records.write(tx, {
        entityType: "item",
        entityId,
        recordVersion: 1,
        payload: new Uint8Array(Buffer.from("written after the restore", "utf8")),
      });
    });

    const opened = await records.read(handle.db, { entityType: "item", entityId });
    expect(Buffer.from(opened ?? new Uint8Array()).toString("utf8")).toBe(
      "written after the restore",
    );
  });

  it("trusts no device from the source", async () => {
    const result = await service().import(makeKit());

    // A restore usually happens because something went wrong. Re-authorizing a
    // device costs a minute; the alternative is silently trusting hardware
    // nobody has looked at since.
    const devices = await handle.db.select().from(schema.authorizedDevices);
    expect(devices.filter((row) => row.state === "active")).toHaveLength(0);
    expect(result.devicesRevoked).toBe(0);
  });

  it("reports that the target was empty before it started", async () => {
    const result = await service().import(makeKit());
    // Evidence, not decoration: an operator asked to certify a restore needs
    // to be able to say what the machine held beforehand.
    expect(targetIsEmpty(result.occupancyBefore)).toBe(true);
  });
});

describe("importing twice", () => {
  it("refuses the second time, because the target is no longer empty", async () => {
    await service().import(makeKit());

    // The same rule that protects a live installation protects a restored one
    // from being restored over.
    await expect(service().import(makeKit())).rejects.toThrow(AdministrativeRecoveryError);
  });
});
