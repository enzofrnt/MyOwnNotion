import {
  ConcurrentLegacyPageBranchError,
  EncryptedPageOperationLog,
  LegacyPageEditingSession,
  LegacyPageEditingSessionBlockedError,
  LegacyPageStateStore,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  MemorySecureStorage,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { type BlockDocument, generateUuidV7 } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`legacy-page-session-${generateUuidV7()}`);
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

function fixture() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const baseRevisionId = generateUuidV7();
  const baseDocument: BlockDocument = {
    blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Secret" }] }],
  };
  return { pageId, blockId, baseRevisionId, baseDocument };
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

describe("LegacyPageEditingSession", () => {
  it("creates no migration row until the first edit is durably encrypted", async () => {
    const input = fixture();
    const release = deferred();
    const realStore = new LegacyPageStateStore(log);
    const publishDurableBranch = vi.fn();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: {
        async commitLegacyBranch(commit) {
          await release.promise;
          return await realStore.commitLegacyBranch(commit);
        },
      },
      publishDurableBranch,
    });

    expect(await db.legacyOfflineBranches.count()).toBe(0);
    const saving = session.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " private",
    });
    await vi.waitFor(() => expect(session.sync.kind).toBe("local-saving"));
    expect(await db.legacyOfflineBranches.count()).toBe(0);
    expect(publishDurableBranch).not.toHaveBeenCalled();

    release.resolve();
    await expect(saving).resolves.toMatchObject({ changed: true });
    expect(session.sync).toMatchObject({ kind: "pending", pendingCount: 1 });
    expect(publishDurableBranch).toHaveBeenCalledOnce();
    const raw = JSON.stringify(await db.legacyOfflineBranches.get(input.pageId));
    expect(raw).not.toContain("Secret");
    expect(raw).not.toContain("private");
    expect((await log.getLegacyBranch(input.pageId))?.branch.semanticTransactions).toHaveLength(1);
  });

  it("resumes the exact local projection and continues the contiguous semantic journal", async () => {
    const input = fixture();
    const store = new LegacyPageStateStore(log);
    const first = await LegacyPageEditingSession.open({ ...input, log, store });
    await first.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " A",
    });

    const resumed = await LegacyPageEditingSession.open({ ...input, log, store });
    expect(resumed.read().blocks[0]).toMatchObject({ content: [{ text: "Secret A" }] });
    await resumed.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 8,
      to: 8,
      text: " B",
    });

    expect(resumed.read().blocks[0]).toMatchObject({ content: [{ text: "Secret A B" }] });
    const branch = await log.getLegacyBranch(input.pageId);
    expect(branch?.recordVersion).toBe(2);
    expect(branch?.branch.semanticTransactions.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(branch?.branch.localDocument).toEqual(resumed.read());
  });

  it("uses compare-and-swap so two tabs cannot replace one another's offline branch", async () => {
    const input = fixture();
    const store = new LegacyPageStateStore(log);
    const left = await LegacyPageEditingSession.open({ ...input, log, store });
    const right = await LegacyPageEditingSession.open({ ...input, log, store });

    await left.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " gauche",
    });
    await expect(
      right.transact({
        type: "replace-text",
        blockId: input.blockId,
        from: 6,
        to: 6,
        text: " droite",
      }),
    ).rejects.toBeInstanceOf(ConcurrentLegacyPageBranchError);

    expect(right.sync).toMatchObject({
      kind: "blocked",
      locallyDurable: false,
      blockedReason: "storage",
    });
    expect(right.recoveryBuffer?.document.blocks[0]).toMatchObject({
      content: [{ text: "Secret droite" }],
    });
    await expect(
      right.transact({ type: "delete-block", blockId: input.blockId }),
    ).rejects.toBeInstanceOf(LegacyPageEditingSessionBlockedError);
    expect((await log.getLegacyBranch(input.pageId))?.branch.localDocument.blocks[0]).toMatchObject(
      {
        content: [{ text: "Secret gauche" }],
      },
    );
  });

  it("recovers a commit that became durable immediately before the renderer failed", async () => {
    const input = fixture();
    const publishDurableBranch = vi.fn();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log, {
        at(phase) {
          if (phase === "after-commit") throw new Error("renderer disappeared");
        },
      }),
      publishDurableBranch,
    });

    await expect(
      session.transact({
        type: "replace-text",
        blockId: input.blockId,
        from: 6,
        to: 6,
        text: " survives",
      }),
    ).resolves.toMatchObject({ changed: true });
    expect(await db.legacyOfflineBranches.count()).toBe(1);
    expect(session.sync.kind).toBe("pending");
    expect(publishDurableBranch).toHaveBeenCalledOnce();
  });

  it("persists undo and redo as ordinary replayable migration transactions", async () => {
    const input = fixture();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log),
    });
    await session.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " change",
    });
    await session.undo();
    await session.redo();

    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "Secret change" }] });
    expect(
      (await log.getLegacyBranch(input.pageId))?.branch.semanticTransactions.map(
        ({ sequence }) => sequence,
      ),
    ).toEqual([1, 2, 3]);
  });
});
