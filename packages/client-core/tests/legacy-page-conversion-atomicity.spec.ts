import {
  EncryptedPageOperationLog,
  encodePageOperationBytes,
  installConvertedLegacyPageCheckpoint,
  type LegacyOfflineBranchRecord,
  type LegacyPageConversionCommitPhase,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  MemorySecureStorage,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { PageCheckpointResponseDto } from "@myownnotion/contracts";
import { PAGE_OPERATIONAL_VERSION } from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { createLegacyOfflineBranch, OperationalPageDocument } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`legacy-conversion-atomicity-${generateUuidV7()}`);
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

async function conversionFixture(): Promise<{
  readonly branch: LegacyOfflineBranchRecord;
  readonly response: PageCheckpointResponseDto;
  readonly recoveryMutationId: ReturnType<typeof generateUuidV7>;
  readonly localRevisionId: ReturnType<typeof generateUuidV7>;
  readonly canonicalRevisionId: ReturnType<typeof generateUuidV7>;
}> {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const localRevisionId = generateUuidV7();
  const canonicalRevisionId = generateUuidV7();
  const semanticBranch = await createLegacyOfflineBranch({
    branchId: generateUuidV7(),
    pageId,
    baseRevisionId: generateUuidV7(),
    baseDocument: { blocks: [] },
    createdAt: "2026-08-24T10:00:00.000Z",
  });
  const branch: LegacyOfflineBranchRecord = {
    pageId,
    branchId: semanticBranch.branchId,
    status: "editing",
    createdAt: semanticBranch.createdAt,
    recordVersion: 1,
    branch: semanticBranch,
    requiredFileIds: [],
  };
  await log.putLegacyBranch(branch);
  const recoveryMutationId = generateUuidV7();
  await db.conflicts.put({
    mutationId: recoveryMutationId,
    commandType: "page.document.replace",
    payload: { itemId: pageId },
    baseRevisionIds: [semanticBranch.baseRevisionId],
    localRevisionIds: [localRevisionId],
    competingRevisionIds: [],
    capturedAt: semanticBranch.createdAt,
    errorCode: "revision.conflict",
  });
  await db.legacySyncRecoveries.put({
    mutationId: recoveryMutationId,
    pageId,
    status: "converting",
    reasonCode: null,
    branchId: branch.branchId,
    attemptCount: 1,
    capturedAt: semanticBranch.createdAt,
    updatedAt: semanticBranch.createdAt,
  });
  await db.revisionHeaders.put({
    id: localRevisionId,
    itemId: pageId,
    mutationId: recoveryMutationId,
    parentRevisionIds: [semanticBranch.baseRevisionId],
    acceptedAt: semanticBranch.createdAt,
    local: 1,
  });
  await db.items.put({
    id: pageId,
    kind: "page",
    lifecycle: "active",
    currentRevisionId: localRevisionId,
    favourite: false,
    offlineIntent: false,
    localAvailability: "present",
    trashedAt: null,
    purgeAfter: null,
    hasPageDocument: 1,
    sealedName: { opaque: "not opened by routing migration" },
    sealedPageBody: { opaque: "not opened by routing migration" },
    sealedFile: null,
  } as never);

  const page = OperationalPageDocument.create({
    pageId,
    document: {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "durable conversion" }] }],
    },
  });
  const checkpoint = await page.checkpoint();
  const projection = await page.project();
  return {
    branch,
    recoveryMutationId,
    localRevisionId,
    canonicalRevisionId,
    response: {
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
      lastConsolidatedRevisionId: canonicalRevisionId,
      hasUnconsolidatedChanges: false,
      followingUpdates: [],
      latestPageSequence: 0,
      hasMore: false,
      ambiguities: [],
    },
  };
}

describe("atomic legacy page conversion", () => {
  it.each([
    "before-encryption",
    "after-encryption",
    "after-state-write",
    "after-branch-write",
    "after-recovery-write",
  ] as const)("keeps the complete legacy side when %s fails", async (failingPhase) => {
    const { branch, response, recoveryMutationId, localRevisionId } = await conversionFixture();

    await expect(
      installConvertedLegacyPageCheckpoint(log, response, branch, new Date(), {
        at(phase: LegacyPageConversionCommitPhase) {
          if (phase === failingPhase) throw new Error(`injected:${phase}`);
        },
      }),
    ).rejects.toThrow(`injected:${failingPhase}`);

    expect(await log.getState(branch.pageId)).toBeNull();
    expect(await log.getLegacyBranch(branch.pageId)).toMatchObject({
      branchId: branch.branchId,
      status: "editing",
      recordVersion: 1,
    });
    expect(await db.conflicts.get(recoveryMutationId)).toBeDefined();
    expect(await db.legacySyncRecoveries.get(recoveryMutationId)).toMatchObject({
      status: "converting",
      branchId: branch.branchId,
    });
    expect(await db.revisionHeaders.get(localRevisionId)).toMatchObject({ local: 1 });
    expect((await db.items.get(branch.pageId))?.currentRevisionId).toBe(localRevisionId);
  });

  it("keeps both active state and converted marker after a caller crash", async () => {
    const { branch, response, recoveryMutationId, localRevisionId, canonicalRevisionId } =
      await conversionFixture();

    await expect(
      installConvertedLegacyPageCheckpoint(log, response, branch, new Date(), {
        at(phase) {
          if (phase === "after-commit") throw new Error("simulated renderer crash");
        },
      }),
    ).rejects.toThrow("simulated renderer crash");

    expect(await log.getState(branch.pageId)).toMatchObject({ status: "active" });
    expect(await log.getLegacyBranch(branch.pageId)).toMatchObject({
      branchId: branch.branchId,
      status: "converted",
      recordVersion: 2,
    });
    expect(await db.conflicts.get(recoveryMutationId)).toBeUndefined();
    expect(await db.legacySyncRecoveries.get(recoveryMutationId)).toMatchObject({
      status: "converted",
      branchId: branch.branchId,
    });
    expect(await db.revisionHeaders.get(localRevisionId)).toMatchObject({
      local: 0,
      canonicalRevisionId,
    });
    expect((await db.items.get(branch.pageId))?.currentRevisionId).toBe(canonicalRevisionId);

    await expect(
      installConvertedLegacyPageCheckpoint(log, response, branch),
    ).resolves.toMatchObject({ status: "active" });
  });
});
