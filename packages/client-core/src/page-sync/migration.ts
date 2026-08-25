/**
 * Atomic installation of operational checkpoints and legacy-branch handover.
 *
 * Checkpoint verification and encryption happen before the IndexedDB write.
 * The conversion commit then installs the active state and marks the exact
 * semantic branch converted in one transaction: after a crash, readers can
 * observe either the complete legacy side or the complete active side, never
 * a half-migrated page.
 */

import type { PageCheckpointResponseDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import type { SealedPageOperationStateRow } from "../local-store/schema.ts";
import type {
  EncryptedPageOperationLog,
  LegacyOfflineBranchRecord,
  PageOperationStateRecord,
} from "./encrypted-update-log.ts";
import { decodePageOperationBytes } from "./encrypted-update-log.ts";
import { withPageStateWrite } from "./page-write-coordinator.ts";

export class ConcurrentPageCheckpointError extends Error {
  constructor() {
    super("the local page checkpoint changed while an operational checkpoint was installed");
    this.name = "ConcurrentPageCheckpointError";
  }
}

export class ConcurrentLegacyPageConversionError extends Error {
  constructor() {
    super("the legacy page branch changed while its operational checkpoint was installed");
    this.name = "ConcurrentLegacyPageConversionError";
  }
}

export class InvalidPageCheckpointResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPageCheckpointResponseError";
  }
}

export type LegacyPageConversionCommitPhase =
  | "before-encryption"
  | "after-encryption"
  | "after-state-write"
  | "after-branch-write"
  | "after-commit";

export interface LegacyPageConversionCommitHooks {
  /** Synchronous by design: asynchronous work can close a Dexie transaction. */
  readonly at?: (phase: LegacyPageConversionCommitPhase) => void;
}

interface PreparedPageCheckpoint {
  readonly state: PageOperationStateRecord;
  readonly sealed: SealedPageOperationStateRow;
}

async function preparePageCheckpoint(
  log: EncryptedPageOperationLog,
  response: PageCheckpointResponseDto,
  now: Date,
): Promise<PreparedPageCheckpoint> {
  const pageId = response.pageId as Uuid;
  const page = await OperationalPageDocument.fromSnapshotTransport({
    pageId,
    snapshotBytes: decodePageOperationBytes(response.checkpointBytes),
    snapshotDigest: response.checkpointDigest,
    versionVector: decodePageOperationBytes(response.versionVector),
  });
  const checkpointProjection = await page.project();
  if (checkpointProjection.canonicalDigest !== response.canonicalDigest) {
    throw new InvalidPageCheckpointResponseError(
      "the checkpoint canonical projection has a bad digest",
    );
  }
  let appliedPageSequence = response.throughPageSequence;
  for (const remote of response.followingUpdates) {
    const bytes = decodePageOperationBytes(remote.updateBytes);
    if ((await sha256Hex(bytes)) !== remote.updateDigest) {
      throw new InvalidPageCheckpointResponseError("a checkpoint update failed its digest check");
    }
    const imported = page.importUpdate(bytes);
    if (imported.pending) {
      throw new InvalidPageCheckpointResponseError("a checkpoint update has missing dependencies");
    }
    appliedPageSequence = remote.pageSequence;
  }
  const [checkpoint, projection] = await Promise.all([page.checkpoint(), page.project()]);
  const state: PageOperationStateRecord = {
    pageId,
    status: "active",
    operationalVersion: response.operationalVersion,
    canonicalFormatVersion: 3,
    latestServerPageSequence: appliedPageSequence,
    localAvailability: "present",
    lastAccessedAt: now.toISOString(),
    recordVersion: 1,
    checkpoint,
    projection,
    versionVector: checkpoint.versionVector,
    frontiers: checkpoint.frontiers,
    serverVersionVector: response.hasMore ? null : checkpoint.versionVector,
  };
  return { state, sealed: await log.codec.sealState(state) };
}

/**
 * Installs a server-created genesis/checkpoint exactly once.
 *
 * The item-kind check belongs to the same IndexedDB transaction as the state
 * write. A page can be converted to a folder while an activation request is in
 * flight; checking before this transaction would let the late response
 * recreate operational authority after the conversion had removed it.
 * `null` means that the local item no longer accepts page authority.
 */
export async function installPageCheckpoint(
  log: EncryptedPageOperationLog,
  response: PageCheckpointResponseDto,
  now: Date = new Date(),
): Promise<PageOperationStateRecord | null> {
  return await withPageStateWrite(log.db, response.pageId as Uuid, async () => {
    const pageId = response.pageId as Uuid;
    const existing = await log.getState(pageId);
    if (existing !== null) {
      const item = await log.db.items.get(pageId);
      return item?.kind === "page" ? existing : null;
    }
    const prepared = await preparePageCheckpoint(log, response, now);
    const installed = await log.db.transaction(
      "rw",
      [log.db.items, log.db.pageOperationStates],
      async () => {
        const [item, currentState] = await Promise.all([
          log.db.items.get(pageId),
          log.db.pageOperationStates.get(pageId),
        ]);
        if (item?.kind !== "page") return false;
        if (currentState !== undefined) {
          throw new ConcurrentPageCheckpointError();
        }
        await log.db.pageOperationStates.add(prepared.sealed);
        return true;
      },
    );
    return installed ? prepared.state : null;
  });
}

/**
 * Commits a successful server conversion as one local state transition.
 *
 * An active state may already exist when another device activated the page.
 * In that case it remains authoritative and only the branch marker changes;
 * the reconciler's following active pass imports the converted operations.
 */
export async function installConvertedLegacyPageCheckpoint(
  log: EncryptedPageOperationLog,
  response: PageCheckpointResponseDto,
  branch: LegacyOfflineBranchRecord,
  now: Date = new Date(),
  hooks: LegacyPageConversionCommitHooks = {},
): Promise<PageOperationStateRecord> {
  const pageId = response.pageId as Uuid;
  if (pageId !== branch.pageId) {
    throw new InvalidPageCheckpointResponseError(
      "the converted checkpoint belongs to another page",
    );
  }
  return await withPageStateWrite(log.db, pageId, async () => {
    const [currentBranch, existingState] = await Promise.all([
      log.getLegacyBranch(pageId),
      log.getState(pageId),
    ]);
    if (currentBranch?.status === "converted" && currentBranch.branchId === branch.branchId) {
      if (existingState === null) {
        throw new ConcurrentLegacyPageConversionError();
      }
      return existingState;
    }
    if (
      currentBranch === null ||
      currentBranch.branchId !== branch.branchId ||
      currentBranch.recordVersion !== branch.recordVersion
    ) {
      throw new ConcurrentLegacyPageConversionError();
    }

    hooks.at?.("before-encryption");
    const prepared =
      existingState === null ? await preparePageCheckpoint(log, response, now) : null;
    const nextBranch: LegacyOfflineBranchRecord = {
      ...currentBranch,
      status: "converted",
      recordVersion: currentBranch.recordVersion + 1,
      branch: { ...currentBranch.branch, status: "converted" },
    };
    const sealedBranch = await log.codec.sealLegacyBranch(nextBranch);
    hooks.at?.("after-encryption");

    await log.db.transaction(
      "rw",
      [log.db.pageOperationStates, log.db.legacyOfflineBranches],
      async () => {
        const [stateRow, branchRow] = await Promise.all([
          log.db.pageOperationStates.get(pageId),
          log.db.legacyOfflineBranches.get(pageId),
        ]);
        if (
          branchRow?.branchId !== currentBranch.branchId ||
          branchRow.recordVersion !== currentBranch.recordVersion ||
          branchRow.status === "converted"
        ) {
          throw new ConcurrentLegacyPageConversionError();
        }
        if (existingState === null) {
          if (stateRow !== undefined || prepared === null) {
            throw new ConcurrentPageCheckpointError();
          }
          await log.db.pageOperationStates.add(prepared.sealed);
          hooks.at?.("after-state-write");
        } else if (stateRow?.recordVersion !== existingState.recordVersion) {
          throw new ConcurrentPageCheckpointError();
        }
        await log.db.legacyOfflineBranches.put(sealedBranch);
        hooks.at?.("after-branch-write");
      },
    );
    hooks.at?.("after-commit");
    if (prepared !== null) return prepared.state;
    if (existingState === null) throw new ConcurrentPageCheckpointError();
    return existingState;
  });
}
