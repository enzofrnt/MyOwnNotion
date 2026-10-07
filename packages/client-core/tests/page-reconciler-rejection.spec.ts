import {
  EncryptedPageOperationLog,
  encodePageOperationBytes,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  PageEditingSession,
  PageReconciler,
  type PageSyncTransport,
} from "@myownnotion/client-core";
import type {
  ActivePageSyncRequestDto,
  ActivePageSyncResponseDto,
  PageAmbiguityDetailDto,
  PageAmbiguitySummaryDto,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  OperationalPageDocument,
  sha256Hex,
} from "@myownnotion/page-state";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const context = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};
let db: LocalDatabase;
let cipher: LocalCipher;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`page-response-rejection-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  cipher = new LocalCipher(keys);
  log = new EncryptedPageOperationLog(db, cipher, context);
});

function ambiguityFixture(pageId: Uuid, withRecovery: boolean) {
  const blockId = generateUuidV7();
  const block = {
    id: blockId,
    type: "paragraph" as const,
    content: [{ text: "Retained intention" }],
  };
  const otherIntention = { ...block, content: [{ text: "Other intention" }] };
  const summary: PageAmbiguitySummaryDto = {
    ambiguityId: generateUuidV7(),
    pageId,
    kind: "delete-edit",
    blockIds: [blockId],
    openedAt: "2026-10-07T10:00:00.000Z",
    status: "open",
  };
  const detail: PageAmbiguityDetailDto = {
    ...summary,
    logicalKey: `block:${blockId}`,
    sourceUpdateIds: [generateUuidV7(), generateUuidV7()],
    deletedSubtree: withRecovery ? block : null,
    recoverableSubtree: withRecovery ? block : null,
    recoverablePlacement: withRecovery ? { parentBlockId: null, beforeBlockId: null } : null,
    propertyKey: withRecovery ? "type" : null,
    alternatives: withRecovery ? [block, otherIntention] : null,
  };
  return { summary, detail };
}

it.each([false, true])(
  "persists ambiguity details, reuses them across startup confirmations and retires resolved records (recovery=%s)",
  async (withRecovery) => {
    const fixture = await scenario(false);
    const { summary, detail } = ambiguityFixture(fixture.pageId, withRecovery);
    let open = true;
    const getAmbiguity = vi.fn(async () => ({ ok: true as const, value: detail }));
    const reconciler = new PageReconciler({
      pageId: fixture.pageId,
      log,
      transport: {
        ...transportFor(async (_pageId, request) => ({
          ...(await fixture.healthy(request)),
          ambiguities: open ? [summary] : [],
        })),
        getAmbiguity,
      },
    });
    await expect(reconciler.synchronize()).resolves.toMatchObject({
      kind: "synced",
      latestPageSequence: 2,
    });
    const stored = await db.pageAmbiguities.get(summary.ambiguityId as Uuid);
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain("Retained intention");
    expect(await log.codec.openAmbiguity(stored as never)).toMatchObject({
      status: "open",
      details: { logicalKey: detail.logicalKey, sourceUpdateIds: detail.sourceUpdateIds },
    });
    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(getAmbiguity).toHaveBeenCalledExactlyOnceWith(summary.ambiguityId);
    expect(await db.pageAmbiguities.get(summary.ambiguityId as Uuid)).toEqual(stored);
    open = false;
    await expect(reconciler.synchronize()).resolves.toMatchObject({ kind: "synced" });
    expect(await db.pageAmbiguities.get(summary.ambiguityId as Uuid)).toBeUndefined();
    expect((await log.getState(fixture.pageId))?.projection?.document).toEqual(
      (await fixture.server.project()).document,
    );
  },
);

it.each(["missing reader", "offline", "server refusal"])(
  "keeps the local page and its exact write when ambiguity detail is unavailable: %s",
  async (failure) => {
    const fixture = await scenario(true);
    const { summary } = ambiguityFixture(fixture.pageId, false);
    const transport: PageSyncTransport = {
      ...transportFor(async (_pageId, request) => ({
        ...(await fixture.healthy(request)),
        ambiguities: [summary],
      })),
      ...(failure === "missing reader"
        ? {}
        : {
            getAmbiguity: async () => ({
              ok: false as const,
              offline: failure === "offline",
              problem: {
                code: "ambiguity.unavailable",
                message: "Cannot read retained intentions",
              },
            }),
          }),
    };
    await expect(
      new PageReconciler({ pageId: fixture.pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({
      kind: failure === "offline" ? "offline" : "blocked",
      latestPageSequence: 1,
      problemCode:
        failure === "missing reader"
          ? "page-operations.ambiguity-detail-unavailable"
          : "ambiguity.unavailable",
    });
    expect(await db.pageOperationStates.get(fixture.pageId)).toEqual(fixture.stateBefore);
    expect(await log.listUpdates(fixture.pageId)).toEqual([
      expect.objectContaining({
        updateId: fixture.pending?.update.updateId,
        updateBytes: fixture.pending?.update.updateBytes,
        status: failure === "offline" ? "pending" : "blocked",
      }),
    ]);
    expect(await db.pageAmbiguities.count()).toBe(0);
  },
);

it.each(["identity", "page", "kind", "status", "openedAt", "block count", "block identity"])(
  "rejects ambiguity detail inconsistent with its summary (%s), preserving local content",
  async (failure) => {
    const fixture = await scenario(true);
    const { summary, detail } = ambiguityFixture(fixture.pageId, true);
    const mismatched: PageAmbiguityDetailDto = {
      ...detail,
      ...(failure === "identity" ? { ambiguityId: generateUuidV7() } : {}),
      ...(failure === "page" ? { pageId: generateUuidV7() } : {}),
      ...(failure === "kind" ? { kind: "delete-move" as const } : {}),
      ...(failure === "status" ? { status: "resolved-keep" as const } : {}),
      ...(failure === "openedAt" ? { openedAt: "2026-10-06T10:00:00.000Z" } : {}),
      ...(failure === "block count" ? { blockIds: [] } : {}),
      ...(failure === "block identity" ? { blockIds: [generateUuidV7()] } : {}),
    };
    const transport: PageSyncTransport = {
      ...transportFor(async (_pageId, request) => ({
        ...(await fixture.healthy(request)),
        ambiguities: [summary],
      })),
      getAmbiguity: async () => ({ ok: true, value: mismatched }),
    };
    await expect(
      new PageReconciler({ pageId: fixture.pageId, log, transport }).synchronize(),
    ).resolves.toMatchObject({
      kind: "blocked",
      problemCode: "page-operations.projection-invalid",
      latestPageSequence: 1,
    });
    expect(await db.pageOperationStates.get(fixture.pageId)).toEqual(fixture.stateBefore);
    expect((await log.listUpdates(fixture.pageId))[0]).toMatchObject({
      updateId: fixture.pending?.update.updateId,
      updateBytes: fixture.pending?.update.updateBytes,
      status: "blocked",
    });
    expect(await db.pageAmbiguities.count()).toBe(0);
  },
);

it.each(["request identity", "page identity", "response mode"])(
  "releases the claimed offline write when the active response changes %s",
  async (failure) => {
    const fixture = await scenario(true);
    const transport: PageSyncTransport = {
      async sync(pageId, request) {
        if (request.mode !== "active") throw new Error("expected active request");
        if (failure === "response mode") {
          const checkpoint = await fixture.server.checkpoint();
          return {
            ok: true,
            value: {
              mode: "checkpoint",
              requestId: request.requestId,
              pageId,
              operationalVersion: 1,
              checkpointId: generateUuidV7(),
              checkpointBytes: encodePageOperationBytes(checkpoint.bytes),
              checkpointDigest: checkpoint.digest,
              versionVector: encodePageOperationBytes(checkpoint.versionVector),
              throughPageSequence: 2,
              canonicalDigest: (await fixture.server.project()).canonicalDigest,
              lastConsolidatedRevisionId: null,
              hasUnconsolidatedChanges: true,
              followingUpdates: [],
              latestPageSequence: 2,
              hasMore: false,
              ambiguities: [],
            },
          };
        }
        return {
          ok: true,
          value: {
            ...(await fixture.healthy(request)),
            ...(failure === "request identity" ? { requestId: generateUuidV7() } : {}),
            ...(failure === "page identity" ? { pageId: generateUuidV7() } : {}),
          },
        };
      },
      async convertLegacyBranch() {
        throw new Error("unexpected conversion");
      },
    };
    await expect(
      new PageReconciler({ pageId: fixture.pageId, log, transport }).synchronize(),
    ).rejects.toThrow();
    expect(await db.pageOperationStates.get(fixture.pageId)).toEqual(fixture.stateBefore);
    expect((await log.listUpdates(fixture.pageId))[0]).toMatchObject({
      updateId: fixture.pending?.update.updateId,
      updateBytes: fixture.pending?.update.updateBytes,
      status: "pending",
    });
  },
);

it("keeps a committed page synchronized even if disposed surfaces or file observers reject publication", async () => {
  const fixture = await scenario(true);
  const errors: unknown[] = [];
  const reconciler = new PageReconciler({
    pageId: fixture.pageId,
    log,
    transport: transportFor(async (_pageId, request) => fixture.healthy(request)),
    onDurablePage: async () => {
      throw new Error("disposed editor");
    },
    onFileRequirements: () => {
      throw new Error("disposed transfer observer");
    },
    onBackgroundError: (error) => errors.push(error),
  });
  reconciler.subscribeDurablePage(async () => {
    throw new Error("disposed listener");
  });
  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "synced",
    latestPageSequence: 3,
  });
  expect(errors.map((error) => (error as Error).message)).toEqual(
    expect.arrayContaining(["disposed editor", "disposed transfer observer", "disposed listener"]),
  );
  expect(await log.listUpdates(fixture.pageId)).toEqual([]);
  expect((await log.getState(fixture.pageId))?.projection?.document).toEqual(
    (await fixture.server.project()).document,
  );
});

it("does not replay a page to a surface disposed while its initial durable read is pending", async () => {
  const fixture = await scenario(false);
  const state = await log.getState(fixture.pageId);
  let resolve!: (value: typeof state) => void;
  const deferredRead = new Promise<typeof state>((complete) => {
    resolve = complete;
  });
  const read = vi.spyOn(log, "getState").mockImplementationOnce(async () => deferredRead);
  const listener = vi.fn();
  const reconciler = new PageReconciler({
    pageId: fixture.pageId,
    log,
    transport: transportFor(async (_pageId, request) => fixture.healthy(request)),
  });
  const unsubscribe = reconciler.subscribeDurablePage(listener);
  unsubscribe();
  resolve(state);
  await deferredRead;
  await reconciler.synchronize();
  expect(listener).not.toHaveBeenCalled();
  read.mockRestore();
});

it("retains retryable server refusal as pending and resumes the same durable write", async () => {
  const fixture = await scenario(true);
  let refused = true;
  const transport: PageSyncTransport = {
    async sync(_pageId, request) {
      if (request.mode !== "active") throw new Error("expected active request");
      if (refused)
        return {
          ok: false,
          offline: false,
          problem: { code: "service.unavailable", message: "retry later" },
        };
      return { ok: true, value: await fixture.healthy(request) };
    },
    async convertLegacyBranch() {
      throw new Error("unexpected conversion");
    },
  };
  const reconciler = new PageReconciler({ pageId: fixture.pageId, log, transport });
  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "pending",
    problemCode: "service.unavailable",
  });
  expect((await log.listUpdates(fixture.pageId))[0]).toMatchObject({
    status: "pending",
    updateId: fixture.pending?.update.updateId,
    updateBytes: fixture.pending?.update.updateBytes,
  });
  refused = false;
  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "synced",
    latestPageSequence: 3,
  });
  expect(await log.listUpdates(fixture.pageId)).toEqual([]);
});

it("stops at the configured exchange budget with durable progress then resumes normally", async () => {
  const fixture = await scenario(false);
  const limited = new PageReconciler({
    pageId: fixture.pageId,
    log,
    maxExchanges: 1,
    transport: transportFor(async (_pageId, request) => ({
      ...(await fixture.healthy(request)),
      hasMore: true,
    })),
  });
  await expect(limited.synchronize()).resolves.toMatchObject({
    kind: "pending",
    exchanges: 1,
    latestPageSequence: 2,
    problemCode: "page-operations.exchange-limit",
  });
  expect((await log.getState(fixture.pageId))?.projection?.document).toEqual(
    (await fixture.server.project()).document,
  );
  await expect(
    new PageReconciler({
      pageId: fixture.pageId,
      log,
      transport: transportFor(async (_pageId, request) => fixture.healthy(request)),
    }).synchronize(),
  ).resolves.toMatchObject({ kind: "synced", latestPageSequence: 2 });
});

it.each(["request identity", "page identity", "response mode"])(
  "retains an offline legacy branch when its handover changes %s, then retries the same journal",
  async (failure) => {
    const pageId = generateUuidV7();
    let branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: { blocks: [] },
      createdAt: "2026-10-07T10:00:00.000Z",
    });
    branch = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands: [
        {
          type: "insert-block",
          block: {
            id: generateUuidV7(),
            type: "paragraph",
            content: [{ text: "Retained offline branch" }],
          },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ],
    });
    await log.putLegacyBranch({
      pageId,
      branchId: branch.branchId,
      status: "editing",
      createdAt: branch.createdAt,
      recordVersion: 1,
      requiredFileIds: [],
      branch,
    });
    const storedBefore = await db.legacyOfflineBranches.get(pageId);
    const server = OperationalPageDocument.create({ pageId, document: branch.localDocument });
    const checkpoint = await server.checkpoint();
    const projected = await server.project();
    let invalid = true;
    const transport: PageSyncTransport = {
      async sync(_pageId, request) {
        if (request.mode !== "active") throw new Error("expected active request after conversion");
        return { ok: true, value: await responseFor(request, server, 0, []) };
      },
      async convertLegacyBranch(_pageId, request) {
        expect(request.branchId).toBe(branch.branchId);
        expect(request.semanticTransactions.map(({ transactionId }) => transactionId)).toEqual(
          branch.semanticTransactions.map(({ transactionId }) => transactionId),
        );
        if (invalid && failure === "response mode") {
          return {
            ok: true,
            value: {
              mode: "active",
              requestId: request.requestId,
              pageId,
              accepted: [],
              repeated: [],
              remoteUpdates: [],
              serverVersionVector: encodePageOperationBytes(checkpoint.versionVector),
              latestPageSequence: 0,
              throughPageSequence: 0,
              hasMore: false,
              canonical: {
                format: "myownnotion.document+json",
                formatVersion: 3,
                digest: projected.canonicalDigest,
                lastConsolidatedRevisionId: null,
                hasUnconsolidatedChanges: false,
              },
              ambiguities: [],
              fileRequirements: [],
            },
          };
        }
        return {
          ok: true,
          value: {
            mode: "checkpoint",
            requestId:
              invalid && failure === "request identity" ? generateUuidV7() : request.requestId,
            pageId: invalid && failure === "page identity" ? generateUuidV7() : pageId,
            operationalVersion: 1,
            checkpointId: generateUuidV7(),
            checkpointBytes: encodePageOperationBytes(checkpoint.bytes),
            checkpointDigest: checkpoint.digest,
            versionVector: encodePageOperationBytes(checkpoint.versionVector),
            throughPageSequence: 0,
            latestPageSequence: 0,
            canonicalDigest: projected.canonicalDigest,
            lastConsolidatedRevisionId: null,
            hasUnconsolidatedChanges: false,
            followingUpdates: [],
            hasMore: false,
            ambiguities: [],
          },
        };
      },
    };
    const reconciler = new PageReconciler({ pageId, log, transport });
    await expect(reconciler.convertLegacyBranch()).rejects.toThrow();
    expect(await db.legacyOfflineBranches.get(pageId)).toEqual(storedBefore);
    expect(await log.getState(pageId)).toBeNull();
    invalid = false;
    await expect(reconciler.convertLegacyBranch()).resolves.toMatchObject({ kind: "synced" });
    expect(await log.getLegacyBranch(pageId)).toMatchObject({
      status: "converted",
      branch: { localDocument: branch.localDocument },
    });
    expect((await log.getState(pageId))?.projection?.document).toEqual(branch.localDocument);
  },
);
afterEach(async () => await db.delete());

function transportFor(
  sync: (pageId: Uuid, request: ActivePageSyncRequestDto) => Promise<ActivePageSyncResponseDto>,
): PageSyncTransport {
  return {
    async sync(pageId, request) {
      if (request.mode !== "active") throw new Error("expected active fixture request");
      return { ok: true, value: await sync(pageId, request) };
    },
    async convertLegacyBranch() {
      throw new Error("unexpected legacy conversion");
    },
  };
}

async function responseFor(
  request: ActivePageSyncRequestDto,
  page: OperationalPageDocument,
  latestPageSequence: number,
  accepted: ActivePageSyncResponseDto["accepted"],
  remoteUpdates: ActivePageSyncResponseDto["remoteUpdates"] = [],
): Promise<ActivePageSyncResponseDto> {
  return {
    mode: "active",
    requestId: request.requestId,
    pageId: page.pageId,
    accepted,
    repeated: [],
    remoteUpdates,
    serverVersionVector: encodePageOperationBytes(page.versionVectorBytes()),
    latestPageSequence,
    throughPageSequence: latestPageSequence,
    hasMore: false,
    canonical: {
      format: "myownnotion.document+json",
      formatVersion: 3,
      digest: (await page.project()).canonicalDigest,
      lastConsolidatedRevisionId: null,
      hasUnconsolidatedChanges: true,
    },
    ambiguities: [],
    fileRequirements: [],
  };
}

async function scenario(withPendingWrite: boolean) {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const page = OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ id: blockId, type: "paragraph", content: [{ text: "A" }] }] },
  });
  const append = (document: OperationalPageDocument, text: string) => {
    const block = document.snapshot().blocks[0];
    if (block?.type !== "paragraph") throw new Error("expected paragraph fixture");
    const end = block.content.map(({ text: value }) => value).join("").length;
    return document.transact([{ type: "replace-text", blockId, from: end, to: end, text }]);
  };
  const store = new LocalPageStateStore(log);
  const seed = await store.commitLocalTransaction({
    page,
    transaction: append(page, " confirmed"),
    updateId: generateUuidV7(),
    enqueueOrder: 1,
  });
  // Establish the baseline through the same public reconciliation path. A
  // positive durable cursor makes a regressive response meaningful.
  await expect(
    new PageReconciler({
      pageId,
      log,
      transport: transportFor(async (_pageId, request) =>
        responseFor(request, page, 1, [
          {
            updateId: seed.update.updateId,
            pageSequence: 1,
            resultVersionVector: encodePageOperationBytes(seed.update.resultVersionVector),
          },
        ]),
      ),
    }).synchronize(),
  ).resolves.toMatchObject({ kind: "synced", latestPageSequence: 1 });
  const baseline = await log.getState(pageId);
  if (baseline?.checkpoint == null) throw new Error("missing confirmed checkpoint");

  const pending = withPendingWrite
    ? await store.commitLocalTransaction({
        page,
        transaction: append(page, " private local edit"),
        updateId: generateUuidV7(),
        enqueueOrder: 2,
      })
    : null;
  const server = await OperationalPageDocument.fromCheckpoint({
    pageId,
    checkpoint: baseline.checkpoint,
  });
  if (pending !== null) server.importUpdate(pending.update.updateBytes);
  const remote = append(server, " remote edit");
  const remoteUpdate = {
    updateId: generateUuidV7(),
    pageSequence: pending === null ? 2 : 3,
    authoredByDeviceId: generateUuidV7(),
    updateBytes: encodePageOperationBytes(remote.updateBytes),
    updateDigest: await sha256Hex(remote.updateBytes),
    acceptedAt: "2026-09-05T12:00:00.000Z",
  };
  // A concurrent real branch lacks the local author's operation. It is a
  // valid Loro vector, but cannot prove acceptance of that local write.
  const concurrent = await OperationalPageDocument.fromCheckpoint({
    pageId,
    checkpoint: baseline.checkpoint,
  });
  append(concurrent, " independent edit");

  return {
    pageId,
    pending,
    baseline,
    initialVersionVector: seed.update.baseVersionVector,
    server,
    concurrent,
    stateBefore: await db.pageOperationStates.get(pageId),
    openedBefore: await log.getState(pageId),
    healthy: async (request: ActivePageSyncRequestDto) =>
      responseFor(
        request,
        server,
        remoteUpdate.pageSequence,
        pending === null
          ? []
          : [
              {
                updateId: pending.update.updateId,
                pageSequence: 2,
                resultVersionVector: encodePageOperationBytes(pending.update.resultVersionVector),
              },
            ],
        [remoteUpdate],
      ),
  };
}

it.each([
  "foreign acknowledgement",
  "regressive acknowledged frontier",
  "incompatible server frontier",
  "remote reuse of a local identity",
] as const)("retains the complete local write after %s", async (failure) => {
  const fixture = await scenario(true);
  const { pending } = fixture;
  if (pending === null) throw new Error("missing pending fixture write");
  let exchanges = 0;
  const reconciler = new PageReconciler({
    pageId: fixture.pageId,
    log,
    transport: transportFor(async (_pageId, request) => {
      exchanges++;
      expect(request.updates.map(({ updateId }) => updateId)).toEqual([pending.update.updateId]);
      const response = await fixture.healthy(request);
      switch (failure) {
        case "foreign acknowledgement":
          return {
            ...response,
            accepted: response.accepted.map((ack) => ({ ...ack, updateId: generateUuidV7() })),
          };
        case "regressive acknowledged frontier":
          return {
            ...response,
            accepted: response.accepted.map((ack) => ({
              ...ack,
              resultVersionVector: encodePageOperationBytes(pending.update.baseVersionVector),
            })),
          };
        case "incompatible server frontier":
          return {
            ...response,
            serverVersionVector: encodePageOperationBytes(fixture.concurrent.versionVectorBytes()),
          };
        case "remote reuse of a local identity":
          return {
            ...response,
            remoteUpdates: response.remoteUpdates.map((update) => ({
              ...update,
              updateId: pending.update.updateId,
            })),
          };
      }
    }),
  });
  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "blocked",
    problemCode: "page-operations.projection-invalid",
    latestPageSequence: 1,
  });
  expect(exchanges).toBe(1);
  expect(await db.pageOperationStates.get(fixture.pageId)).toEqual(fixture.stateBefore);
  expect(await log.getState(fixture.pageId)).toEqual(fixture.openedBefore);
  expect(await log.listUpdates(fixture.pageId)).toEqual([
    { ...pending.update, status: "blocked", recordVersion: pending.update.recordVersion + 2 },
  ]);

  // Reopen IndexedDB and the editing session, without resetting blocked status
  // through an unused repository helper: the author's exact content survives.
  const reopened = openLocalDatabase(db.name);
  try {
    const recoveredLog = new EncryptedPageOperationLog(reopened, cipher, context);
    const editor = await PageEditingSession.resume({
      pageId: fixture.pageId,
      log: recoveredLog,
      store: new LocalPageStateStore(recoveredLog),
    });
    expect(editor?.read()).toEqual(fixture.openedBefore?.projection?.document);
    expect((await recoveredLog.getUpdate(pending.update.updateId))?.updateBytes).toEqual(
      pending.update.updateBytes,
    );
  } finally {
    reopened.close();
  }
});

it.each([
  "corrupt remote digest",
  "omitted announced frontier",
  "regressive server cursor",
  "regressive server frontier",
] as const)("preserves the checkpoint after %s and resumes a healthy pull", async (failure) => {
  const fixture = await scenario(false);
  let exchanges = 0;
  const reconciler = new PageReconciler({
    pageId: fixture.pageId,
    log,
    maxExchanges: 1,
    transport: transportFor(async (_pageId, request) => {
      exchanges++;
      expect(request.updates).toEqual([]);
      expect(request.knownServerPageSequence).toBe(1);
      const response = await fixture.healthy(request);
      if (exchanges > 1) return response;
      switch (failure) {
        case "corrupt remote digest":
          return {
            ...response,
            remoteUpdates: response.remoteUpdates.map((update) => ({
              ...update,
              updateDigest: "0".repeat(64),
            })),
          };
        case "omitted announced frontier":
          return { ...response, remoteUpdates: [] };
        case "regressive server cursor":
          return { ...response, throughPageSequence: 0 };
        case "regressive server frontier":
          return {
            ...response,
            serverVersionVector: encodePageOperationBytes(fixture.initialVersionVector),
          };
      }
    }),
  });
  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "blocked",
    problemCode: "page-operations.projection-invalid",
    latestPageSequence: 1,
  });
  expect(exchanges).toBe(1);
  expect(await db.pageOperationStates.get(fixture.pageId)).toEqual(fixture.stateBefore);
  expect(await log.getState(fixture.pageId)).toEqual(fixture.openedBefore);
  expect(await log.listUpdates(fixture.pageId)).toEqual([]);

  await expect(reconciler.synchronize()).resolves.toMatchObject({
    kind: "synced",
    latestPageSequence: 2,
  });
  expect(exchanges).toBe(2);
  const recovered = await log.getState(fixture.pageId);
  expect(recovered?.projection?.document).toEqual((await fixture.server.project()).document);
  expect(recovered?.checkpoint?.versionVector).toEqual(fixture.server.versionVectorBytes());
  expect(recovered?.serverVersionVector).toEqual(fixture.server.versionVectorBytes());
  expect(await log.listUpdates(fixture.pageId)).toEqual([]);
});
