import {
  EncryptedPageOperationLog,
  encodePageOperationBytes,
  installConvertedLegacyPageCheckpoint,
  installPageCheckpoint,
  LegacyConflictRecovery,
  type LegacyRecoveryRevisionResult,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalRecordCodec,
  MemorySecureStorage,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { PageCheckpointResponseDto } from "@myownnotion/contracts";
import { PAGE_OPERATIONAL_VERSION } from "@myownnotion/contracts";
import {
  type BlockDocument,
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  generateUuidV7,
  migrateDocumentV2ToV3,
  type Uuid,
} from "@myownnotion/domain";
import { OperationalPageDocument, verifyLegacyOfflineBranch } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const context = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};

let db: LocalDatabase;
let codec: LocalRecordCodec;
let log: EncryptedPageOperationLog;
let revisions: Map<Uuid, LegacyRecoveryRevisionResult>;
let revisionOffline: boolean;

beforeEach(async () => {
  db = openLocalDatabase(`legacy-conflict-recovery-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  const cipher = new LocalCipher(keys);
  codec = new LocalRecordCodec(cipher, context);
  log = new EncryptedPageOperationLog(db, cipher, context);
  revisions = new Map();
  revisionOffline = false;
});

afterEach(async () => {
  await db.delete();
});

function baseDocument(blockId = generateUuidV7(), text = "base"): BlockDocument {
  return { blocks: [{ type: "paragraph", id: blockId, content: [{ text }] }] };
}

function editedDocument(base: BlockDocument, text: string): BlockDocumentV3 {
  const page = OperationalPageDocument.create({
    pageId: generateUuidV7(),
    document: migrateDocumentV2ToV3(base),
  });
  const firstBlock = base.blocks[0];
  if (firstBlock === undefined) throw new Error("the fixture needs one block");
  const blockId = firstBlock.id;
  const current = "content" in firstBlock ? firstBlock.content : [];
  const length = current.map(({ text: value }) => value).join("").length;
  page.transact([{ type: "replace-text", blockId, from: 0, to: length, text }]);
  return page.snapshot();
}

async function storePage(pageId: Uuid, document: BlockDocument | BlockDocumentV3): Promise<void> {
  const isV3 =
    document.blocks.some(({ type }) =>
      ["toggle", "callout", "table", "image", "embed"].includes(type),
    ) || document.blocks.some((block) => "rawExtraProperties" in block);
  await db.items.put(
    await codec.sealItem({
      id: pageId,
      kind: "page",
      name: "Recovered page",
      icon: null,
      lifecycle: "active",
      currentRevisionId: generateUuidV7(),
      trashedAt: null,
      purgeAfter: null,
      favourite: false,
      offlineIntent: false,
      localAvailability: "present",
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: isV3 ? 3 : 2,
        body: { blocks: structuredClone(document.blocks) },
      },
      file: null,
    }),
  );
}

async function addConflict(input: {
  readonly pageId: Uuid;
  readonly base: BlockDocument;
  readonly local: BlockDocumentV3;
  readonly capturedAt?: string;
  readonly storeCurrent?: BlockDocument | BlockDocumentV3;
}): Promise<{ readonly mutationId: Uuid; readonly baseRevisionId: Uuid }> {
  const mutationId = generateUuidV7();
  const baseRevisionId = generateUuidV7();
  const capturedAt = input.capturedAt ?? "2026-08-25T10:00:00.000Z";
  await storePage(input.pageId, input.storeCurrent ?? input.base);
  revisions.set(baseRevisionId, {
    ok: true,
    value: {
      id: baseRevisionId,
      itemId: input.pageId,
      snapshot: {
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { blocks: structuredClone(input.base.blocks) },
        },
      },
    },
  });
  await db.conflicts.put(
    (await codec.sealConflict({
      mutationId,
      commandType: "page.document.replace",
      payload: {
        itemId: input.pageId,
        baseRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: structuredClone(input.local.blocks) },
        },
      },
      baseRevisionIds: [baseRevisionId],
      localRevisionIds: [],
      competingRevisionIds: [generateUuidV7()],
      capturedAt,
      errorCode: "revision.stale-base",
    })) as never,
  );
  return { mutationId, baseRevisionId };
}

function recovery(): LegacyConflictRecovery {
  return new LegacyConflictRecovery({
    db,
    codec,
    log,
    loadRevision: async (revisionId) => {
      if (revisionOffline) {
        return { ok: false, offline: true, code: "transport.offline" };
      }
      return (
        revisions.get(revisionId) ?? {
          ok: false,
          offline: false,
          code: "revision.snapshot-expired",
        }
      );
    },
    now: () => new Date("2026-08-25T12:00:00.000Z"),
  });
}

async function checkpointResponse(
  pageId: Uuid,
  document: BlockDocumentV3,
): Promise<PageCheckpointResponseDto> {
  const page = OperationalPageDocument.create({ pageId, document });
  const checkpoint = await page.checkpoint();
  const projection = await page.project();
  return {
    mode: "checkpoint",
    requestId: generateUuidV7(),
    pageId,
    operationalVersion: PAGE_OPERATIONAL_VERSION,
    checkpointId: generateUuidV7(),
    checkpointBytes: encodePageOperationBytes(checkpoint.bytes),
    checkpointDigest: checkpoint.digest,
    versionVector: encodePageOperationBytes(checkpoint.versionVector),
    throughPageSequence: 0,
    canonicalDigest: projection.canonicalDigest,
    lastConsolidatedRevisionId: null,
    hasUnconsolidatedChanges: false,
    followingUpdates: [],
    latestPageSequence: 0,
    hasMore: false,
    ambiguities: [],
  };
}

describe("historical page-conflict recovery", () => {
  it("classifies a sealed replacement without deleting it or counting it as an active conflict", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "local draft");
    const { mutationId } = await addConflict({ pageId, base, local });
    const service = recovery();

    await expect(service.classify()).resolves.toEqual({ classified: 1, quarantined: 0 });
    expect(await service.list()).toEqual([
      expect.objectContaining({ mutationId, pageId, status: "pending", reasonCode: null }),
    ]);
    expect(await db.conflicts.get(mutationId)).toBeDefined();
    const outbox = new Outbox(db, codec);
    expect(await outbox.activeConflicts()).toEqual([]);
    expect(await outbox.retainedConflicts()).toHaveLength(1);
  });

  it("builds a sealed semantic branch whose replay exactly matches the retained draft", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "exact recovered draft");
    const { mutationId } = await addConflict({ pageId, base, local });
    const service = recovery();

    await expect(service.recoverAvailable()).resolves.toMatchObject({
      classified: 1,
      prepared: 1,
      quarantined: 0,
      offline: false,
      pageIds: [pageId],
    });
    const row = await db.legacySyncRecoveries.get(mutationId);
    expect(row).toMatchObject({ status: "converting", pageId, reasonCode: null });
    const branch = await log.getLegacyBranch(pageId);
    expect(branch?.branchId).toBe(row?.branchId);
    if (branch === null) throw new Error("the exact branch was not stored");
    const replayed = await verifyLegacyOfflineBranch(branch.branch);
    expect(canonicalDocumentJsonV3(replayed.document)).toBe(canonicalDocumentJsonV3(local));
    expect(await db.conflicts.get(mutationId)).toBeDefined();
  });

  it("archives an already represented draft only after exact canonical equality", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "already present");
    const { mutationId } = await addConflict({
      pageId,
      base,
      local,
      storeCurrent: local,
    });
    await installPageCheckpoint(log, await checkpointResponse(pageId, local));

    await expect(recovery().recoverAvailable()).resolves.toMatchObject({ completed: 1 });
    expect(await db.conflicts.get(mutationId)).toBeUndefined();
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "converted",
      branchId: null,
    });
    expect(await log.getLegacyBranch(pageId)).toBeNull();
  });

  it("keeps one converting row per page and resumes remaining drafts in capture order", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const firstLocal = editedDocument(base, "first offline draft");
    const secondLocal = editedDocument(base, "second offline draft");
    const first = await addConflict({
      pageId,
      base,
      local: firstLocal,
      capturedAt: "2026-08-25T10:00:00.000Z",
    });
    const second = await addConflict({
      pageId,
      base,
      local: secondLocal,
      capturedAt: "2026-08-25T11:00:00.000Z",
    });
    const service = recovery();

    await service.recoverAvailable();
    expect(await db.legacySyncRecoveries.get(first.mutationId)).toMatchObject({
      status: "converting",
    });
    expect(await db.legacySyncRecoveries.get(second.mutationId)).toMatchObject({
      status: "pending",
    });
    const firstBranch = await log.getLegacyBranch(pageId);
    if (firstBranch === null) throw new Error("the first branch was not prepared");
    await installConvertedLegacyPageCheckpoint(
      log,
      await checkpointResponse(pageId, firstLocal),
      firstBranch,
    );

    await expect(service.recoverAvailable()).resolves.toMatchObject({ prepared: 1 });
    expect(await db.legacySyncRecoveries.get(first.mutationId)).toMatchObject({
      status: "converted",
    });
    expect(await db.legacySyncRecoveries.get(second.mutationId)).toMatchObject({
      status: "converting",
    });
    expect((await log.getLegacyBranch(pageId))?.branch.localDocumentDigest).not.toBe(
      firstBranch.branch.localDocumentDigest,
    );
  });

  it("lets two tabs classify and prepare the same source without duplicating its branch", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "one durable branch");
    const { mutationId } = await addConflict({ pageId, base, local });
    const first = recovery();
    const second = recovery();

    const outcomes = await Promise.all([first.recoverAvailable(), second.recoverAvailable()]);

    expect(outcomes.reduce((total, outcome) => total + outcome.prepared, 0)).toBe(1);
    expect(await db.legacyOfflineBranches.count()).toBe(1);
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "converting",
      attemptCount: 1,
    });
    expect(await db.conflicts.get(mutationId)).toBeDefined();
  });

  it("leaves a recoverable pending row when the ancestor is temporarily offline", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "wait for ancestor");
    const { mutationId } = await addConflict({ pageId, base, local });
    revisionOffline = true;

    await expect(recovery().recoverAvailable()).resolves.toMatchObject({
      prepared: 0,
      quarantined: 0,
      offline: true,
    });
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    expect(await db.conflicts.get(mutationId)).toBeDefined();
  });

  it("quarantines an unprovable schema change and retains the complete encrypted source", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const migrated = migrateDocumentV2ToV3(base);
    const migratedBlock = migrated.blocks[0];
    if (migratedBlock?.type !== "paragraph") throw new Error("expected a paragraph fixture");
    const local: BlockDocumentV3 = {
      blocks: [
        {
          ...migratedBlock,
          rawExtraProperties: { futurePrivateProperty: "must-not-be-guessed" },
        },
      ],
    };
    const { mutationId } = await addConflict({ pageId, base, local });

    await expect(recovery().recoverAvailable()).resolves.toMatchObject({ quarantined: 1 });
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "quarantined",
      reasonCode: "legacy-recovery.diff-unprovable",
    });
    expect(await db.conflicts.get(mutationId)).toBeDefined();
    expect(await log.getLegacyBranch(pageId)).toBeNull();
  });

  it("routes an unreadable payload by retained revision metadata without exposing content", async () => {
    const pageId = generateUuidV7();
    const mutationId = generateUuidV7();
    const localRevisionId = generateUuidV7();
    await db.revisionHeaders.put({
      id: localRevisionId,
      itemId: pageId,
      mutationId,
      parentRevisionIds: [],
      acceptedAt: "2026-08-25T10:00:00.000Z",
      local: 1,
    });
    await db.conflicts.put({
      mutationId,
      commandType: "page.document.replace",
      baseRevisionIds: [],
      localRevisionIds: [localRevisionId],
      competingRevisionIds: [],
      capturedAt: "2026-08-25T10:00:00.000Z",
      errorCode: "revision.stale-base",
      sealedPayload: { invalid: "opaque ciphertext" },
    } as never);

    await expect(recovery().classify()).resolves.toEqual({ classified: 1, quarantined: 1 });
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      pageId,
      status: "quarantined",
      reasonCode: "legacy-recovery.payload-unreadable",
    });
    expect(await db.conflicts.get(mutationId)).toBeDefined();
  });

  it("never deletes a source when a converted branch has no active checkpoint proof", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "partial conversion");
    const { mutationId } = await addConflict({ pageId, base, local });
    const service = recovery();
    await service.recoverAvailable();
    const branch = await log.getLegacyBranch(pageId);
    if (branch === null) throw new Error("the conversion branch was not prepared");
    await log.putLegacyBranch({
      ...branch,
      status: "converted",
      recordVersion: branch.recordVersion + 1,
      branch: { ...branch.branch, status: "converted" },
    });

    await expect(service.recoverAvailable()).resolves.toMatchObject({ quarantined: 1 });
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "quarantined",
      reasonCode: "legacy-recovery.integrity-failed",
    });
    expect(await db.conflicts.get(mutationId)).toBeDefined();
  });

  it("finishes an interrupted terminal cleanup only when branch and checkpoint prove conversion", async () => {
    const pageId = generateUuidV7();
    const base = baseDocument();
    const local = editedDocument(base, "converted before renderer crash");
    const { mutationId } = await addConflict({ pageId, base, local });
    const service = recovery();
    await service.recoverAvailable();
    const source = await db.conflicts.get(mutationId);
    const branch = await log.getLegacyBranch(pageId);
    if (source === undefined || branch === null) throw new Error("missing conversion fixture");
    await installConvertedLegacyPageCheckpoint(
      log,
      await checkpointResponse(pageId, local),
      branch,
    );
    // Recreate the only state an old non-atomic renderer could have left:
    // conversion proof is complete but the retained source survived.
    await db.conflicts.put(source);

    await expect(service.recoverAvailable()).resolves.toMatchObject({ completed: 1 });
    expect(await db.conflicts.get(mutationId)).toBeUndefined();
    expect(await db.legacySyncRecoveries.get(mutationId)).toMatchObject({
      status: "converted",
      branchId: branch.branchId,
    });
  });
});
