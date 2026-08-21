import {
  DuplicatePageUpdateIdError,
  EncryptedPageOperationLog,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`page-atomicity-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  log = new EncryptedPageOperationLog(db, new LocalCipher(keys), {
    installationId: "018f2b7c-0000-7000-8000-000000000001",
    workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
  });
});

afterEach(async () => {
  await db.delete();
});

function editedPage() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const page = OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
  });
  const transaction = page.transact([
    { type: "replace-text", blockId, from: 1, to: 1, text: " durable" },
  ]);
  return { pageId, blockId, page, transaction };
}

async function counts() {
  return {
    states: await db.pageOperationStates.count(),
    updates: await db.pageOperationUpdates.count(),
  };
}

describe("atomic operational page commit", () => {
  it.each([
    "before-encryption",
    "after-encryption",
    "after-update-write",
    "after-state-write",
  ] as const)("leaves no partial row when %s fails", async (failingPhase) => {
    const { page, transaction } = editedPage();
    const store = new LocalPageStateStore(log, {
      at(phase) {
        if (phase === failingPhase) throw new Error(`injected:${phase}`);
      },
    });

    await expect(
      store.commitLocalTransaction({
        page,
        transaction,
        updateId: generateUuidV7(),
        enqueueOrder: 1,
      }),
    ).rejects.toThrow(`injected:${failingPhase}`);
    expect(await counts()).toEqual({ states: 0, updates: 0 });
  });

  it("keeps both rows durable when the caller crashes after commit", async () => {
    const { page, transaction } = editedPage();
    const updateId = generateUuidV7();
    const store = new LocalPageStateStore(log, {
      at(phase) {
        if (phase === "after-commit") throw new Error("simulated renderer crash");
      },
    });

    await expect(
      store.commitLocalTransaction({ page, transaction, updateId, enqueueOrder: 1 }),
    ).rejects.toThrow("simulated renderer crash");
    expect(await counts()).toEqual({ states: 1, updates: 1 });
    expect((await log.getUpdate(updateId))?.updateBytes).toEqual(transaction.updateBytes);
    expect((await log.getState(page.pageId))?.versionVector).toEqual(
      transaction.resultVersionVector,
    );
  });

  it("commits update, frontier, checkpoint and canonical projection as one state", async () => {
    const { pageId, page, transaction } = editedPage();
    const updateId = generateUuidV7();
    const committed = await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 7,
      createdAt: "2026-08-20T12:00:00.000Z",
    });

    expect(await counts()).toEqual({ states: 1, updates: 1 });
    expect(committed.state.checkpoint?.versionVector).toEqual(transaction.resultVersionVector);
    expect(committed.state.checkpoint?.frontiers).toEqual(transaction.resultFrontiers);
    expect(committed.state.projection?.operationalFrontier).toEqual(transaction.resultFrontiers);
    expect(committed.state.projection?.operationalDigest).toBe(committed.state.checkpoint?.digest);
    expect((await log.getState(pageId))?.projection).toEqual(committed.state.projection);
    expect(await log.listUpdates(pageId, ["pending"])).toEqual([committed.update]);
  });

  it("does not overwrite state when an immutable update id is reused", async () => {
    const { pageId, blockId, page, transaction } = editedPage();
    const updateId = generateUuidV7();
    const store = new LocalPageStateStore(log);
    await store.commitLocalTransaction({ page, transaction, updateId, enqueueOrder: 1 });
    const firstState = await log.getState(pageId);
    expect(firstState?.checkpoint).not.toBeNull();
    if (firstState?.checkpoint === null || firstState?.checkpoint === undefined) {
      throw new Error("expected a durable checkpoint");
    }
    const resumed = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: firstState.checkpoint,
    });
    const secondTransaction = resumed.transact([
      { type: "replace-text", blockId, from: 9, to: 9, text: " twice" },
    ]);

    await expect(
      store.commitLocalTransaction({
        page: resumed,
        transaction: secondTransaction,
        updateId,
        enqueueOrder: 2,
      }),
    ).rejects.toBeInstanceOf(DuplicatePageUpdateIdError);

    expect((await log.getState(pageId))?.recordVersion).toBe(firstState?.recordVersion);
    expect(await db.pageOperationUpdates.count()).toBe(1);
  });

  it("retains the verified checkpoint between edits while advancing projection and frontier", async () => {
    const { pageId, blockId, page, transaction } = editedPage();
    const store = new LocalPageStateStore(log);
    const first = await store.commitLocalTransaction({
      page,
      transaction,
      updateId: generateUuidV7(),
      enqueueOrder: 1,
    });
    if (first.state.checkpoint === null) throw new Error("expected first checkpoint");
    const resumed = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: first.state.checkpoint,
    });
    const secondTransaction = resumed.transact([
      { type: "replace-text", blockId, from: 9, to: 9, text: " again" },
    ]);
    const second = await store.commitLocalTransaction({
      page: resumed,
      transaction: secondTransaction,
      updateId: generateUuidV7(),
      enqueueOrder: 2,
    });

    expect(second.state.checkpoint?.digest).toBe(first.state.checkpoint.digest);
    expect(second.state.versionVector).toEqual(secondTransaction.resultVersionVector);
    expect(second.state.projection?.operationalFrontier).toEqual(secondTransaction.resultFrontiers);
    expect(await db.pageOperationUpdates.count()).toBe(2);
  });

  it("rejects a checkpoint from a different in-memory result before opening a write", async () => {
    const { page, transaction } = editedPage();
    page.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: generateUuidV7(), content: [{ text: "later" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);

    await expect(
      new LocalPageStateStore(log).commitLocalTransaction({
        page,
        transaction,
        updateId: generateUuidV7(),
        enqueueOrder: 1,
      }),
    ).rejects.toThrow("version vectors differ");
    expect(await counts()).toEqual({ states: 0, updates: 0 });
  });
});
