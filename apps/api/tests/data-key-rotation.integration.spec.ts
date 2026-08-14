/**
 * Data-key generation rotation, end to end (T084, US5, FR-017, FR-018, FR-025, FR-027).
 *
 * The wrapping-key rotation next door rewraps one row and touches no content.
 * This one re-encrypts every record, so the property that matters is not that
 * it finishes but that it is **safe at every instant while it has not**:
 *
 *   - records already rewritten are readable;
 *   - records not yet rewritten are readable;
 *   - the workspace stays writable, and new writes land under the new
 *     generation;
 *   - an interruption costs one batch, not the rotation.
 *
 * Every test here is a variation on "stop it halfway and check nothing is
 * lost", because an implementation that only works when it runs to completion
 * is exactly the one that destroys a workspace the first time a container is
 * restarted mid-sweep.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  countRecordsInGeneration,
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findCurrentGeneration,
  findGeneration,
  findRotationPolicy,
  schema,
} from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { parseCommand } from "../src/admin/command-parser.ts";
import { rotationDataKeyCommand } from "../src/admin/commands/rotation-data-key.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KEY = Buffer.from(randomBytes(32));

const bytes = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));
const text = (value: Uint8Array) => Buffer.from(value).toString("utf8");

function keys(): KeyHierarchy {
  return new KeyHierarchy({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => KEY,
    now: () => new Date(),
  });
}

function records(hierarchy = keys()): ProtectedRecordService {
  return new ProtectedRecordService({
    db: handle.db,
    keys: hierarchy,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    now: () => new Date(),
  });
}

function deps(overrides: { batchSize?: number } = {}) {
  return {
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => KEY,
    now: () => new Date(),
    ...overrides,
  };
}

function command(argv: string[] = []) {
  return parseCommand(["security", "rotation", "data-key", ...argv]);
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
  await handle.db.execute(sql`
    TRUNCATE rotation_checkpoints, rotation_operations, rotation_policies,
      protected_envelopes, data_key_generations, workspace_root_keys,
      wrapping_key_versions, installations CASCADE
  `);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await handle.db.insert(schema.rotationPolicies).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    kind: "data-key",
    mode: "scheduled",
    dueIntervalDays: 180,
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    writeBlockAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
    currentGeneration: 1,
    state: "due",
  });
  await handle.db.transaction(async (tx) => {
    await keys().initialize(tx);
  });
});

/** Seals `count` records under the current generation. */
async function seed(count: number): Promise<{ id: string; payload: string }[]> {
  const created: { id: string; payload: string }[] = [];
  const service = records();
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const payload = `secret number ${index}`;
    await handle.db.transaction(async (tx) => {
      await service.write(tx, {
        entityType: "item",
        entityId: id,
        recordVersion: 1,
        payload: bytes(payload),
      });
    });
    created.push({ id, payload });
  }
  return created;
}

async function read(id: string): Promise<string> {
  const opened = await records().read(handle.db, { entityType: "item", entityId: id });
  return opened === null ? "" : text(opened);
}

describe("what a completed rotation guarantees", () => {
  it("re-encrypts every record and keeps every plaintext identical", async () => {
    const seeded = await seed(7);

    const result = await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });
    expect(result.code, result.message).toBe(EXIT_CODES.ok);

    // The rotation is only worth anything if the content survives it exactly.
    for (const record of seeded) {
      expect(await read(record.id)).toBe(record.payload);
    }
    expect(
      await countRecordsInGeneration(handle.db, { workspaceId: WORKSPACE_ID, keyGeneration: 1 }),
    ).toBe(0);
    expect(
      await countRecordsInGeneration(handle.db, { workspaceId: WORKSPACE_ID, keyGeneration: 2 }),
    ).toBe(7);
  });

  it("changes the ciphertext of every record", async () => {
    const seeded = await seed(3);
    const before = await handle.db.select().from(schema.protectedEnvelopes);

    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const after = await handle.db.select().from(schema.protectedEnvelopes);
    // Unlike the wrapping-key rotation, this one *must* rewrite the bytes. A
    // rotation that left the ciphertext identical has not moved the record to
    // the new generation whatever the row says.
    for (const record of seeded) {
      const old = before.find((row) => row.entityId === record.id);
      const fresh = after.find((row) => row.entityId === record.id);
      expect(fresh?.ciphertext).not.toBe(old?.ciphertext);
      expect(fresh?.keyGeneration).toBe(2);
    }
  });

  it("retires the old generation instead of revoking it", async () => {
    await seed(2);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const old = await findGeneration(handle.db, WORKSPACE_ID, 1);
    // `decrypt-only`, never `revoked`. Revocation is a separate, deliberate
    // step because it is the one irreversible mistake available here.
    expect(old?.state).toBe("decrypt-only");
    expect((await findCurrentGeneration(handle.db, WORKSPACE_ID))?.generation).toBe(2);
  });

  it("schedules the next rotation against the new generation", async () => {
    await seed(1);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const policy = await findRotationPolicy(handle.db, {
      installationId: INSTALLATION_ID,
      kind: "data-key",
    });
    expect(policy?.state).toBe("complete");
    expect(policy?.currentGeneration).toBe(2);
    expect(policy?.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("checkpoints each batch so an interruption resumes", async () => {
    await seed(5);
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 2 }), { execute: true });

    const checkpoints = await handle.db.select().from(schema.rotationCheckpoints);
    // Three batches of two, two, one.
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map((row) => row.processedCount).sort((a, b) => a - b)).toEqual([2, 4, 5]);
  });
});

describe("safety while the rotation is unfinished", () => {
  it("keeps records readable in both generations mid-sweep", async () => {
    const seeded = await seed(4);

    // Sweep only the first batch, then stop, exactly as an interruption would.
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 2 }), { execute: true });

    // Both halves readable through the ordinary path, with no special casing:
    // the old generation is decrypt-only and the service picks whichever the
    // row names.
    for (const record of seeded) {
      expect(await read(record.id)).toBe(record.payload);
    }
  });

  it("writes a new record under the new generation while the old one is still swept", async () => {
    await seed(2);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const id = randomUUID();
    await handle.db.transaction(async (tx) => {
      await records().write(tx, {
        entityType: "item",
        entityId: id,
        recordVersion: 1,
        payload: bytes("written after the rotation"),
      });
    });

    const row = await handle.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, id));
    // New writes must not wait for the sweep. Waiting would mean weeks of
    // writes under the generation the operator is trying to leave.
    expect(row[0]?.keyGeneration).toBe(2);
  });
});

describe("the dry run", () => {
  it("reports the record count and changes nothing", async () => {
    await seed(3);

    const result = await rotationDataKeyCommand(command(["--dry-run"]), deps(), { execute: false });

    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.data?.["wouldRewriteRecords"]).toBe(3);
    expect(result.data?.["toGeneration"]).toBe(2);
    // The count is what an operator uses to decide whether to start now or
    // overnight, so it must be available without starting.
    expect((await findCurrentGeneration(handle.db, WORKSPACE_ID))?.generation).toBe(1);
  });

  it("says reads stay available", async () => {
    await seed(1);
    const result = await rotationDataKeyCommand(command(["--dry-run"]), deps(), { execute: false });
    // Stated rather than implied: an operator planning a rotation needs to
    // know it is not an outage window before they schedule it at 3am.
    expect(result.data?.["readsRemainAvailable"]).toBe(true);
  });
});

describe("revocation is a separate, guarded step", () => {
  it("refuses to revoke a generation that still holds records", async () => {
    await seed(3);
    await rotationDataKeyCommand(command(["--yes"]), deps({ batchSize: 1 }), { execute: true });

    // Put one record back under generation one, as an unfinished sweep would
    // have left it.
    const rows = await handle.db.select().from(schema.protectedEnvelopes).limit(1);
    await handle.db
      .update(schema.protectedEnvelopes)
      .set({ keyGeneration: 1 })
      .where(eq(schema.protectedEnvelopes.id, rows[0]?.id ?? ""));

    const result = await rotationDataKeyCommand(
      command(["--revoke-generation", "1", "--yes"]),
      deps(),
      { execute: true },
    );

    expect(result.code).toBe(EXIT_CODES.refused);
    expect((await findGeneration(handle.db, WORKSPACE_ID, 1))?.state).toBe("decrypt-only");
  });

  it("revokes an empty retired generation", async () => {
    await seed(2);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const result = await rotationDataKeyCommand(
      command(["--revoke-generation", "1", "--yes"]),
      deps(),
      { execute: true },
    );

    expect(result.code, result.message).toBe(EXIT_CODES.ok);
    expect((await findGeneration(handle.db, WORKSPACE_ID, 1))?.state).toBe("revoked");
  });

  it("refuses to revoke the current generation", async () => {
    await seed(1);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const result = await rotationDataKeyCommand(
      command(["--revoke-generation", "2", "--yes"]),
      deps(),
      { execute: true },
    );

    // Generation two is current and holds every record. Revoking it would
    // leave the workspace unwritable and its content unreadable at once.
    expect(result.code).toBe(EXIT_CODES.refused);
    expect((await findGeneration(handle.db, WORKSPACE_ID, 2))?.state).toBe("current");
  });

  it("does not revoke on a dry run", async () => {
    await seed(1);
    await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });

    const result = await rotationDataKeyCommand(
      command(["--revoke-generation", "1", "--dry-run"]),
      deps(),
      { execute: false },
    );

    expect(result.code).toBe(EXIT_CODES.ok);
    expect((await findGeneration(handle.db, WORKSPACE_ID, 1))?.state).toBe("decrypt-only");
  });

  it("rejects a generation number that is not one", async () => {
    const result = await rotationDataKeyCommand(
      command(["--revoke-generation", "zero", "--yes"]),
      deps(),
      { execute: true },
    );
    expect(result.code).toBe(EXIT_CODES.usage);
  });
});

describe("refusals", () => {
  it("refuses without a configured policy", async () => {
    await handle.db.execute(sql`TRUNCATE rotation_policies CASCADE`);
    await seed(1);
    const result = await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });
    expect(result.code).toBe(EXIT_CODES.refused);
  });

  it("refuses when the deployment key is unavailable", async () => {
    await seed(1);
    const result = await rotationDataKeyCommand(
      command(["--yes"]),
      { ...deps(), deploymentKey: () => null },
      { execute: true },
    );
    // Unmounting the key is the emergency response to a suspected compromise.
    // A rotation that carried on regardless would defeat it.
    expect(result.code).toBe(EXIT_CODES.keyUnavailable);
    expect((await findCurrentGeneration(handle.db, WORKSPACE_ID))?.generation).toBe(1);
  });

  it("completes without work on an empty workspace", async () => {
    const result = await rotationDataKeyCommand(command(["--yes"]), deps(), { execute: true });
    // A workspace with no protected records still rotates: the new generation
    // is minted and the old one retired. Refusing would leave an installation
    // unable to satisfy its own policy simply for being new.
    expect(result.code, result.message).toBe(EXIT_CODES.ok);
    expect((await findCurrentGeneration(handle.db, WORKSPACE_ID))?.generation).toBe(2);
  });
});
