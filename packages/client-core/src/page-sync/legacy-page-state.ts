/** Atomic encrypted persistence for a not-yet-activated page branch. */

import type { Uuid } from "@myownnotion/domain";
import type { LegacyOfflineBranch } from "@myownnotion/page-state";
import type {
  EncryptedPageOperationLog,
  LegacyOfflineBranchRecord,
} from "./encrypted-update-log.ts";
import { withPageStateWrite } from "./page-write-coordinator.ts";

export type LegacyPageCommitPhase =
  | "before-encryption"
  | "after-encryption"
  | "after-branch-write"
  | "after-commit";

export interface LegacyPageCommitHooks {
  /** Synchronous by design: asynchronous work can close a Dexie transaction. */
  readonly at?: (phase: LegacyPageCommitPhase) => void;
}

export interface CommitLegacyPageBranchInput {
  readonly branch: LegacyOfflineBranch;
  readonly requiredFileIds: readonly Uuid[];
  readonly expectedRecordVersion: number;
}

export interface LegacyPageBranchCommitter {
  commitLegacyBranch(input: CommitLegacyPageBranchInput): Promise<LegacyOfflineBranchRecord>;
}

export class ConcurrentLegacyPageBranchError extends Error {
  constructor() {
    super("the legacy page branch advanced in another tab before this transaction committed");
    this.name = "ConcurrentLegacyPageBranchError";
  }
}

function sameTransactions(
  left: LegacyOfflineBranch["semanticTransactions"],
  right: LegacyOfflineBranch["semanticTransactions"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertAppendOnly(
  previous: LegacyOfflineBranchRecord | null,
  next: LegacyOfflineBranch,
): void {
  if (previous === null) return;
  if (
    previous.branchId !== next.branchId ||
    previous.branch.baseRevisionId !== next.baseRevisionId ||
    previous.branch.baseCanonicalDigest !== next.baseCanonicalDigest ||
    previous.createdAt !== next.createdAt
  ) {
    throw new ConcurrentLegacyPageBranchError();
  }
  const retained = next.semanticTransactions.slice(0, previous.branch.semanticTransactions.length);
  if (!sameTransactions(previous.branch.semanticTransactions, retained)) {
    throw new TypeError("legacy page transactions are append-only");
  }
}

export class LegacyPageStateStore implements LegacyPageBranchCommitter {
  readonly #log: EncryptedPageOperationLog;
  readonly #hooks: LegacyPageCommitHooks;

  constructor(log: EncryptedPageOperationLog, hooks: LegacyPageCommitHooks = {}) {
    this.#log = log;
    this.#hooks = hooks;
  }

  async commitLegacyBranch(input: CommitLegacyPageBranchInput): Promise<LegacyOfflineBranchRecord> {
    if (!Number.isInteger(input.expectedRecordVersion) || input.expectedRecordVersion < 0) {
      throw new TypeError("expectedRecordVersion must be a non-negative integer");
    }
    return await withPageStateWrite(this.#log.db, input.branch.pageId, async () => {
      const previous = await this.#log.getLegacyBranch(input.branch.pageId);
      if ((previous?.recordVersion ?? 0) !== input.expectedRecordVersion) {
        throw new ConcurrentLegacyPageBranchError();
      }
      assertAppendOnly(previous, input.branch);
      this.#hooks.at?.("before-encryption");
      const record: LegacyOfflineBranchRecord = {
        pageId: input.branch.pageId,
        branchId: input.branch.branchId,
        status: input.branch.status,
        createdAt: input.branch.createdAt,
        recordVersion: input.expectedRecordVersion + 1,
        branch: input.branch,
        requiredFileIds: [...new Set(input.requiredFileIds)].sort(),
      };
      const sealed = await this.#log.codec.sealLegacyBranch(record);
      this.#hooks.at?.("after-encryption");
      await this.#log.db.transaction("rw", this.#log.db.legacyOfflineBranches, async () => {
        const current = await this.#log.db.legacyOfflineBranches.get(input.branch.pageId);
        if ((current?.recordVersion ?? 0) !== input.expectedRecordVersion) {
          throw new ConcurrentLegacyPageBranchError();
        }
        await this.#log.db.legacyOfflineBranches.put(sealed);
        this.#hooks.at?.("after-branch-write");
      });
      this.#hooks.at?.("after-commit");
      return record;
    });
  }
}
