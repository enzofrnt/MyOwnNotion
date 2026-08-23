import {
  activatePageOperationState,
  appendAcceptedPageOperationUpdate,
  insertInitializingPageOperationState,
  insertPageOperationCheckpoint,
  lockPageOperationState,
  readPageOperationState,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001" as Uuid;
const OWNER_ID = "018f2b7c-0000-7000-8000-000000000002" as Uuid;
const DEVICE_ID = "018f2b7c-0000-7000-8000-000000000003" as Uuid;
const NOW = new Date("2026-08-21T10:00:00.000Z");
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context.close();
});

beforeEach(async () => {
  await context.handle.db.delete(schema.pageLegacyBranchConversions);
  await context.handle.db.delete(schema.pageAmbiguities);
  await context.handle.db.delete(schema.pageDeviceFrontiers);
  await context.handle.db.delete(schema.pageOperationUpdates);
  await context.handle.db
    .update(schema.pageOperationStates)
    .set({ status: "initializing", currentCheckpointId: null });
  await context.handle.db.delete(schema.pageOperationCheckpoints);
  await context.handle.db.delete(schema.pageOperationStates);
  await context.handle.db.delete(schema.protectedEnvelopes);
  await context.handle.db.delete(schema.authorizedDevices);
  await context.handle.db.delete(schema.owners);
  await context.handle.db.delete(schema.installations);

  await context.handle.db.insert(schema.installations).values({
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    state: "ready",
    ownerId: OWNER_ID,
    workspaceId: context.workspaceId,
    schemaVersion: 1,
  });
  await context.handle.db.insert(schema.owners).values({
    id: OWNER_ID,
    installationId: INSTALLATION_ID,
    state: "active",
  });
  await context.handle.db.insert(schema.authorizedDevices).values({
    id: DEVICE_ID,
    ownerId: OWNER_ID,
    deviceBindingId: "page-operations-device",
    name: "Offline laptop",
    state: "active",
  });
});

async function createItem(kind: "page" | "folder"): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind,
      name: kind === "page" ? "Convergent page" : "Not a page",
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: `P${id.slice(-8)}`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function protectedEnvelope(entityType: string): Promise<Uuid> {
  const id = generateUuidV7();
  await context.handle.db.insert(schema.protectedEnvelopes).values({
    id,
    installationId: INSTALLATION_ID,
    workspaceId: context.workspaceId,
    entityType,
    entityId: id,
    keyGeneration: 1,
    recordVersion: 1,
    format: "mn.enc.v1",
    algorithm: "AES-256-GCM+HKDF-SHA-256",
    salt: "salt",
    nonce: "nonce",
    ciphertext: "ciphertext",
    tag: "tag",
    aadDigest: DIGEST_A,
  });
  return id;
}

async function activePage() {
  const pageId = await createItem("page");
  const frontierEnvelopeId = await protectedEnvelope("page-operation.frontier");
  const snapshotEnvelopeId = await protectedEnvelope("page-operation.checkpoint");
  const checkpointId = generateUuidV7();
  await context.handle.db.transaction(async (tx) => {
    await insertInitializingPageOperationState(tx, {
      pageId,
      workspaceId: context.workspaceId,
      canonicalDigest: DIGEST_A,
      lastRevisionId: null,
      now: NOW,
    });
    await insertPageOperationCheckpoint(tx, {
      checkpointId,
      pageId,
      workspaceId: context.workspaceId,
      throughPageSequence: 0,
      frontierEnvelopeId,
      snapshotEnvelopeId,
      snapshotDigest: DIGEST_A,
      canonicalDigest: DIGEST_A,
      revisionId: null,
      state: "verified",
      now: NOW,
    });
    await activatePageOperationState(tx, {
      pageId,
      workspaceId: context.workspaceId,
      checkpointId,
      frontierEnvelopeId,
      operationalDigest: DIGEST_A,
      canonicalDigest: DIGEST_A,
      lastRevisionId: null,
      now: NOW,
    });
  });
  return { pageId, frontierEnvelopeId, checkpointId };
}

async function updateInput(pageId: Uuid, updateId = generateUuidV7()) {
  return {
    updateId,
    pageId,
    workspaceId: context.workspaceId,
    authoredByDeviceId: DEVICE_ID,
    baseFrontierEnvelopeId: await protectedEnvelope("page-operation.update-base"),
    resultFrontierEnvelopeId: await protectedEnvelope("page-operation.update-result"),
    updateEnvelopeId: await protectedEnvelope("page-operation.update-bytes"),
    updateDigest: DIGEST_B,
    operationalDigest: DIGEST_B,
    canonicalDigest: DIGEST_B,
    acceptedAt: NOW,
  } as const;
}

describe("page operation schema boundaries", () => {
  it("refuses to attach operational state to a folder", async () => {
    const folderId = await createItem("folder");
    await expect(
      context.handle.db.transaction(async (tx) => {
        await insertInitializingPageOperationState(tx, {
          pageId: folderId,
          workspaceId: context.workspaceId,
          canonicalDigest: DIGEST_A,
          lastRevisionId: null,
          now: NOW,
        });
      }),
    ).rejects.toThrow();
    expect(
      await readPageOperationState(context.handle.db, context.workspaceId, folderId),
    ).toBeNull();
  });

  it("refuses an active state whose current checkpoint is not verified", async () => {
    const pageId = await createItem("page");
    const frontierEnvelopeId = await protectedEnvelope("page-operation.frontier");
    const snapshotEnvelopeId = await protectedEnvelope("page-operation.checkpoint");
    const checkpointId = generateUuidV7();

    await expect(
      context.handle.db.transaction(async (tx) => {
        await insertInitializingPageOperationState(tx, {
          pageId,
          workspaceId: context.workspaceId,
          canonicalDigest: DIGEST_A,
          lastRevisionId: null,
          now: NOW,
        });
        await insertPageOperationCheckpoint(tx, {
          checkpointId,
          pageId,
          workspaceId: context.workspaceId,
          throughPageSequence: 0,
          frontierEnvelopeId,
          snapshotEnvelopeId,
          snapshotDigest: DIGEST_A,
          canonicalDigest: DIGEST_A,
          revisionId: null,
          state: "candidate",
          now: NOW,
        });
        await activatePageOperationState(tx, {
          pageId,
          workspaceId: context.workspaceId,
          checkpointId,
          frontierEnvelopeId,
          operationalDigest: DIGEST_A,
          canonicalDigest: DIGEST_A,
          lastRevisionId: null,
          now: NOW,
        });
      }),
    ).rejects.toThrow();

    expect(await readPageOperationState(context.handle.db, context.workspaceId, pageId)).toBeNull();
  });
});

describe("locked append and idempotence", () => {
  it("replays one immutable update with the original page sequence", async () => {
    const { pageId } = await activePage();
    const input = await updateInput(pageId);

    const first = await context.handle.db.transaction(async (tx) =>
      appendAcceptedPageOperationUpdate(tx, input),
    );
    const repeated = await context.handle.db.transaction(async (tx) =>
      appendAcceptedPageOperationUpdate(tx, input),
    );

    expect(first).toMatchObject({ kind: "accepted", pageSequence: 1 });
    expect(repeated).toMatchObject({ kind: "repeated", pageSequence: 1 });
    expect(await context.handle.db.$count(schema.pageOperationUpdates)).toBe(1);
    expect(
      (await readPageOperationState(context.handle.db, context.workspaceId, pageId))
        ?.lastUpdateSequence,
    ).toBe(1);
  });

  it("treats the same update id with different bytes as an integrity failure", async () => {
    const { pageId } = await activePage();
    const input = await updateInput(pageId);
    await context.handle.db.transaction(async (tx) => appendAcceptedPageOperationUpdate(tx, input));

    await expect(
      context.handle.db.transaction(async (tx) =>
        appendAcceptedPageOperationUpdate(tx, { ...input, updateDigest: DIGEST_A }),
      ),
    ).rejects.toMatchObject({ code: "update-id-reused" });
    expect(await context.handle.db.$count(schema.pageOperationUpdates)).toBe(1);
  });

  it("rolls update and state frontier back together after a late fault", async () => {
    const { pageId, frontierEnvelopeId } = await activePage();
    const input = await updateInput(pageId);

    await expect(
      context.handle.db.transaction(async (tx) => {
        await appendAcceptedPageOperationUpdate(tx, input);
        throw new Error("late materialization fault");
      }),
    ).rejects.toThrow("late materialization fault");

    expect(await context.handle.db.$count(schema.pageOperationUpdates)).toBe(0);
    expect(
      await readPageOperationState(context.handle.db, context.workspaceId, pageId),
    ).toMatchObject({
      lastUpdateSequence: 0,
      currentFrontierEnvelopeId: frontierEnvelopeId,
      operationalDigest: DIGEST_A,
      canonicalDigest: DIGEST_A,
    });
  });

  it("holds a row lock until the first transaction commits", async () => {
    const { pageId } = await activePage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    const first = context.handle.db.transaction(async (tx) => {
      await lockPageOperationState(tx, context.workspaceId, pageId);
      firstLocked();
      await gate;
    });
    await locked;
    const secondLock = vi.fn();
    const second = context.handle.db.transaction(async (tx) => {
      await lockPageOperationState(tx, context.workspaceId, pageId);
      secondLock();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondLock).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(secondLock).toHaveBeenCalledOnce();
  });
});
