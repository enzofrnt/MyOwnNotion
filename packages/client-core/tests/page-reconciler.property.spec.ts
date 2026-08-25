import {
  EncryptedPageOperationLog,
  encodePageOperationBytes,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  PageReconciler,
  type PageSyncTransport,
  pageSynchronizationResource,
  selectPageUpdateBatch,
  withLocalDatabaseLock,
} from "@myownnotion/client-core";
import type { ActivePageSyncRequestDto, ActivePageSyncResponseDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  OperationalPageDocument,
  sha256Hex,
} from "@myownnotion/page-state";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`page-reconciler-${generateUuidV7()}`);
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
  const page = OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
  });
  return { pageId, blockId, page };
}

async function commitEdit(
  page: OperationalPageDocument,
  blockId: Uuid,
  text: string,
  enqueueOrder: number,
) {
  const current = page.snapshot().blocks[0];
  if (current?.type !== "paragraph") throw new Error("expected a paragraph fixture");
  const offset = current.content.map(({ text: value }) => value).join("").length;
  const transaction = page.transact([
    {
      type: "replace-text",
      blockId,
      from: offset,
      to: offset,
      text,
    },
  ]);
  return await new LocalPageStateStore(log).commitLocalTransaction({
    page,
    transaction,
    updateId: generateUuidV7(),
    enqueueOrder,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
}

function activeResponse(
  request: ActivePageSyncRequestDto,
  pageId: Uuid,
  input: Partial<ActivePageSyncResponseDto> &
    Pick<ActivePageSyncResponseDto, "serverVersionVector" | "latestPageSequence">,
): ActivePageSyncResponseDto {
  return {
    mode: "active",
    requestId: request.requestId,
    pageId,
    accepted: [],
    repeated: [],
    remoteUpdates: [],
    throughPageSequence: input.latestPageSequence,
    hasMore: false,
    canonical: {
      format: "myownnotion.document+json",
      formatVersion: 3,
      digest: "a".repeat(64),
      lastConsolidatedRevisionId: null,
      hasUnconsolidatedChanges: true,
    },
    ambiguities: [],
    fileRequirements: [],
    ...input,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("page update batching", () => {
  it("always selects a causal prefix bounded by count and decoded bytes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (sizes, maxCount, maxBytes) => {
          const updates = sizes.map((size, index) => ({
            updateId: String(index),
            updateBytes: new Uint8Array(size),
          }));
          if ((sizes[0] ?? 0) > maxBytes) {
            expect(() => selectPageUpdateBatch(updates, { maxCount, maxBytes })).toThrow();
            return;
          }
          const selected = selectPageUpdateBatch(updates, { maxCount, maxBytes });
          expect(selected).toEqual(updates.slice(0, selected.length));
          expect(selected.length).toBeLessThanOrEqual(maxCount);
          expect(
            selected.reduce((total, update) => total + update.updateBytes.byteLength, 0),
          ).toBeLessThanOrEqual(maxBytes);
        },
      ),
    );
  });
});

describe("PageReconciler", () => {
  it("refreshes its open session after another tab committed the durable frontier", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " shared", 1);
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: request.updates.map(({ updateId }) => ({
              updateId,
              pageSequence: 1,
              resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            })),
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const owner = new PageReconciler({ pageId, log, transport });
    const follower = new PageReconciler({ pageId, log, transport });
    const observedRecordVersions: number[] = [];
    follower.subscribeDurablePage((state) => {
      observedRecordVersions.push(state.recordVersion);
    });
    await vi.waitFor(() => expect(observedRecordVersions).toHaveLength(1));

    await expect(owner.synchronize()).resolves.toMatchObject({ kind: "synced" });
    await expect(follower.synchronize()).resolves.toMatchObject({ kind: "synced" });

    expect(observedRecordVersions).toHaveLength(2);
    expect(observedRecordVersions[1]).toBeGreaterThan(observedRecordVersions[0] ?? 0);
  });

  it("waits for another same-page exchange without polling or stealing its claim", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const ownerEntered = deferred();
    const releaseOwner = deferred();
    const owner = withLocalDatabaseLock(log.db, pageSynchronizationResource(pageId), async () => {
      await log.transitionUpdate(committed.update.updateId, "sending");
      ownerEntered.resolve();
      await releaseOwner.promise;
    });
    await ownerEntered.promise;
    const sync = vi.fn<PageSyncTransport["sync"]>(async (_pageId, request) => {
      if (request.mode !== "active") throw new Error("expected active sync");
      return {
        ok: true,
        value: activeResponse(request, pageId, {
          accepted: [
            {
              updateId: committed.update.updateId,
              pageSequence: 1,
              resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            },
          ],
          serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
          latestPageSequence: 1,
          canonical: {
            format: "myownnotion.document+json",
            formatVersion: 3,
            digest: committed.state.projection?.canonicalDigest ?? "",
            lastConsolidatedRevisionId: null,
            hasUnconsolidatedChanges: true,
          },
        }),
      };
    });
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport: {
        sync,
        async convertLegacyBranch() {
          throw new Error("unexpected legacy branch conversion");
        },
      },
    });

    const follower = reconciler.synchronize();
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    expect((await log.getUpdate(committed.update.updateId))?.status).toBe("sending");
    releaseOwner.resolve();
    await owner;
    await expect(follower).resolves.toMatchObject({ kind: "synced", exchanges: 1 });
    expect(sync).toHaveBeenCalledOnce();
    expect(await log.getUpdate(committed.update.updateId)).toBeNull();
  });

  it("reclaims an interrupted sending claim after acquiring the page owner", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " recovered", 1);
    await log.transitionUpdate(committed.update.updateId, "sending");
    const sentIds: Uuid[][] = [];
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        sentIds.push(request.updates.map(({ updateId }) => updateId as Uuid));
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: [
              {
                updateId: committed.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
              },
            ],
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };

    await expect(
      new PageReconciler({ pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({ kind: "synced" });
    expect(sentIds).toEqual([[committed.update.updateId]]);
    expect(await log.getUpdate(committed.update.updateId)).toBeNull();
  });

  it("never recovers another page's genuinely in-flight update", async () => {
    const first = fixture();
    const second = fixture();
    const firstCommit = await commitEdit(first.page, first.blockId, " first", 1);
    await commitEdit(second.page, second.blockId, " second", 1);
    const firstTransportEntered = deferred();
    const releaseFirstTransport = deferred();
    const firstTransport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        firstTransportEntered.resolve();
        await releaseFirstTransport.promise;
        return {
          ok: true,
          value: activeResponse(request, first.pageId, {
            accepted: [
              {
                updateId: firstCommit.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(
                  firstCommit.update.resultVersionVector,
                ),
              },
            ],
            serverVersionVector: encodePageOperationBytes(firstCommit.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: firstCommit.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const secondTransport: PageSyncTransport = {
      async sync() {
        return {
          ok: false,
          offline: true,
          problem: { code: "network.unreachable", message: "offline" },
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };

    const firstPass = new PageReconciler({
      pageId: first.pageId,
      log,
      transport: firstTransport,
    }).synchronize();
    await firstTransportEntered.promise;
    expect((await log.getUpdate(firstCommit.update.updateId))?.status).toBe("sending");

    await expect(
      new PageReconciler({
        pageId: second.pageId,
        log,
        transport: secondTransport,
      }).synchronize(),
    ).resolves.toMatchObject({ kind: "offline" });
    expect((await log.getUpdate(firstCommit.update.updateId))?.status).toBe("sending");

    releaseFirstTransport.resolve();
    await expect(firstPass).resolves.toMatchObject({ kind: "synced" });
    expect(await log.getUpdate(firstCommit.update.updateId)).toBeNull();
  });

  it("returns its own claim to pending after an unexpected local commit failure", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const sentIds: Uuid[][] = [];
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        sentIds.push(request.updates.map(({ updateId }) => updateId as Uuid));
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: [
              {
                updateId: committed.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
              },
            ],
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const sealFailure = new Error("simulated IndexedDB seal failure");
    vi.spyOn(log.codec, "sealState").mockRejectedValueOnce(sealFailure);
    const reconciler = new PageReconciler({ pageId, log, transport });

    await expect(reconciler.synchronize()).rejects.toBe(sealFailure);
    expect((await log.getUpdate(committed.update.updateId))?.status).toBe("pending");

    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(sentIds).toEqual([[committed.update.updateId], [committed.update.updateId]]);
    expect(await log.getUpdate(committed.update.updateId)).toBeNull();
  });

  it("blocks a submitted batch when a successful response violates the negotiated contract", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            // A submitted update must appear in accepted or repeated. An HTTP
            // 200 that omits it cannot leave the immutable row stuck in
            // `sending`, nor can it be retried forever as if it were offline.
            serverVersionVector: encodePageOperationBytes(committed.update.baseVersionVector),
            latestPageSequence: 0,
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };

    await expect(
      new PageReconciler({ pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({
      kind: "blocked",
      problemCode: "page-operations.projection-invalid",
    });
    expect((await log.getUpdate(committed.update.updateId))?.status).toBe("blocked");
  });

  it("does not turn a durable synchronization into failure when a UI listener throws", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const backgroundErrors: unknown[] = [];
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: [
              {
                updateId: committed.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
              },
            ],
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport,
      onBackgroundError: (error) => backgroundErrors.push(error),
    });
    reconciler.subscribeDurablePage(() => {
      throw new Error("renderer disappeared after IndexedDB commit");
    });

    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(backgroundErrors.length).toBeGreaterThanOrEqual(1);
    expect(await log.listUpdates(pageId)).toEqual([]);
    expect((await log.getState(pageId))?.serverVersionVector).not.toBeNull();
  });

  it("replays the current durable state to a subscriber that arrived after the exchange", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: [
              {
                updateId: committed.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
              },
            ],
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const reconciler = new PageReconciler({ pageId, log, transport });
    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    const replayed = deferred<{ readonly latestServerPageSequence: number }>();

    const unsubscribe = reconciler.subscribeDurablePage((state) => replayed.resolve(state));

    await expect(replayed.promise).resolves.toMatchObject({ latestServerPageSequence: 1 });
    unsubscribe();
  });

  it("does not republish a durable page after an empty frontier confirmation", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const onDurablePage = vi.fn();
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: request.updates.map((update) => ({
              updateId: update.updateId,
              pageSequence: 1,
              resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            })),
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const reconciler = new PageReconciler({ pageId, log, transport, onDurablePage });

    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(onDurablePage).toHaveBeenCalledOnce();

    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(onDurablePage).toHaveBeenCalledOnce();
  });

  it("retries a response lost after server acceptance with the same immutable update id", async () => {
    const { pageId, blockId, page } = fixture();
    const committed = await commitEdit(page, blockId, " local", 1);
    const seenIds: string[][] = [];
    let first = true;
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        seenIds.push(request.updates.map(({ updateId }) => updateId));
        if (first) {
          first = false;
          return {
            ok: false,
            offline: true,
            problem: { code: "network.unreachable", message: "offline" },
          };
        }
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            repeated: [
              {
                updateId: committed.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
              },
            ],
            serverVersionVector: encodePageOperationBytes(committed.update.resultVersionVector),
            latestPageSequence: 1,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: committed.state.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const reconciler = new PageReconciler({ pageId, log, transport });

    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "offline" });
    expect((await log.getUpdate(committed.update.updateId))?.status).toBe("pending");
    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });

    expect(seenIds).toEqual([[committed.update.updateId], [committed.update.updateId]]);
    expect(await log.listUpdates(pageId)).toEqual([]);
    const state = await log.getState(pageId);
    expect(state?.serverVersionVector).toEqual(state?.versionVector);
  });

  it("persists remote catch-up, acknowledgements and file requirements before reporting success", async () => {
    const { pageId, blockId, page } = fixture();
    const local = await commitEdit(page, blockId, " local", 1);
    const checkpoint = local.state.checkpoint;
    if (checkpoint === null) throw new Error("expected a checkpoint");
    const remote = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const remoteTransaction = remote.transact([
      {
        type: "replace-text",
        blockId,
        from: "A local".length,
        to: "A local".length,
        text: " remote",
      },
    ]);
    const remoteUpdateId = generateUuidV7();
    const remoteDigest = await sha256Hex(remoteTransaction.updateBytes);
    const serverVersionVector = encodePageOperationBytes(remoteTransaction.resultVersionVector);
    const serverProjection = await remote.project();
    const requirements = [{ fileId: generateUuidV7(), state: "upload-required" as const }];
    const observedRequirements: unknown[] = [];
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted: [
              {
                updateId: local.update.updateId,
                pageSequence: 1,
                resultVersionVector: encodePageOperationBytes(local.update.resultVersionVector),
              },
            ],
            remoteUpdates: [
              {
                updateId: remoteUpdateId,
                pageSequence: 2,
                authoredByDeviceId: generateUuidV7(),
                updateBytes: encodePageOperationBytes(remoteTransaction.updateBytes),
                updateDigest: remoteDigest,
                acceptedAt: "2026-08-21T12:00:01.000Z",
              },
            ],
            serverVersionVector,
            latestPageSequence: 2,
            fileRequirements: requirements,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: serverProjection.canonicalDigest,
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport,
      onFileRequirements: (value) => observedRequirements.push(value),
    });

    await expect(reconciler.synchronize()).resolves.toMatchObject({
      kind: "synced",
      latestPageSequence: 2,
      fileRequirements: requirements,
    });

    const state = await log.getState(pageId);
    expect(state?.latestServerPageSequence).toBe(2);
    expect(state?.projection?.document.blocks[0]).toMatchObject({
      content: [{ text: "A local remote" }],
    });
    expect(state?.checkpoint?.versionVector).toEqual(state?.versionVector);
    expect(state?.serverVersionVector).toEqual(state?.versionVector);
    expect(await log.listUpdates(pageId)).toEqual([]);
    expect(observedRequirements).toEqual([requirements]);
  });

  it("sends more than one bounded batch without ever confirming unsent work", async () => {
    const { pageId, blockId, page } = fixture();
    for (let index = 1; index <= 70; index += 1) {
      await commitEdit(page, blockId, String(index % 10), index);
    }
    const requestSizes: number[] = [];
    let pageSequence = 0;
    let serverVersionVector: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active sync");
        requestSizes.push(request.updates.length);
        const accepted = [] as ActivePageSyncResponseDto["accepted"];
        for (const candidate of request.updates) {
          const stored = await log.getUpdate(candidate.updateId as Uuid);
          if (stored === null) throw new Error("missing local update");
          pageSequence += 1;
          serverVersionVector = stored.resultVersionVector;
          accepted.push({
            updateId: stored.updateId,
            pageSequence,
            resultVersionVector: encodePageOperationBytes(stored.resultVersionVector),
          });
        }
        return {
          ok: true,
          value: activeResponse(request, pageId, {
            accepted,
            serverVersionVector: encodePageOperationBytes(serverVersionVector),
            latestPageSequence: pageSequence,
            canonical: {
              format: "myownnotion.document+json",
              formatVersion: 3,
              digest: (await log.getState(pageId))?.projection?.canonicalDigest ?? "",
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
            },
          }),
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };

    await expect(
      new PageReconciler({ pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({ kind: "synced", exchanges: 2 });
    expect(requestSizes).toEqual([64, 6]);
    expect(await log.listUpdates(pageId)).toEqual([]);
  });

  it("does not convert a branch that holds only the empty-document bootstrap", async () => {
    // Opening a never-activated page seeds BlockNote's first paragraph as a
    // real journal transaction, but it stays in memory until the owner writes.
    // A record that somehow holds only the bootstrap is a read, not a write:
    // converting it would activate the page server-side just because someone
    // looked at it (plan §6).
    const pageId = generateUuidV7();
    const bootstrapTransactionId = generateUuidV7();
    const seededBlockId = generateUuidV7();
    let branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      createdAt: "2026-08-21T12:00:00.000Z",
    });
    branch = {
      ...(await appendLegacySemanticTransaction(branch, {
        transactionId: bootstrapTransactionId,
        sequence: 1,
        commands: [
          {
            type: "insert-block",
            block: { type: "paragraph", id: seededBlockId, content: [] },
            parentBlockId: null,
            beforeBlockId: null,
          },
        ],
      })),
      bootstrapTransactionId,
    };
    await log.putLegacyBranch({
      pageId,
      branchId: branch.branchId,
      status: "editing",
      createdAt: branch.createdAt,
      recordVersion: 1,
      requiredFileIds: [],
      branch,
    });
    const transport: PageSyncTransport = {
      async sync() {
        throw new Error("unexpected active sync");
      },
      async convertLegacyBranch() {
        throw new Error("unexpected legacy branch conversion");
      },
    };

    await expect(
      new PageReconciler({ pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({ kind: "synced", exchanges: 0 });
  });

  it("leaves conversion to the editing queue once a real transaction joins the bootstrap", async () => {
    const pageId = generateUuidV7();
    const localBaseRevisionId = generateUuidV7();
    const canonicalBaseRevisionId = generateUuidV7();
    const bootstrapTransactionId = generateUuidV7();
    const userTransactionId = generateUuidV7();
    const seededBlockId = generateUuidV7();
    let branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: localBaseRevisionId,
      baseDocument: { blocks: [] },
      createdAt: "2026-08-21T12:00:00.000Z",
    });
    branch = {
      ...(await appendLegacySemanticTransaction(branch, {
        transactionId: bootstrapTransactionId,
        sequence: 1,
        commands: [
          {
            type: "insert-block",
            block: { type: "paragraph", id: seededBlockId, content: [] },
            parentBlockId: null,
            beforeBlockId: null,
          },
        ],
      })),
      bootstrapTransactionId,
    };
    branch = await appendLegacySemanticTransaction(branch, {
      transactionId: userTransactionId,
      sequence: 2,
      commands: [
        {
          type: "insert-block",
          block: { type: "paragraph", id: generateUuidV7(), content: [{ text: "hi" }] },
          parentBlockId: null,
          beforeBlockId: seededBlockId,
        },
      ],
    });
    await log.putLegacyBranch({
      pageId,
      branchId: branch.branchId,
      status: "editing",
      createdAt: branch.createdAt,
      recordVersion: 2,
      requiredFileIds: [],
      branch,
    });
    // Item creation acknowledgements retain this alias specifically for work
    // prepared by a still-mounted surface. A legacy branch is one such caller:
    // its journal remains based on the same content, but the server only knows
    // the canonical revision identity it returned.
    await db.revisionHeaders.put({
      id: localBaseRevisionId,
      itemId: pageId,
      mutationId: generateUuidV7(),
      parentRevisionIds: [],
      acceptedAt: "2026-08-21T12:00:01.000Z",
      local: 0,
      canonicalRevisionId: canonicalBaseRevisionId,
    });
    let conversionRequests = 0;
    const transport: PageSyncTransport = {
      async sync() {
        throw new Error("unexpected active sync");
      },
      async convertLegacyBranch(_pageId, request) {
        conversionRequests += 1;
        expect(request.baseRevisionId).toBe(canonicalBaseRevisionId);
        expect(request.semanticTransactions.map(({ transactionId }) => transactionId)).toEqual([
          bootstrapTransactionId,
          userTransactionId,
        ]);
        return {
          ok: false,
          offline: true,
          problem: { code: "network.unreachable", message: "offline probe" },
        };
      },
    };

    // A background workspace pass must not race the editor and replace a
    // branch that is still accepting gestures.
    const reconciler = new PageReconciler({ pageId, log, transport });
    await expect(reconciler.synchronize()).resolves.toMatchObject({
      kind: "pending",
      problemCode: "page-operations.legacy-conversion-deferred",
    });
    expect(conversionRequests).toBe(0);

    // The editing session's queue-bound request is the only conversion
    // authority. If it arrives during a background pass, coalescing preserves
    // that stronger request and executes a dedicated conversion pass next.
    const background = reconciler.synchronize();
    const conversion = reconciler.convertLegacyBranch();
    await expect(Promise.all([background, conversion])).resolves.toEqual([
      expect.objectContaining({ kind: "offline" }),
      expect.objectContaining({ kind: "offline" }),
    ]);
    expect(conversionRequests).toBe(1);
  });
});

describe("reconciler refusal paths", () => {
  it("blocks the page when the local state has no checkpoint", async () => {
    const pageId = generateUuidV7();
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport: {
        async sync() {
          return { ok: false, offline: false, problem: { code: "ok", message: "" } };
        },
        async convertLegacyBranch() {
          throw new Error("unexpected legacy-branch conversion");
        },
      },
    });
    const outcome = await reconciler.synchronize();
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") {
      expect(outcome.problemCode).toBe("page-operations.local-state-missing");
    }
  });

  it("returns offline when the transport reports a network failure", async () => {
    const { pageId, blockId, page } = fixture();
    await commitEdit(page, blockId, "B", 1);
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport: {
        async sync() {
          return { ok: false, offline: true, problem: { code: "network", message: "offline" } };
        },
        async convertLegacyBranch() {
          throw new Error("unexpected legacy-branch conversion");
        },
      },
    });
    const outcome = await reconciler.synchronize();
    expect(outcome.kind).toBe("offline");
  });

  it("propagates blocking problem codes from the server", async () => {
    const { pageId, blockId, page } = fixture();
    await commitEdit(page, blockId, "B", 1);
    const reconciler = new PageReconciler({
      pageId,
      log,
      transport: {
        async sync() {
          return {
            ok: false,
            offline: false,
            problem: { code: "page-operations.device-revoked", message: "revoked" },
          };
        },
        async convertLegacyBranch() {
          throw new Error("unexpected legacy-branch conversion");
        },
      },
    });
    const outcome = await reconciler.synchronize();
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") {
      expect(outcome.problemCode).toBe("page-operations.device-revoked");
    }
  });
});
