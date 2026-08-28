/**
 * Local access follows the device's trust grant (T070, US3, FR-009, FR-024).
 *
 * Two properties, and the second is the one that would be easy to get wrong in
 * a way nobody notices until someone loses work:
 *
 *   1. a device the server no longer trusts cannot read its own sealed copy;
 *   2. **a device asked to sign in again loses nothing.** Its queued offline
 *      mutations are precisely the edits the server has never seen, so
 *      treating the interruption as a fresh start would destroy the only copy
 *      that exists.
 */

import {
  applyTrustGrant,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalRecordCodec,
  localIdentityDrift,
  MemorySecureStorage,
  openLocalDatabase,
  snapshotLocalIdentities,
  trustPermitsLocalAccess,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const installationId = "018f2b7c-0000-7000-8000-000000000001";
const workspaceId = generateUuidV7();

let db: LocalDatabase;
let keys: LocalKeyManager;
let codec: LocalRecordCodec;

beforeEach(async () => {
  db = openLocalDatabase(`device-trust-${generateUuidV7()}`);
  keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  codec = new LocalRecordCodec(new LocalCipher(keys), { installationId, workspaceId });
});

afterEach(() => {
  db.close();
});

/** Seeds a projection, a queued mutation, and a conflict. */
async function seedLocalWork(): Promise<void> {
  const itemId = generateUuidV7();
  await db.items.put(
    (await codec.sealItem({
      id: itemId,
      kind: "page",
      name: "Offline draft",
      icon: null,
      lifecycle: "active",
      currentRevisionId: generateUuidV7(),
      trashedAt: null,
      purgeAfter: null,
      favourite: false,
      offlineIntent: false,
      localAvailability: "present",
      pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      file: null,
    })) as never,
  );
  await db.outbox.put(
    (await codec.sealOutbox({
      mutationId: generateUuidV7(),
      commandType: "page.update",
      payload: { text: "written on a plane" },
      baseRevisionIds: [],
      localRevisionIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      enqueueOrder: 1,
    })) as never,
  );
  await db.revisionHeaders.put({
    id: generateUuidV7(),
    itemId: itemId as Uuid,
    mutationId: generateUuidV7(),
    parentRevisionIds: [],
    acceptedAt: new Date().toISOString(),
    local: 1,
  });
}

describe("which grants permit local access", () => {
  it("permits an active device and nothing else", () => {
    expect(trustPermitsLocalAccess("active")).toBe(true);
    expect(trustPermitsLocalAccess("pending")).toBe(false);
    expect(trustPermitsLocalAccess("reauthorization-required")).toBe(false);
    expect(trustPermitsLocalAccess("revoked")).toBe(false);
  });

  it("locks the store when trust is withdrawn", async () => {
    const outcome = await applyTrustGrant(keys, "revoked");
    expect(outcome.access).toBe("locked");
    expect(outcome.reason).toBe("revoked");
    expect(keys.state.status).toBe("locked");
  });

  it("says why, so the client can tell the owner something true", async () => {
    // "Revoked" and "not confirmed yet" are different situations. One message
    // for both would be wrong for at least one of them.
    expect((await applyTrustGrant(keys, "pending")).reason).toBe("pending");
    expect((await applyTrustGrant(keys, "reauthorization-required")).reason).toBe(
      "reauthorization-required",
    );
  });

  it("unlocks again when trust returns", async () => {
    await applyTrustGrant(keys, "reauthorization-required");
    const outcome = await applyTrustGrant(keys, "active");
    expect(outcome.access).toBe("unlocked");
    expect(outcome.keyState.status).toBe("unlocked");
  });
});

describe("a locked store is not an erased one", () => {
  it("cannot be read while locked, and reads the same afterwards", async () => {
    await seedLocalWork();
    const sealed = (await db.items.toArray())[0] as never;
    const before = await codec.openItem(sealed);

    await applyTrustGrant(keys, "reauthorization-required");
    await expect(codec.openItem(sealed)).rejects.toThrow();

    await applyTrustGrant(keys, "active");
    expect(await codec.openItem(sealed)).toEqual(before);
  });

  it("keeps every identity across a reauthorization", async () => {
    // The property worth protecting. Clearing the store and re-downloading
    // would leave the counts plausible and the queued offline edits gone.
    await seedLocalWork();
    const before = await snapshotLocalIdentities(db);

    await applyTrustGrant(keys, "reauthorization-required");
    await applyTrustGrant(keys, "active");

    const after = await snapshotLocalIdentities(db);
    expect(localIdentityDrift(before, after)).toEqual([]);
  });

  it("reports the outbox when it does drift", async () => {
    // The guard has to be able to fail, or it proves nothing.
    await seedLocalWork();
    const before = await snapshotLocalIdentities(db);
    await db.outbox.clear();

    const after = await snapshotLocalIdentities(db);
    expect(localIdentityDrift(before, after)).toContain("outbox");
  });

  it("survives being locked while there is unsent work", async () => {
    // The case this exists for: edits made offline, then the owner asks the
    // device to sign in again before it ever reached the server.
    await seedLocalWork();
    const queued = await db.outbox.count();
    expect(queued).toBeGreaterThan(0);

    await applyTrustGrant(keys, "reauthorization-required");
    expect(await db.outbox.count()).toBe(queued);

    await applyTrustGrant(keys, "active");
    const restored = (await db.outbox.toArray())[0] as never;
    expect(
      ((await codec.openOutbox(restored)) as { payload: Record<string, unknown> }).payload,
    ).toEqual({ text: "written on a plane" });
  });
});
