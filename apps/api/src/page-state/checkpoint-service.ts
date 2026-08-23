/**
 * Verified shallow checkpoints and frontier-bounded operational compaction
 * (T142, US5).
 *
 * Creating a checkpoint and authorizing compaction are deliberately separate.
 * The candidate is inert until its encrypted bytes reproduce their declared
 * frontier and canonical projection. Promotion then requires every
 * non-revoked device, retained history, ambiguity, backup and maintenance
 * guard to agree. Time is never one of those guards.
 */

import {
  compactPageOperationPayloads,
  type Database,
  hasPageAmbiguityDependencyThrough,
  insertPageOperationCheckpoint,
  listPageDeviceFrontiersWithAuthorization,
  lockPageOperationState,
  markPageDeviceFrontierRevoked,
  type PageOperationCheckpointRow,
  promotePageOperationCheckpoint,
  readPageOperationCheckpoint,
  readPageOperationCheckpointAtSequence,
  runMutation,
  type Transaction,
  unfinishedRestoration,
  verifyPageOperationCheckpoint,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  type OperationalPageCheckpoint,
  OperationalPageDocument,
  versionVectorDominates,
} from "@myownnotion/page-state";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import type { PageOperationCrypto, ProtectedOperationalFrontier } from "./page-operation-crypto.ts";
import type { PageOperationService } from "./page-operation-service.ts";

export interface PageCheckpointRetentionContext {
  readonly workspaceId: Uuid;
  readonly pageId: Uuid;
  readonly checkpointId: Uuid;
  readonly throughPageSequence: number;
  readonly snapshotDigest: string;
  readonly canonicalDigest: string;
}

/**
 * T146 and T147 provide the database-backed implementations. Until then the
 * composition root installs the deny-by-default policy, so this tranche can
 * create and verify candidates but production can never discard history on a
 * promise that has not yet been implemented.
 */
export interface PageCheckpointRetentionPolicy {
  checkpointIsInVerifiedBackup(
    tx: Transaction,
    context: PageCheckpointRetentionContext,
  ): Promise<boolean>;
  historyAllowsCompaction(
    tx: Transaction,
    context: PageCheckpointRetentionContext,
  ): Promise<boolean>;
}

export const denyPageCheckpointRetention: PageCheckpointRetentionPolicy = {
  checkpointIsInVerifiedBackup: async () => false,
  historyAllowsCompaction: async () => false,
};

export type PageCompactionBlockedReason =
  | "ambiguity-retained"
  | "backup-not-verified"
  | "candidate-not-ahead"
  | "candidate-not-verified"
  | "device-frontier-behind"
  | "history-retained"
  | "history-unconsolidated"
  | "restore-in-progress";

export type PageCompactionResult =
  | {
      readonly kind: "blocked";
      readonly reason: Exclude<PageCompactionBlockedReason, "device-frontier-behind">;
    }
  | {
      readonly kind: "blocked";
      readonly reason: "device-frontier-behind";
      readonly deviceIds: readonly Uuid[];
    }
  | {
      readonly kind: "compacted";
      readonly checkpointId: Uuid;
      readonly throughPageSequence: number;
      readonly compactedUpdates: number;
    };

export interface PageCheckpointServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly operations: PageOperationService;
  readonly rotationPolicies: RotationPolicyService;
  readonly retention?: PageCheckpointRetentionPolicy | undefined;
  readonly now?: (() => Date) | undefined;
}

interface OpenedCandidate {
  readonly row: PageOperationCheckpointRow;
  readonly checkpoint: OperationalPageCheckpoint;
  readonly frontier: ProtectedOperationalFrontier;
  readonly operationalDigest: string;
}

export class PageCheckpointService {
  readonly #deps: Omit<PageCheckpointServiceDeps, "now" | "retention"> & {
    readonly now: () => Date;
    readonly retention: PageCheckpointRetentionPolicy;
  };

  constructor(deps: PageCheckpointServiceDeps) {
    this.#deps = {
      ...deps,
      now: deps.now ?? (() => new Date()),
      retention: deps.retention ?? denyPageCheckpointRetention,
    };
  }

  /** Creates an inert shallow candidate at the page's current causal head. */
  async createCandidate(pageId: Uuid): Promise<PageOperationCheckpointRow> {
    return await runMutation(this.#deps.db, async (tx) => {
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      const loaded = await this.#deps.operations.loadForMutation(tx, pageId);
      const existing = await readPageOperationCheckpointAtSequence(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        throughPageSequence: loaded.state.lastUpdateSequence,
      });
      if (existing !== null) return existing;

      const [checkpoint, projection] = await Promise.all([
        loaded.document.compactedCheckpoint(),
        loaded.document.project(),
      ]);
      if (projection.canonicalDigest !== loaded.state.canonicalDigest) {
        throw new Error("a checkpoint candidate does not reproduce the current canonical page");
      }
      const snapshotEnvelopeId = await this.#deps.crypto.sealBytes(
        tx,
        "checkpoint",
        checkpoint.bytes,
      );
      const frontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
        versionVector: checkpoint.versionVector,
        frontiers: checkpoint.frontiers,
      });
      return await insertPageOperationCheckpoint(tx, {
        checkpointId: generateUuidV7(),
        pageId,
        workspaceId: this.#deps.workspaceId,
        throughPageSequence: loaded.state.lastUpdateSequence,
        frontierEnvelopeId,
        snapshotEnvelopeId,
        snapshotDigest: checkpoint.digest,
        canonicalDigest: projection.canonicalDigest,
        revisionId: loaded.state.lastRevisionId as Uuid | null,
        state: "candidate",
        now: this.#deps.now(),
      });
    });
  }

  /** Re-opens sealed bytes and only then transitions candidate → verified. */
  async verifyCandidate(pageId: Uuid, checkpointId: Uuid): Promise<PageOperationCheckpointRow> {
    return await runMutation(this.#deps.db, async (tx) => {
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      await lockPageOperationState(tx, this.#deps.workspaceId, pageId);
      const opened = await this.#openCandidate(tx, pageId, checkpointId);
      if (["verified", "retained"].includes(opened.row.state)) return opened.row;
      if (opened.row.state !== "candidate") {
        throw new Error("only a checkpoint candidate can be verified");
      }
      return await verifyPageOperationCheckpoint(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        checkpointId,
        verifiedAt: this.#deps.now(),
      });
    });
  }

  async compact(pageId: Uuid, checkpointId: Uuid): Promise<PageCompactionResult> {
    return await runMutation(this.#deps.db, async (tx) => {
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      const state = await lockPageOperationState(tx, this.#deps.workspaceId, pageId);
      const candidate = await readPageOperationCheckpoint(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        checkpointId,
      });
      if (candidate === null || !["verified", "retained"].includes(candidate.state)) {
        return { kind: "blocked", reason: "candidate-not-verified" };
      }
      if (state.currentCheckpointId === null) {
        return { kind: "blocked", reason: "candidate-not-verified" };
      }
      const current = await readPageOperationCheckpoint(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        checkpointId: state.currentCheckpointId as Uuid,
      });
      if (
        current === null ||
        candidate.throughPageSequence <= current.throughPageSequence ||
        candidate.throughPageSequence > state.lastUpdateSequence
      ) {
        return { kind: "blocked", reason: "candidate-not-ahead" };
      }
      const opened = await this.#openCandidate(tx, pageId, checkpointId);
      const context = this.#retentionContext(opened.row);

      if ((await unfinishedRestoration(tx)) !== null) {
        return { kind: "blocked", reason: "restore-in-progress" };
      }
      if (state.revisionWindowStartedAt !== null) {
        return { kind: "blocked", reason: "history-unconsolidated" };
      }
      if (!(await this.#deps.retention.checkpointIsInVerifiedBackup(tx, context))) {
        return { kind: "blocked", reason: "backup-not-verified" };
      }
      if (!(await this.#deps.retention.historyAllowsCompaction(tx, context))) {
        return { kind: "blocked", reason: "history-retained" };
      }
      if (
        await hasPageAmbiguityDependencyThrough(tx, {
          workspaceId: this.#deps.workspaceId,
          pageId,
          throughPageSequence: candidate.throughPageSequence,
        })
      ) {
        return { kind: "blocked", reason: "ambiguity-retained" };
      }

      const lagging: Uuid[] = [];
      const deviceFrontiers = await listPageDeviceFrontiersWithAuthorization(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
      });
      for (const { frontier, authorizationState } of deviceFrontiers) {
        if (authorizationState === "revoked") {
          await markPageDeviceFrontierRevoked(tx, {
            pageId,
            deviceId: frontier.deviceId as Uuid,
          });
          continue;
        }
        if (frontier.confirmedPageSequence < candidate.throughPageSequence) {
          lagging.push(frontier.deviceId as Uuid);
          continue;
        }
        const confirmed = await this.#deps.crypto.openFrontier(
          tx,
          frontier.frontierEnvelopeId as Uuid,
        );
        if (!versionVectorDominates(confirmed.versionVector, opened.frontier.versionVector)) {
          lagging.push(frontier.deviceId as Uuid);
        }
      }
      if (lagging.length > 0) {
        return { kind: "blocked", reason: "device-frontier-behind", deviceIds: lagging.sort() };
      }

      const now = this.#deps.now();
      await promotePageOperationCheckpoint(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        checkpointId,
        expectedCurrentCheckpointId: state.currentCheckpointId as Uuid,
        operationalDigest: opened.operationalDigest,
        now,
      });
      const compacted = await compactPageOperationPayloads(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        throughPageSequence: candidate.throughPageSequence,
        compactedAt: now,
      });
      return {
        kind: "compacted",
        checkpointId,
        throughPageSequence: candidate.throughPageSequence,
        compactedUpdates: compacted.compactedUpdates,
      };
    });
  }

  async #openCandidate(
    tx: Transaction,
    pageId: Uuid,
    checkpointId: Uuid,
  ): Promise<OpenedCandidate> {
    const row = await readPageOperationCheckpoint(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId,
      checkpointId,
    });
    if (row === null) throw new Error("page checkpoint candidate does not exist");
    const [bytes, frontier] = await Promise.all([
      this.#deps.crypto.openBytes(tx, "checkpoint", row.snapshotEnvelopeId as Uuid),
      this.#deps.crypto.openFrontier(tx, row.frontierEnvelopeId as Uuid),
    ]);
    const checkpoint: OperationalPageCheckpoint = {
      operationalFormat: "myownnotion.page-operations+loro",
      operationalVersion: 1,
      pageId,
      bytes,
      digest: row.snapshotDigest,
      versionVector: frontier.versionVector,
      frontiers: frontier.frontiers,
    };
    const document = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const projection = await document.project();
    if (projection.canonicalDigest !== row.canonicalDigest) {
      throw new Error("page checkpoint candidate failed canonical verification");
    }
    return { row, checkpoint, frontier, operationalDigest: projection.operationalDigest };
  }

  #retentionContext(row: PageOperationCheckpointRow): PageCheckpointRetentionContext {
    return {
      workspaceId: this.#deps.workspaceId,
      pageId: row.pageId as Uuid,
      checkpointId: row.id as Uuid,
      throughPageSequence: row.throughPageSequence,
      snapshotDigest: row.snapshotDigest,
      canonicalDigest: row.canonicalDigest,
    };
  }
}
