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
import type { ActivePageSyncRequestDto, ActivePageSyncResponseDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { afterEach, beforeEach, expect, it } from "vitest";

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
