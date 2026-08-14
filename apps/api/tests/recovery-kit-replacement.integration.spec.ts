/**
 * Replacing a recovery kit on a live installation (T081, US5, FR-016, FR-018).
 *
 * The property this file exists for is the one an owner never sees working:
 *
 * **At no point during a replacement is the installation without a usable kit.**
 *
 * Replacing a kit is done by someone who is already worried — they think the
 * old kit was seen, or they are moving house. An implementation that retired
 * the old kit when the new one was prepared would create a window with no kit
 * at all, opened by the very operation meant to improve their position. Nobody
 * would notice until a disk failed during that window, and then it would be
 * the only thing that mattered.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findActiveKit,
  findPendingKit,
  schema,
} from "@myownnotion/database";
import { openRecoveryKit } from "@myownnotion/domain/security";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEPLOYMENT_KEY_NOTICE,
  RecoveryKitError,
  RecoveryKitService,
} from "../src/security/recovery-kit-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KEY = Buffer.from(randomBytes(32));
const PAYLOAD = new Uint8Array(Buffer.from("the workspace root key would go here", "utf8"));

const key = { available: true };

function service(): RecoveryKitService {
  return new RecoveryKitService({
    db: handle.db,
    installationId: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => (key.available ? KEY : null),
    supportedKeyGenerations: async () => [1],
    recoveryPayload: async () => PAYLOAD,
    now: () => new Date(),
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
  await handle.db.execute(sql`TRUNCATE recovery_kits, recovery_epochs, installations CASCADE`);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

/** An installation that already has a confirmed kit, as a live one does. */
async function seedActiveKit(): Promise<string> {
  const kitId = randomUUID();
  const now = new Date();
  await handle.db.insert(schema.recoveryEpochs).values({
    id: randomUUID(),
    installationId: INSTALLATION_ID,
    epoch: 1,
    state: "active",
  });
  await handle.db.insert(schema.recoveryKits).values({
    id: kitId,
    installationId: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    recoveryEpoch: 1,
    authorizationState: "active",
    deliveryState: "confirmed",
    supportedKeyGenerations: [1],
    artifactDigest: "seeded",
    confirmedAt: now,
  });
  return kitId;
}

/** Prepares, downloads, and confirms a replacement. */
async function replace(driver: RecoveryKitService): Promise<string> {
  const prepared = await driver.prepareReplacement();
  await driver.download(prepared.kitId);
  await driver.confirm(prepared.kitId);
  return prepared.kitId;
}

describe("the window that must not exist", () => {
  it("keeps the old kit usable while a replacement is only prepared", async () => {
    const original = await seedActiveKit();
    const driver = service();

    await driver.prepareReplacement();

    // The property this file exists for. An owner interrupted here must still
    // be able to recover with the kit in their safe.
    expect((await findActiveKit(handle.db, INSTALLATION_ID))?.id).toBe(original);
  });

  it("keeps the old kit usable after the replacement is downloaded", async () => {
    const original = await seedActiveKit();
    const driver = service();

    const prepared = await driver.prepareReplacement();
    await driver.download(prepared.kitId);

    // Downloaded is not stored. Until the owner says they have it, the file
    // could be in a browser's downloads folder on a laptop they are about to
    // lose.
    expect((await findActiveKit(handle.db, INSTALLATION_ID))?.id).toBe(original);
  });

  it("retires the old kit only once the new one is confirmed", async () => {
    const original = await seedActiveKit();
    const driver = service();

    const replacement = await replace(driver);

    const active = await findActiveKit(handle.db, INSTALLATION_ID);
    expect(active?.id).toBe(replacement);
    expect(active?.id).not.toBe(original);
  });

  it("never leaves two active kits", async () => {
    await seedActiveKit();
    const driver = service();
    await replace(driver);

    // The partial unique index permits one, and the confirmation orders its
    // statements so the database never has to refuse.
    const rows = await handle.db
      .select()
      .from(schema.recoveryKits)
      .where(sql`authorization_state = 'active'`);
    expect(rows).toHaveLength(1);
  });
});

describe("the one-time download", () => {
  it("hands the artifact over once", async () => {
    await seedActiveKit();
    const driver = service();
    const prepared = await driver.prepareReplacement();

    const artifact = await driver.download(prepared.kitId);
    expect(artifact.kitId).toBe(prepared.kitId);

    await expect(driver.download(prepared.kitId)).rejects.toThrow(RecoveryKitError);
  });

  it("refuses confirmation of a kit that was never downloaded", async () => {
    await seedActiveKit();
    const driver = service();
    const prepared = await driver.prepareReplacement();

    // An owner cannot have stored a file they never received. This is the one
    // check between "I clicked the button" and an installation whose only kit
    // is a file nobody has.
    await expect(driver.confirm(prepared.kitId)).rejects.toThrow(/not been downloaded/);
  });

  it("rejects an earlier unfinished attempt when a new one is prepared", async () => {
    await seedActiveKit();
    const driver = service();
    const abandoned = await driver.prepareReplacement();

    const fresh = await driver.prepareReplacement();

    // Two downloadable kits would mean two one-time downloads and no way to
    // tell which one the owner kept.
    expect((await findPendingKit(handle.db, INSTALLATION_ID))?.id).toBe(fresh.kitId);
    await expect(driver.download(abandoned.kitId)).rejects.toThrow(RecoveryKitError);
  });
});

describe("what the kit needs to be opened", () => {
  it("opens under the deployment key and nothing else", async () => {
    await seedActiveKit();
    const driver = service();
    const prepared = await driver.prepareReplacement();
    const artifact = await driver.download(prepared.kitId);
    await driver.confirm(prepared.kitId);

    expect(
      openRecoveryKit(
        { ...artifact, authorizationState: "active", deliveryState: "confirmed" },
        { kind: "deployment-key", deploymentKey: new Uint8Array(KEY) },
      ),
    ).toEqual(PAYLOAD);

    await expect(async () =>
      openRecoveryKit(
        { ...artifact, authorizationState: "active", deliveryState: "confirmed" },
        { kind: "deployment-key", deploymentKey: new Uint8Array(32).fill(3) },
      ),
    ).rejects.toThrow();
  });

  it("says so in every response", async () => {
    await seedActiveKit();
    const driver = service();

    // A kit that appears self-sufficient and is not is worse than no kit: the
    // owner stores it carefully, deletes the key with the old machine, and
    // finds the gap at the only moment it cannot be fixed.
    expect((await driver.status()).notice).toBe(DEPLOYMENT_KEY_NOTICE);
    const prepared = await driver.prepareReplacement();
    expect(prepared.notice).toBe(DEPLOYMENT_KEY_NOTICE);
    await driver.download(prepared.kitId);
    expect((await driver.confirm(prepared.kitId)).notice).toBe(DEPLOYMENT_KEY_NOTICE);
  });

  it("refuses to prepare a kit while the key is unmounted", async () => {
    await seedActiveKit();
    key.available = false;
    // Unmounting the key is the emergency response to a suspected compromise.
    // Sealing a kit under a key nobody can read would produce a file that
    // recovers nothing, and would look like it worked.
    await expect(service().prepareReplacement()).rejects.toThrow(/deployment key is unavailable/);
  });

  it("does not store the artifact in the database", async () => {
    await seedActiveKit();
    const driver = service();
    const prepared = await driver.prepareReplacement();
    const artifact = await driver.download(prepared.kitId);

    // The ciphertext is what an attacker with database access most wants.
    // Persisting it would put it exactly there.
    const rows = await handle.db.select().from(schema.recoveryKits);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(artifact.encryption.ciphertext);
    expect(serialized).not.toContain(KEY.toString("base64"));
  });
});

describe("the epoch", () => {
  it("does not move until confirmation", async () => {
    await seedActiveKit();
    const driver = service();
    await driver.prepareReplacement();

    // A kit's ciphertext is bound to its epoch. Advancing early would
    // invalidate the kit the owner still holds, mid-operation.
    const rows = await handle.db.select().from(schema.recoveryEpochs).where(sql`state = 'active'`);
    expect(rows[0]?.epoch).toBe(1);
  });

  it("advances with the confirmation", async () => {
    await seedActiveKit();
    await replace(service());

    const rows = await handle.db.select().from(schema.recoveryEpochs).where(sql`state = 'active'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.epoch).toBe(2);
  });
});

describe("revoking without replacing", () => {
  it("leaves no usable kit, deliberately", async () => {
    await seedActiveKit();
    const driver = service();

    const { revocationCode } = await driver.revoke();

    // An owner who believes their kit has been seen needs to say so now.
    // Making them wait for a replacement would leave the compromised kit valid
    // throughout, which is the opposite of what they asked for.
    expect(revocationCode.length).toBeGreaterThan(0);
    expect(await findActiveKit(handle.db, INSTALLATION_ID)).toBeNull();
  });

  it("refuses when there is nothing to revoke", async () => {
    await expect(service().revoke()).rejects.toThrow(/no active recovery kit/);
  });
});
