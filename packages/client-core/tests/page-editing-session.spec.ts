import {
  derivePageSyncState,
  EncryptedPageOperationLog,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  PageEditingSession,
  PageEditingSessionBlockedError,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`page-editing-session-${generateUuidV7()}`);
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

function pageFixture() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const page = OperationalPageDocument.create({
    pageId,
    document: {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }],
    },
  });
  return { pageId, blockId, page };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("PageEditingSession", () => {
  it("acknowledges an editor transaction only after its encrypted local commit", async () => {
    const { blockId, page } = pageFixture();
    const durable = deferred();
    const realStore = new LocalPageStateStore(log);
    const publishDurableUpdate = vi.fn();
    const session = await PageEditingSession.open({
      page,
      log,
      store: {
        async commitLocalTransaction(input) {
          await durable.promise;
          return await realStore.commitLocalTransaction(input);
        },
      },
      publishDurableUpdate,
    });
    const observed: string[] = [];
    session.subscribe((change) => observed.push(change.sync.kind));

    const commit = session.transact({
      type: "replace-text",
      blockId,
      from: 1,
      to: 1,
      text: " durable",
    });
    await vi.waitFor(() => expect(session.sync.kind).toBe("local-saving"));

    expect(await db.pageOperationStates.count()).toBe(0);
    expect(await db.pageOperationUpdates.count()).toBe(0);
    expect(publishDurableUpdate).not.toHaveBeenCalled();

    durable.resolve();
    const result = await commit;

    expect(result.changed).toBe(true);
    expect(session.sync).toMatchObject({ kind: "pending", pendingCount: 1 });
    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "A durable" }] });
    expect(await db.pageOperationStates.count()).toBe(1);
    expect(await db.pageOperationUpdates.count()).toBe(1);
    expect(publishDurableUpdate).toHaveBeenCalledOnce();
    expect(observed[0]).toBe("local-saving");
    expect(observed.at(-1)).toBe("pending");
  });

  it("serializes rapid editor transactions with immutable ids and increasing enqueue order", async () => {
    const { blockId, page } = pageFixture();
    const firstCommitEntered = deferred();
    const releaseFirstCommit = deferred();
    const realStore = new LocalPageStateStore(log);
    let commitCount = 0;
    const session = await PageEditingSession.open({
      page,
      log,
      store: {
        async commitLocalTransaction(input) {
          commitCount += 1;
          if (commitCount === 1) {
            firstCommitEntered.resolve();
            await releaseFirstCommit.promise;
          }
          return await realStore.commitLocalTransaction(input);
        },
      },
    });

    const first = session.transact({
      type: "replace-text",
      blockId,
      from: 1,
      to: 1,
      text: "B",
    });
    await firstCommitEntered.promise;
    const second = session.transact({
      type: "replace-text",
      blockId,
      from: 2,
      to: 2,
      text: "C",
    });

    expect(commitCount).toBe(1);
    releaseFirstCommit.resolve();
    await Promise.all([first, second]);

    const updates = await log.listUpdates(page.pageId);
    expect(updates.map(({ enqueueOrder }) => enqueueOrder)).toEqual([1, 2]);
    expect(new Set(updates.map(({ updateId }) => updateId)).size).toBe(2);
    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "ABC" }] });
  });

  it("adopts a concurrently durable remote edit before acknowledging its local edit", async () => {
    const pageId = generateUuidV7();
    const localBlockId = generateUuidV7();
    const remoteBlockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          { type: "paragraph", id: localBlockId, content: [{ text: "Local" }] },
          { type: "paragraph", id: remoteBlockId, content: [{ text: "Remote" }] },
        ],
      },
    });
    const seed = origin.transact([
      { type: "replace-text", blockId: localBlockId, from: 5, to: 5, text: "." },
    ]);
    await new LocalPageStateStore(log).commitLocalTransaction({
      page: origin,
      transaction: seed,
      updateId: generateUuidV7(),
      enqueueOrder: 1,
    });

    const localCommitEntered = deferred();
    const releaseLocalCommit = deferred();
    const realStore = new LocalPageStateStore(log);
    const session = await PageEditingSession.resume({
      pageId,
      log,
      store: {
        async commitLocalTransaction(input) {
          localCommitEntered.resolve();
          await releaseLocalCommit.promise;
          return await realStore.commitLocalTransaction(input);
        },
      },
    });
    if (session === null) throw new Error("expected a resumable page session");
    const origins: string[] = [];
    session.subscribe(({ origin: changeOrigin }) => origins.push(changeOrigin));

    const localCommit = session.transact({
      type: "replace-text",
      blockId: localBlockId,
      from: 6,
      to: 6,
      text: " edited",
    });
    await localCommitEntered.promise;

    const durableState = await log.getState(pageId);
    if (durableState?.checkpoint === null || durableState?.checkpoint === undefined) {
      throw new Error("expected a durable checkpoint");
    }
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: durableState.checkpoint,
    });
    for (const update of await log.listUpdates(pageId)) remote.importUpdate(update.updateBytes);
    const remoteTransaction = remote.transact([
      { type: "replace-text", blockId: remoteBlockId, from: 6, to: 6, text: " edited" },
    ]);
    await realStore.commitLocalTransaction({
      page: remote,
      transaction: remoteTransaction,
      updateId: generateUuidV7(),
      enqueueOrder: 100,
    });

    releaseLocalCommit.resolve();
    await expect(localCommit).resolves.toMatchObject({ changed: true });

    expect(session.read().blocks).toEqual([
      { type: "paragraph", id: localBlockId, content: [{ text: "Local. edited" }] },
      { type: "paragraph", id: remoteBlockId, content: [{ text: "Remote edited" }] },
    ]);
    expect(origins).toContain("remote");
    const resumed = await PageEditingSession.resume({ pageId, log, store: realStore });
    expect(resumed?.read()).toEqual(session.read());
  });

  it("recognizes a commit that became durable immediately before the renderer failed", async () => {
    const { blockId, page } = pageFixture();
    const publishDurableUpdate = vi.fn();
    const session = await PageEditingSession.open({
      page,
      log,
      store: new LocalPageStateStore(log, {
        at(phase) {
          if (phase === "after-commit") throw new Error("renderer disappeared");
        },
      }),
      publishDurableUpdate,
    });

    await expect(
      session.transact({
        type: "replace-text",
        blockId,
        from: 1,
        to: 1,
        text: " survives",
      }),
    ).resolves.toMatchObject({ changed: true });

    expect(session.sync).toMatchObject({ kind: "pending", pendingCount: 1 });
    expect(await db.pageOperationUpdates.count()).toBe(1);
    expect(publishDurableUpdate).toHaveBeenCalledOnce();
  });

  it("keeps an exact recovery buffer and refuses later edits when local durability fails", async () => {
    const { blockId, page } = pageFixture();
    const quotaFailure = new DOMException("quota exhausted", "QuotaExceededError");
    const session = await PageEditingSession.open({
      page,
      log,
      store: {
        async commitLocalTransaction() {
          throw quotaFailure;
        },
      },
    });

    await expect(
      session.transact({
        type: "replace-text",
        blockId,
        from: 1,
        to: 1,
        text: " visible but not durable",
      }),
    ).rejects.toBe(quotaFailure);

    expect(session.sync).toMatchObject({
      kind: "blocked",
      blockedReason: "quota",
      locallyDurable: false,
    });
    expect(session.recoveryBuffer?.document.blocks[0]).toMatchObject({
      content: [{ text: "A visible but not durable" }],
    });
    await expect(session.transact({ type: "delete-block", blockId })).rejects.toBeInstanceOf(
      PageEditingSessionBlockedError,
    );
    expect(await db.pageOperationUpdates.count()).toBe(0);
  });

  it("resumes the exact latest page from checkpoint plus immutable updates", async () => {
    const { blockId, pageId, page } = pageFixture();
    const session = await PageEditingSession.open({
      page,
      log,
      store: new LocalPageStateStore(log),
    });
    await session.transact({
      type: "replace-text",
      blockId,
      from: 1,
      to: 1,
      text: "B",
    });
    await session.transact({
      type: "replace-text",
      blockId,
      from: 2,
      to: 2,
      text: "C",
    });

    const resumed = await PageEditingSession.resume({
      pageId,
      log,
      store: new LocalPageStateStore(log),
    });

    expect(resumed).not.toBeNull();
    expect(resumed?.read().blocks[0]).toMatchObject({ content: [{ text: "ABC" }] });
    expect(resumed?.sync).toMatchObject({ kind: "pending", pendingCount: 2 });
  });
});

describe("derivePageSyncState", () => {
  it("keeps durability, transport and semantic attention distinct", async () => {
    const { blockId, page } = pageFixture();
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 1, to: 1, text: "B" },
    ]);
    const committed = await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId: generateUuidV7(),
      enqueueOrder: 1,
    });

    expect(
      derivePageSyncState({
        localCommit: "saving",
        online: true,
        operationState: committed.state,
        updates: [committed.update],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "local-saving", locallyDurable: false });
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: true,
        operationState: committed.state,
        updates: [committed.update],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "pending", pendingCount: 1, locallyDurable: true });
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: false,
        operationState: committed.state,
        updates: [committed.update],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "offline", pendingCount: 1, locallyDurable: true });

    const sending = { ...committed.update, status: "sending" as const };
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: true,
        operationState: committed.state,
        updates: [sending],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "syncing", synchronizationKind: "syncing" });

    const synchronizedState = {
      ...committed.state,
      serverVersionVector: committed.state.versionVector,
    };
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: true,
        operationState: synchronizedState,
        updates: [],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "synced", synchronizationKind: "synced" });
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: true,
        operationState: synchronizedState,
        updates: [],
        ambiguities: [{ status: "open" }],
      }),
    ).toMatchObject({
      kind: "attention",
      synchronizationKind: "synced",
      attentionCount: 1,
    });
  });

  it("reports blocked operation rows before any optimistic network wording", () => {
    expect(
      derivePageSyncState({
        localCommit: "idle",
        online: true,
        operationState: null,
        updates: [{ status: "blocked" }],
        ambiguities: [],
      }),
    ).toMatchObject({ kind: "blocked", blockedReason: "operation", locallyDurable: true });
  });
});
