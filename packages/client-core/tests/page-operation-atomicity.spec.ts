import {
  DuplicatePageUpdateIdError,
  EncryptedPageOperationLog,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  PageAuthorityRetiredError,
  PageEditingSession,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { OperationalPageDocument, operationalVersionDigest } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;
let cipher: LocalCipher;

const encryptionContext = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};

beforeEach(async () => {
  db = openLocalDatabase(`page-atomicity-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  cipher = new LocalCipher(keys);
  log = new EncryptedPageOperationLog(db, cipher, encryptionContext);
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
  it("converges simultaneous same-paragraph commits from independent database handles", async () => {
    const secondDb = openLocalDatabase(db.name);
    const secondLog = new EncryptedPageOperationLog(secondDb, cipher, encryptionContext);
    try {
      const pageId = generateUuidV7();
      const blockId = generateUuidV7();
      const origin = OperationalPageDocument.create({
        pageId,
        document: {
          blocks: [{ type: "paragraph", id: blockId, content: [{ text: "middle" }] }],
        },
      });
      const seed = origin.transact([
        { type: "replace-text", blockId, from: "middle".length, to: "middle".length, text: "." },
      ]);
      await new LocalPageStateStore(log).commitLocalTransaction({
        page: origin,
        transaction: seed,
        updateId: generateUuidV7(),
        enqueueOrder: 1,
      });
      const first = await PageEditingSession.resume({
        pageId,
        log,
        store: new LocalPageStateStore(log),
      });
      const second = await PageEditingSession.resume({
        pageId,
        log: secondLog,
        store: new LocalPageStateStore(secondLog),
      });
      if (first === null || second === null) throw new Error("expected two resumable sessions");

      await Promise.all([
        first.transact({ type: "replace-text", blockId, from: 0, to: 0, text: "left " }),
        second.transact({
          type: "replace-text",
          blockId,
          from: "middle.".length,
          to: "middle.".length,
          text: " right",
        }),
      ]);
      await Promise.all([first.adoptDurablePage(), second.adoptDurablePage()]);

      expect(first.peerId).not.toBe(second.peerId);
      expect(first.read()).toEqual(second.read());
      expect(first.read().blocks[0]).toMatchObject({
        content: [{ text: "left middle. right" }],
      });
      const updates = await log.listUpdates(pageId);
      expect(updates).toHaveLength(3);
      expect(new Set(updates.map(({ updateId }) => updateId)).size).toBe(3);
    } finally {
      secondDb.close();
    }
  });

  it("refuses a prepared editor update after the item becomes a folder", async () => {
    const { pageId, page, transaction } = editedPage();
    await db.items.put({ id: pageId, kind: "folder" } as never);

    await expect(
      new LocalPageStateStore(log, { requireCurrentPage: true }).commitLocalTransaction({
        page,
        transaction,
        updateId: generateUuidV7(),
        enqueueOrder: 1,
      }),
    ).rejects.toBeInstanceOf(PageAuthorityRetiredError);

    expect(await counts()).toEqual({ states: 0, updates: 0 });
  });

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
    await expect(operationalVersionDigest(pageId, transaction.resultVersionVector)).resolves.toBe(
      committed.state.projection?.operationalDigest,
    );
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

  it.each([
    "before-encryption",
    "after-encryption",
    "after-update-write",
    "after-state-write",
  ] as const)(
    "recovers the previous complete edit when a later commit fails at %s",
    async (phase) => {
      const { pageId, blockId, page, transaction } = editedPage();
      const firstStore = new LocalPageStateStore(log);
      await firstStore.commitLocalTransaction({
        page,
        transaction,
        updateId: generateUuidV7(),
        enqueueOrder: 1,
      });
      const firstState = await log.getState(pageId);
      if (firstState?.checkpoint === null || firstState?.checkpoint === undefined) {
        throw new Error("expected a durable first checkpoint");
      }
      const secondPage = await OperationalPageDocument.fromCheckpoint({
        pageId,
        checkpoint: firstState.checkpoint,
      });
      const secondTransaction = secondPage.transact([
        { type: "replace-text", blockId, from: 9, to: 9, text: " later" },
      ]);
      const failingStore = new LocalPageStateStore(log, {
        at(currentPhase) {
          if (currentPhase === phase) throw new Error(`injected:${phase}`);
        },
      });

      await expect(
        failingStore.commitLocalTransaction({
          page: secondPage,
          transaction: secondTransaction,
          updateId: generateUuidV7(),
          enqueueOrder: 2,
        }),
      ).rejects.toThrow(`injected:${phase}`);

      expect(await counts()).toEqual({ states: 1, updates: 1 });
      expect((await log.getState(pageId))?.recordVersion).toBe(firstState.recordVersion);
      const resumed = await PageEditingSession.resume({
        pageId,
        log,
        store: new LocalPageStateStore(log),
      });
      expect(resumed?.read().blocks[0]).toMatchObject({
        content: [{ text: "A durable" }],
      });
    },
  );

  it("recovers the complete later edit when interruption happens after commit", async () => {
    const { pageId, blockId, page, transaction } = editedPage();
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId: generateUuidV7(),
      enqueueOrder: 1,
    });
    const firstState = await log.getState(pageId);
    if (firstState?.checkpoint === null || firstState?.checkpoint === undefined) {
      throw new Error("expected a durable first checkpoint");
    }
    const secondPage = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: firstState.checkpoint,
    });
    const secondTransaction = secondPage.transact([
      { type: "replace-text", blockId, from: 9, to: 9, text: " later" },
    ]);

    await expect(
      new LocalPageStateStore(log, {
        at(phase) {
          if (phase === "after-commit") throw new Error("interrupted after commit");
        },
      }).commitLocalTransaction({
        page: secondPage,
        transaction: secondTransaction,
        updateId: generateUuidV7(),
        enqueueOrder: 2,
      }),
    ).rejects.toThrow("interrupted after commit");

    expect(await counts()).toEqual({ states: 1, updates: 2 });
    const resumed = await PageEditingSession.resume({
      pageId,
      log,
      store: new LocalPageStateStore(log),
    });
    expect(resumed?.read().blocks[0]).toMatchObject({
      content: [{ text: "A durable later" }],
    });
  });
});
