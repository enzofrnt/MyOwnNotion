import {
  ConcurrentLegacyPageBranchError,
  EncryptedPageOperationLog,
  LegacyPageEditingSession,
  LegacyPageEditingSessionBlockedError,
  LegacyPageStateStore,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  type PageOperationStateRecord,
} from "@myownnotion/client-core";
import { PAGE_OPERATIONAL_VERSION } from "@myownnotion/contracts";
import {
  type BlockDocument,
  type BlockDocumentV3,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
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

  it("seeds an empty page in memory without persisting or activating anything", async () => {
    const pageId = generateUuidV7();
    const store = new LegacyPageStateStore(log);
    const publishDurableBranch = vi.fn();
    const session = await LegacyPageEditingSession.open({
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      log,
      store,
      publishDurableBranch,
    });

    // BlockNote needs a block to mount; the seed gives it one with a real
    // canonical identity.
    const blocks = session.read().blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph", content: [] });

    // A page that was only looked at writes nothing anywhere (plan §6).
    expect(await db.legacyOfflineBranches.count()).toBe(0);
    expect(publishDurableBranch).not.toHaveBeenCalled();
    expect(session.canUndo).toBe(false);
    expect(session.sync.kind).toBe("local-saved");
  });

  it("persists the bootstrap together with the first real edit as one journal", async () => {
    const pageId = generateUuidV7();
    const store = new LegacyPageStateStore(log);
    const publishDurableBranch = vi.fn();
    const session = await LegacyPageEditingSession.open({
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      log,
      store,
      publishDurableBranch,
    });
    const seededBlockId = session.read().blocks[0]?.id;
    if (seededBlockId === undefined) throw new Error("expected the seeded paragraph");

    await session.transact({
      type: "replace-text",
      blockId: seededBlockId,
      from: 0,
      to: 0,
      text: "first words",
    });

    expect(publishDurableBranch).toHaveBeenCalledOnce();
    const record = await log.getLegacyBranch(pageId);
    expect(record?.branch.bootstrapTransactionId).toBeDefined();
    expect(record?.branch.bootstrapTransactionId).toBe(
      record?.branch.semanticTransactions[0]?.transactionId,
    );
    expect(record?.branch.semanticTransactions.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(record?.branch.localDocument).toEqual(session.read());
    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "first words" }] });
  });

  it("does not re-seed a resumed branch that already carries edits", async () => {
    const pageId = generateUuidV7();
    const store = new LegacyPageStateStore(log);
    const first = await LegacyPageEditingSession.open({
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      log,
      store,
    });
    const seededBlockId = first.read().blocks[0]?.id;
    if (seededBlockId === undefined) throw new Error("expected the seeded paragraph");
    await first.transact({
      type: "replace-text",
      blockId: seededBlockId,
      from: 0,
      to: 0,
      text: "kept",
    });

    const resumed = await LegacyPageEditingSession.open({
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      log,
      store,
    });
    expect(resumed.read()).toEqual(first.read());
    expect(resumed.read().blocks).toHaveLength(1);
  });

  it("does not convert a page that was only looked at", async () => {
    const requestConversion = vi.fn(async () => "converted" as const);
    await LegacyPageEditingSession.open({
      pageId: generateUuidV7(),
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      log,
      store: new LegacyPageStateStore(log),
      activeStore: new LocalPageStateStore(log),
      requestConversion,
    });

    // Let every queued drain-point task run its course.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestConversion).not.toHaveBeenCalled();
  });

  it("keeps a gesture typed during conversion and finishes on the active session", async () => {
    const input = fixture();
    const gate = deferred<"converted" | "unavailable">();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log),
      activeStore: new LocalPageStateStore(log),
      requestConversion: () => gate.promise,
    });
    const handoverDocuments: BlockDocumentV3[] = [];
    session.subscribe(({ origin, document }) => {
      if (origin === "remote") handoverDocuments.push(document);
    });

    // The first edit drains the queue and schedules the conversion.
    await session.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " one",
    });
    // Typed while the conversion round-trip is in flight.
    const duringFlight = session.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 10,
      to: 10,
      text: " two",
    });

    // The server accepts the journal captured at request time — without the
    // in-flight gesture — and installs the converted checkpoint.
    const branch = (await log.getLegacyBranch(input.pageId))?.branch;
    expect(branch?.semanticTransactions).toHaveLength(1);
    if (branch === undefined) throw new Error("expected a durable branch");
    await installConvertedCheckpoint(log, input.pageId, branch.localDocument);
    gate.resolve("converted");

    // The queued gesture replays against the upgraded active session.
    await expect(duringFlight).resolves.toMatchObject({ changed: true, committed: null });
    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "Secret one two" }] });
    expect(session.sync.kind).toBe("pending");
    expect(session.canUndo).toBe(true);
    expect(await db.legacyOfflineBranches.count()).toBe(1);
    expect(await db.pageOperationUpdates.count()).toBe(1);
    expect(handoverDocuments).toHaveLength(1);
    expect(handoverDocuments[0]?.blocks[0]).toMatchObject({
      content: [{ text: "Secret one two" }],
    });
  });

  it("lets a durable-page listener upgrade mid-conversion without deadlocking", async () => {
    const input = fixture();
    let opened: LegacyPageEditingSession | null = null;
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log),
      activeStore: new LocalPageStateStore(log),
      // Mirrors the production wiring: the reconciler awaits its durable-page
      // listeners inside synchronize(), and local-content's listener calls
      // adoptDurablePage on the very session whose queue is running the
      // conversion task. Awaiting the queue there used to cycle forever.
      requestConversion: async () => {
        if (opened !== null) {
          const branch = (await log.getLegacyBranch(input.pageId))?.branch;
          if (branch !== undefined) {
            await installConvertedCheckpoint(log, input.pageId, branch.localDocument);
          }
          await opened.adoptDurablePage();
        }
        return "converted" as const;
      },
    });
    opened = session;

    await session.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " after",
    });
    // The queued follow-up must execute instead of waiting behind a dead
    // task; the gesture joined the converted journal, so the upgraded session
    // is already settled with nothing left to push.
    await vi.waitFor(() =>
      expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "Secret after" }] }),
    );
    await vi.waitFor(() => expect(session.sync.kind).toBe("synced"));
    expect(await db.pageOperationUpdates.count()).toBe(0);
  });

  it("publishes a merged conversion checkpoint as a remote document change", async () => {
    const input = fixture();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log),
      activeStore: new LocalPageStateStore(log),
    });
    const remoteBlockId = generateUuidV7();
    const merged: BlockDocumentV3 = {
      blocks: [
        ...structuredClone(input.baseDocument.blocks),
        {
          type: "paragraph",
          id: remoteBlockId,
          content: [{ text: "Remote words" }],
        },
      ],
    };
    const changes: Array<{ origin: string; document: BlockDocumentV3 }> = [];
    session.subscribe(({ origin, document }) => changes.push({ origin, document }));

    await installConvertedCheckpoint(log, input.pageId, merged);
    await session.adoptDurablePage();

    await vi.waitFor(() => expect(session.read().blocks).toHaveLength(2));
    await vi.waitFor(() =>
      expect(
        changes.some(
          ({ origin, document }) =>
            origin === "remote" && document.blocks.some(({ id }) => id === remoteBlockId),
        ),
      ).toBe(true),
    );
  });

  it("replays a gesture onto the active session when another driver converts first", async () => {
    const input = fixture();
    const store = new LegacyPageStateStore(log);
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store,
      activeStore: new LocalPageStateStore(log),
    });

    // Another tab converts the branch behind our back: it commits its own
    // edit, installs the checkpoint, and flips the record.
    const rival = await LegacyPageEditingSession.open({ ...input, log, store });
    await rival.transact({
      type: "replace-text",
      blockId: input.blockId,
      from: 6,
      to: 6,
      text: " rival",
    });
    const rivalBranch = (await log.getLegacyBranch(input.pageId))?.branch;
    if (rivalBranch === undefined) throw new Error("expected a durable branch");
    // Installs the checkpoint and flips the branch record, as the reconciler
    // would for a conversion this session did not drive.
    await installConvertedCheckpoint(log, input.pageId, rivalBranch.localDocument);

    // Our next gesture hits the CAS guard, upgrades, and replays instead of
    // blocking with a recovery buffer.
    await expect(
      session.transact({
        type: "replace-text",
        blockId: input.blockId,
        from: 6,
        to: 6,
        text: " ours",
      }),
    ).resolves.toMatchObject({ changed: true, committed: null });
    const merged = JSON.stringify(session.read());
    expect(merged).toContain("rival");
    expect(merged).toContain("ours");
    expect(session.recoveryBuffer).toBeNull();
    expect(await db.pageOperationUpdates.count()).toBe(1);
  });
});

/**
 * Stands in for the reconciler's post-conversion work: an accepted journal
 * becomes an installed active checkpoint, and the branch record flips to
 * `converted` — exactly what a later branch commit needs to hit its CAS guard.
 */
async function installConvertedCheckpoint(
  log: EncryptedPageOperationLog,
  pageId: Uuid,
  document: BlockDocumentV3,
): Promise<void> {
  const page = await OperationalPageDocument.create({ pageId, document });
  const checkpoint = await page.checkpoint();
  const projection = await page.project();
  const state: PageOperationStateRecord = {
    pageId,
    status: "active",
    operationalVersion: PAGE_OPERATIONAL_VERSION,
    canonicalFormatVersion: 3,
    latestServerPageSequence: 0,
    localAvailability: "present",
    lastAccessedAt: new Date().toISOString(),
    recordVersion: 1,
    checkpoint,
    projection,
    versionVector: checkpoint.versionVector,
    frontiers: checkpoint.frontiers,
    serverVersionVector: checkpoint.versionVector,
  };
  const sealed = await log.codec.sealState(state);
  await log.db.transaction("rw", log.db.pageOperationStates, async () => {
    await log.db.pageOperationStates.add(sealed);
  });
  const record = await log.getLegacyBranch(pageId);
  if (record !== null && record.branch.status !== "converted") {
    await log.putLegacyBranch({
      ...record,
      status: "converted",
      recordVersion: record.recordVersion + 1,
      branch: { ...record.branch, status: "converted" },
    });
  }
}

describe("blocked-commit recovery on the legacy branch", () => {
  it("retries a failed durability commit and clears the recovery buffer", async () => {
    const input = fixture();
    const quotaFailure = new DOMException("quota exhausted", "QuotaExceededError");
    const realStore = new LegacyPageStateStore(log);
    let failing = true;
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: {
        async commitLegacyBranch(commit) {
          if (failing) throw quotaFailure;
          return await realStore.commitLegacyBranch(commit);
        },
      },
    });

    await expect(
      session.transact({
        type: "replace-text",
        blockId: input.blockId,
        from: 6,
        to: 6,
        text: " retenu",
      }),
    ).rejects.toBe(quotaFailure);
    expect(session.sync.kind).toBe("blocked");
    expect(session.recoveryBuffer).not.toBeNull();

    failing = false;
    const retried = await session.retryBlockedCommit();
    expect(retried.changed).toBe(true);
    expect(session.recoveryBuffer).toBeNull();
    expect(session.read().blocks[0]).toMatchObject({
      content: [{ text: "Secret retenu" }],
    });
  });

  it("refuses a retry when nothing is blocked", async () => {
    const input = fixture();
    const session = await LegacyPageEditingSession.open({
      ...input,
      log,
      store: new LegacyPageStateStore(log),
    });
    await expect(session.retryBlockedCommit()).rejects.toBeInstanceOf(
      LegacyPageEditingSessionBlockedError,
    );
  });
});
