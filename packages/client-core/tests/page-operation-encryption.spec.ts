import {
  EncryptedPageOperationLog,
  LocalCipher,
  type LocalDatabase,
  LocalIntegrityError,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  createLegacyOfflineBranch,
  OperationalPageDocument,
  type PageAmbiguity,
} from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const installationId = "018f2b7c-0000-7000-8000-000000000001";
const workspaceId = "018f2b7c-0000-7000-8000-0000000000aa";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

async function createLog(database: LocalDatabase): Promise<EncryptedPageOperationLog> {
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  return new EncryptedPageOperationLog(database, new LocalCipher(keys), {
    installationId,
    workspaceId,
  });
}

function pageWithPrivateParagraph(pageId: Uuid, blockId: Uuid, text: string) {
  return OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text }] }] },
  });
}

beforeEach(async () => {
  db = openLocalDatabase(`page-encryption-${generateUuidV7()}`);
  log = await createLog(db);
});

afterEach(async () => {
  await db.delete();
});

describe("encrypted operational page records", () => {
  it("round-trips state and updates without storing authored content in clear text", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "Acquisition target Nimbus");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 25, to: 25, text: " — confidential" },
    ]);
    const updateId = generateUuidV7();

    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
      createdAt: "2026-08-20T12:00:00.000Z",
    });

    const rawState = await db.pageOperationStates.get(pageId);
    const rawUpdate = await db.pageOperationUpdates.get(updateId);
    const raw = JSON.stringify({ rawState, rawUpdate });
    expect(raw).not.toContain("Acquisition");
    expect(raw).not.toContain("Nimbus");
    expect(raw).not.toContain("confidential");
    expect(rawState).not.toHaveProperty("checkpoint");
    expect(rawState).not.toHaveProperty("projection");
    expect(rawUpdate).not.toHaveProperty("updateBytes");
    expect(rawUpdate).not.toHaveProperty("semanticChanges");

    const openedState = await log.getState(pageId);
    const openedUpdate = await log.getUpdate(updateId);
    expect(JSON.stringify(openedState?.projection?.document)).toContain("confidential");
    expect(openedUpdate?.updateBytes).toEqual(transaction.updateBytes);
    expect(openedUpdate?.semanticChanges).toEqual(transaction.semanticChanges);
  });

  it("binds state and update ciphertext to both page and record identity", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "Bound secret");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 12, to: 12, text: "!" },
    ]);
    const updateId = generateUuidV7();
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
    });
    const state = await db.pageOperationStates.get(pageId);
    const update = await db.pageOperationUpdates.get(updateId);
    expect(state).toBeDefined();
    expect(update).toBeDefined();
    if (state === undefined || update === undefined) return;

    const otherPageId = generateUuidV7();
    await expect(log.codec.openState({ ...state, pageId: otherPageId })).rejects.toBeInstanceOf(
      LocalIntegrityError,
    );
    await expect(log.codec.openUpdate({ ...update, pageId: otherPageId })).rejects.toBeInstanceOf(
      LocalIntegrityError,
    );
    await expect(
      log.codec.openUpdate({ ...update, updateId: generateUuidV7() }),
    ).rejects.toBeInstanceOf(LocalIntegrityError);
    await expect(log.codec.openUpdate({ ...update, status: "accepted" })).rejects.toThrow(
      "routing metadata mismatch",
    );
  });

  it("seals recoverable ambiguity details and complete legacy offline branches", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const sourceUpdateIds = [generateUuidV7(), generateUuidV7()] as const;
    const details: PageAmbiguity = {
      logicalKey: `delete-edit:${sourceUpdateIds.join(":")}:${blockId}`,
      kind: "delete-edit",
      status: "open",
      blockIds: [blockId],
      sourceUpdateIds,
      recoverableSubtree: {
        type: "paragraph",
        id: blockId,
        content: [{ text: "Recover the launch code phrase" }],
      },
      recoverablePlacement: { parentBlockId: null, beforeBlockId: null },
    };
    const ambiguityId = generateUuidV7();
    await log.putAmbiguity({
      ambiguityId,
      pageId,
      kind: details.kind,
      status: "open",
      openedAt: "2026-08-20T12:00:00.000Z",
      recordVersion: 1,
      details,
    });

    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: {
        blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Legacy private roadmap" }] }],
      },
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    await log.putLegacyBranch({
      pageId,
      branchId: branch.branchId,
      status: branch.status,
      createdAt: branch.createdAt,
      recordVersion: 1,
      branch,
      requiredFileIds: [generateUuidV7()],
    });

    const raw = JSON.stringify({
      ambiguity: await db.pageAmbiguities.get(ambiguityId),
      branch: await db.legacyOfflineBranches.get(pageId),
    });
    expect(raw).not.toContain("launch code");
    expect(raw).not.toContain("private roadmap");
    expect((await log.listOpenAmbiguities(pageId))[0]?.details).toEqual(details);
    expect((await log.getLegacyBranch(pageId))?.branch).toEqual(branch);
  });

  it("recovers interrupted sending rows and prunes accepted updates only after inclusion", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "A");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 1, to: 1, text: "B" },
    ]);
    const updateId = generateUuidV7();
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
    });
    await log.transitionUpdate(updateId, "sending");
    expect(await log.recoverInterruptedSending()).toBe(1);
    expect((await db.pageOperationUpdates.get(updateId))?.status).toBe("pending");

    await log.transitionUpdate(updateId, "sending");
    await log.transitionUpdate(updateId, "accepted", {
      pageSequence: 1,
      resultVersionVector: transaction.resultVersionVector,
      acceptedAt: "2026-08-20T12:01:00.000Z",
    });
    await expect(log.transitionUpdate(updateId, "sending")).rejects.toThrow(
      "cannot transition from accepted",
    );
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([]);
    await log.advanceServerFrontier(pageId, transaction.baseVersionVector, 0);
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([]);
    expect(await db.pageOperationUpdates.get(updateId)).toBeDefined();
    await log.advanceServerFrontier(pageId, transaction.resultVersionVector, 1);
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([updateId]);
    expect(await db.pageOperationUpdates.get(updateId)).toBeUndefined();
  });
});
