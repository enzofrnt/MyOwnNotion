/**
 * Transactional import and bidirectional catch-up for active operational pages
 * (T139, US5).
 */

import {
  type ActivePageSyncRequestDto,
  type ActivePageSyncResponseDto,
  MAX_PAGE_UPDATES_PER_SYNC,
} from "@myownnotion/contracts";
import {
  appendAcceptedPageOperationUpdate,
  appendAcceptedPageOperationUpdates,
  buildItemSnapshot,
  confirmPageDeviceFrontier,
  type Database,
  insertPageAmbiguity,
  insertPageOperationCheckpoint,
  insertRevision,
  listOpenPageAmbiguities,
  listPageOperationUpdatesAfter,
  lockItemRevisionHead,
  lockPageOperationState,
  PageOperationRepositoryError,
  type PageOperationStateRow,
  type PageOperationUpdateRow,
  promotePageOperationCheckpoint,
  readPageAmbiguityByLogicalKey,
  readPageDeviceFrontier,
  readPageOperationCheckpoint,
  readPageOperationCheckpointAtSequence,
  readPageOperationUpdateAtSequence,
  readPageOperationUpdates,
  recordChange,
  revisionDescendsFrom,
  runMutation,
  schema,
  supersedeRevision,
  type Transaction,
  verifyPageOperationCheckpoint,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  detectPageAmbiguities,
  incrementalUpdateResultVersionVector,
  type OperationalPageCheckpoint,
  OperationalPageDocument,
  type SemanticUpdateRecord,
  sha256Hex,
  verifyIncrementalUpdateBase,
  versionVectorBytesEqual,
  versionVectorDominates,
} from "@myownnotion/page-state";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { SearchService } from "../search/search-service.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { authorizeSynchronizationWrite } from "../security/synchronization-authorization.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import type { CanonicalMaterializer } from "./canonical-materializer.ts";
import { PageHistoryConsolidationError, type PageHistoryService } from "./page-history-service.ts";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";
import { semanticRecordFromProjectionDiff } from "./semantic-detection.ts";

/** Maximum replay tail before the next accepted batch rolls a full checkpoint. */
export const PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL = 512;

export interface PageOperationServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly materializer: CanonicalMaterializer;
  readonly protectedContent: ProtectedContent;
  readonly rotationPolicies: RotationPolicyService;
  readonly history?: Pick<PageHistoryService, "consolidateIfDue"> | undefined;
  readonly search?: SearchService | undefined;
  /** Ephemeral wake-up emitted only after the page transaction committed. */
  readonly onPageCommitted?:
    | ((event: { readonly pageId: Uuid; readonly latestPageSequence: number }) => void)
    | undefined;
  readonly now?: () => Date;
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(new ArrayBuffer(source.byteLength));
  bytes.set(source);
  return bytes;
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export interface LoadedOperationalPage {
  readonly document: OperationalPageDocument;
  readonly state: PageOperationStateRow;
  readonly checkpoint: OperationalPageCheckpoint;
  readonly checkpointThroughPageSequence: number;
}

export class PageOperationService {
  readonly #deps: Required<Pick<PageOperationServiceDeps, "now">> &
    Omit<PageOperationServiceDeps, "now">;

  constructor(deps: PageOperationServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async #consolidateHistory(
    tx: Transaction,
    pageId: Uuid,
    options: { readonly force?: boolean } = {},
  ) {
    try {
      return await this.#deps.history?.consolidateIfDue(tx, pageId, options);
    } catch (error) {
      // A retired page and a provably divergent history lineage are both
      // deterministic page-state failures. Returning a bounded 409 keeps the
      // multiplexed socket alive and lets the client retain this page for
      // repair instead of reconnecting every few hundred milliseconds.
      if (
        (error instanceof PageOperationRepositoryError && error.code === "state-not-found") ||
        error instanceof PageHistoryConsolidationError
      ) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The page history requires repair before synchronization can continue.",
          409,
        );
      }
      throw error;
    }
  }

  async #load(tx: Transaction, pageId: Uuid): Promise<LoadedOperationalPage> {
    let state: PageOperationStateRow;
    try {
      state = await lockPageOperationState(tx, this.#deps.workspaceId, pageId);
    } catch (error) {
      if (error instanceof PageOperationRepositoryError && error.code === "state-not-found") {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The page no longer has operational state.",
          409,
        );
      }
      throw error;
    }
    if (state.status !== "active" || state.currentCheckpointId === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The page has no active operational state.",
        409,
      );
    }
    const checkpointRow = await readPageOperationCheckpoint(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId,
      checkpointId: state.currentCheckpointId as Uuid,
    });
    if (checkpointRow === null || !["verified", "retained"].includes(checkpointRow.state)) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The current operational checkpoint is not verified.",
        409,
      );
    }
    const snapshotBytes = await this.#deps.crypto.openBytes(
      tx,
      "checkpoint",
      checkpointRow.snapshotEnvelopeId as Uuid,
    );
    const frontier = await this.#deps.crypto.openFrontier(
      tx,
      checkpointRow.frontierEnvelopeId as Uuid,
    );
    const checkpoint: OperationalPageCheckpoint = {
      operationalFormat: "myownnotion.page-operations+loro",
      operationalVersion: 1,
      pageId,
      bytes: snapshotBytes,
      digest: checkpointRow.snapshotDigest,
      versionVector: frontier.versionVector,
      frontiers: frontier.frontiers,
    };
    let document: OperationalPageDocument;
    try {
      document = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    } catch {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The current operational checkpoint failed verification.",
        409,
      );
    }

    let after = checkpointRow.throughPageSequence;
    while (after < state.lastUpdateSequence) {
      const rows = await listPageOperationUpdatesAfter(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId,
        after,
        limit: 256,
      });
      if (rows.length === 0) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The operational update log is incomplete.",
          409,
        );
      }
      if (rows.some(({ updateEnvelopeId }) => updateEnvelopeId === null)) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The operational update log was compacted beyond its active checkpoint.",
          409,
        );
      }
      const updateBytesByEnvelope = await this.#deps.crypto.openBytesMany(
        tx,
        "update",
        rows.map(({ updateEnvelopeId }) => updateEnvelopeId as Uuid),
      );
      const orderedBytes = rows.map((row) => {
        const bytes = updateBytesByEnvelope.get(row.updateEnvelopeId as Uuid);
        if (bytes === undefined) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The operational update log is incomplete.",
            409,
          );
        }
        return bytes;
      });
      const digests = await Promise.all(orderedBytes.map(async (bytes) => await sha256Hex(bytes)));
      if (rows.some((row, index) => digests[index] !== row.updateDigest)) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The operational update log failed verification.",
          409,
        );
      }
      if (document.importUpdates(orderedBytes).pending) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The operational update log failed verification.",
          409,
        );
      }
      after = rows.at(-1)?.pageSequence ?? after;
    }

    const projection = await document.project();
    // The canonical digest must match, and the causal frontier of the replay
    // must equal the stored frontier. The raw snapshot byte hash is order
    // dependent — Loro may encode the same logical state differently depending
    // on the order updates were imported in — so it cannot be the replay
    // identity; the version vector is that identity.
    if (projection.canonicalDigest !== state.canonicalDigest) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational state no longer matches its canonical projection.",
        409,
      );
    }
    if (state.currentFrontierEnvelopeId === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational state has no recorded frontier.",
        409,
      );
    }
    const stateFrontier = await this.#deps.crypto.openFrontier(
      tx,
      state.currentFrontierEnvelopeId as Uuid,
    );
    if (!versionVectorBytesEqual(document.versionVectorBytes(), stateFrontier.versionVector)) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational state no longer matches its recorded frontier.",
        409,
      );
    }
    return {
      document,
      state,
      checkpoint,
      checkpointThroughPageSequence: checkpointRow.throughPageSequence,
    };
  }

  /**
   * Rolls a full-history replay checkpoint before accepting the next batch.
   *
   * Unlike a shallow compaction candidate, this snapshot retains every old
   * operation and can therefore still import a branch authored by a device
   * that has been offline since an earlier checkpoint. No update payload is
   * removed here; device-frontier-gated compaction remains a separate action.
   */
  async #rollReplayCheckpoint(
    tx: Transaction,
    input: LoadedOperationalPage,
  ): Promise<LoadedOperationalPage> {
    if (
      input.state.lastUpdateSequence - input.checkpointThroughPageSequence <
      PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL
    ) {
      return input;
    }
    const existing = await readPageOperationCheckpointAtSequence(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.document.pageId,
      throughPageSequence: input.state.lastUpdateSequence,
    });
    if (existing !== null) return input;
    if (input.state.currentCheckpointId === null || input.state.operationalDigest === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational page cannot roll an incomplete replay checkpoint.",
        409,
      );
    }

    const [checkpoint, projection] = await Promise.all([
      input.document.checkpoint(),
      input.document.project(),
    ]);
    if (projection.canonicalDigest !== input.state.canonicalDigest) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The replay checkpoint does not reproduce the current operational page.",
        409,
      );
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
    const checkpointId = generateUuidV7();
    await insertPageOperationCheckpoint(tx, {
      checkpointId,
      pageId: input.document.pageId,
      workspaceId: this.#deps.workspaceId,
      throughPageSequence: input.state.lastUpdateSequence,
      frontierEnvelopeId,
      snapshotEnvelopeId,
      snapshotDigest: checkpoint.digest,
      canonicalDigest: projection.canonicalDigest,
      revisionId:
        input.state.revisionWindowStartedAt === null
          ? (input.state.lastRevisionId as Uuid | null)
          : null,
      state: "candidate",
      now: this.#deps.now(),
    });

    // Verify the protected bytes after persistence, not merely the in-memory
    // source, before making this checkpoint the replay base.
    const storedBytes = await this.#deps.crypto.openBytes(tx, "checkpoint", snapshotEnvelopeId);
    const storedFrontier = await this.#deps.crypto.openFrontier(tx, frontierEnvelopeId);
    const storedCheckpoint: OperationalPageCheckpoint = {
      ...checkpoint,
      bytes: storedBytes,
      versionVector: storedFrontier.versionVector,
      frontiers: storedFrontier.frontiers,
    };
    const reopened = await OperationalPageDocument.fromCheckpoint({
      pageId: input.document.pageId,
      checkpoint: storedCheckpoint,
    });
    const reopenedProjection = await reopened.project();
    if (
      reopenedProjection.canonicalDigest !== projection.canonicalDigest ||
      reopenedProjection.operationalDigest !== projection.operationalDigest
    ) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The protected replay checkpoint failed verification.",
        409,
      );
    }
    await verifyPageOperationCheckpoint(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.document.pageId,
      checkpointId,
      verifiedAt: this.#deps.now(),
    });
    const state = await promotePageOperationCheckpoint(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.document.pageId,
      checkpointId,
      expectedCurrentCheckpointId: input.state.currentCheckpointId as Uuid,
      operationalDigest: projection.operationalDigest,
      now: this.#deps.now(),
    });
    return {
      document: input.document,
      state,
      checkpoint: storedCheckpoint,
      checkpointThroughPageSequence: input.state.lastUpdateSequence,
    };
  }

  /**
   * Returns the largest page cursor this request's durable causal frontier can
   * prove. Result frontiers are cumulative and monotone. The numeric cursor is
   * used only as a search hint: the causal frontier may prove newly accepted
   * local updates beyond it, while a stale or corrupt cursor may point beyond
   * the first unseen update. Common requests need at most three indexed
   * lookups; inconsistent states fall back to a logarithmic search instead of
   * skipping updates or rescanning the complete operation log.
   */
  async #confirmedRequestPrefix(
    tx: Transaction,
    input: {
      readonly pageId: Uuid;
      readonly lastUpdateSequence: number;
      readonly knownServerPageSequence: number;
      readonly persistedVersionVector: Uint8Array;
    },
  ): Promise<number> {
    if (input.lastUpdateSequence <= 0) return 0;
    const requestedSequence = Math.min(input.knownServerPageSequence, input.lastUpdateSequence);

    const dominanceBySequence = new Map<number, boolean>();
    const dominatesSequence = async (pageSequence: number): Promise<boolean> => {
      if (pageSequence === 0) return true;
      const known = dominanceBySequence.get(pageSequence);
      if (known !== undefined) return known;
      const row = await readPageOperationUpdateAtSequence(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId: input.pageId,
        pageSequence,
      });
      if (row === null) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The operational update log has a missing sequence receipt.",
          409,
        );
      }
      const frontier = await this.#deps.crypto.openFrontier(
        tx,
        row.resultFrontierEnvelopeId as Uuid,
      );
      const dominated = versionVectorDominates(
        input.persistedVersionVector,
        frontier.versionVector,
      );
      dominanceBySequence.set(pageSequence, dominated);
      return dominated;
    };

    if (requestedSequence > 0 && !(await dominatesSequence(requestedSequence))) {
      let lower = 0;
      let upper = requestedSequence - 1;
      while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2);
        if (await dominatesSequence(middle)) lower = middle;
        else upper = middle - 1;
      }
      return lower;
    }
    if (requestedSequence === input.lastUpdateSequence) return requestedSequence;

    const sequenceAfterCursor = requestedSequence + 1;
    if (!(await dominatesSequence(sequenceAfterCursor))) return requestedSequence;
    if (sequenceAfterCursor === input.lastUpdateSequence) return sequenceAfterCursor;
    if (await dominatesSequence(input.lastUpdateSequence)) return input.lastUpdateSequence;

    let lower = sequenceAfterCursor;
    let upper = input.lastUpdateSequence - 1;
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (await dominatesSequence(middle)) lower = middle;
      else upper = middle - 1;
    }
    return lower;
  }

  /** Shared locked loader for migration and later server-side maintenance. */
  async sync(input: {
    readonly pageId: Uuid;
    readonly ownerId: string;
    readonly deviceId: Uuid;
    readonly request: ActivePageSyncRequestDto;
  }): Promise<ActivePageSyncResponseDto> {
    let committedSequence: number | undefined;
    const response = await runMutation(this.#deps.db, async (tx) => {
      const authorization = await authorizeSynchronizationWrite(tx, input);
      if (!authorization.allowed) {
        throw new PageOperationServiceError(
          "page-operations.device-revoked",
          "This device is no longer authorized.",
          403,
        );
      }
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      await this.#consolidateHistory(tx, input.pageId);
      let loaded = await this.#load(tx, input.pageId);
      let state = loaded.state;
      const document = loaded.document;
      const accepted: ActivePageSyncResponseDto["accepted"] = [];
      const repeated: ActivePageSyncResponseDto["repeated"] = [];
      const responseUpdateIds = new Set<string>();
      const newUpdates = [] as ActivePageSyncRequestDto["updates"][number][];
      const repeatedUpdates: Array<{
        readonly candidate: ActivePageSyncRequestDto["updates"][number];
        readonly existing: PageOperationUpdateRow;
      }> = [];
      const existingUpdates = await readPageOperationUpdates(
        tx,
        input.request.updates.map(({ updateId }) => updateId as Uuid),
      );
      const seenUpdateIds = new Set<string>();

      for (const candidate of input.request.updates) {
        if (seenUpdateIds.has(candidate.updateId)) {
          throw new PageOperationServiceError(
            "page-operations.update-id-reused",
            "An operational update identity appears more than once in one request.",
            409,
          );
        }
        seenUpdateIds.add(candidate.updateId);
        const existing = existingUpdates.get(candidate.updateId as Uuid) ?? null;
        if (existing === null) {
          newUpdates.push(candidate);
          continue;
        }
        if (
          existing.pageId !== input.pageId ||
          existing.workspaceId !== this.#deps.workspaceId ||
          existing.authoredByDeviceId !== input.deviceId ||
          existing.updateDigest !== candidate.updateDigest
        ) {
          throw new PageOperationServiceError(
            "page-operations.update-id-reused",
            "An operational update identity was reused with different content.",
            409,
          );
        }
        repeatedUpdates.push({ candidate, existing });
      }
      if (newUpdates.length > 0) {
        loaded = await this.#rollReplayCheckpoint(tx, loaded);
        state = loaded.state;
      }
      const repeatedFrontiers = await this.#deps.crypto.openFrontiers(
        tx,
        repeatedUpdates.map(({ existing }) => existing.resultFrontierEnvelopeId as Uuid),
      );
      for (const { existing } of repeatedUpdates) {
        const result = repeatedFrontiers.get(existing.resultFrontierEnvelopeId as Uuid);
        if (result === undefined) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "A repeated operational update has no retained frontier.",
            409,
          );
        }
        repeated.push({
          updateId: existing.id as Uuid,
          pageSequence: existing.pageSequence,
          resultVersionVector: encode(result.versionVector),
        });
        responseUpdateIds.add(existing.id);
      }

      const pending = [...newUpdates];
      const importedUpdates: Array<{
        readonly candidate: (typeof newUpdates)[number];
        readonly updateBytes: Uint8Array;
        readonly baseVersionVector: Uint8Array;
        readonly resultVersionVector: Uint8Array;
        readonly resultFrontiers: Uint8Array;
      }> = [];
      while (pending.length > 0) {
        let progressed = false;
        for (let index = 0; index < pending.length; ) {
          const candidate = pending[index];
          if (candidate === undefined) break;
          const baseVersionVector = decode(candidate.baseVersionVector);
          if (!versionVectorDominates(document.versionVectorBytes(), baseVersionVector)) {
            index += 1;
            continue;
          }
          const updateBytes = decode(candidate.updateBytes);
          if ((await sha256Hex(updateBytes)) !== candidate.updateDigest) {
            throw new PageOperationServiceError(
              "page-operations.digest-mismatch",
              "An operational update did not match its digest.",
              409,
            );
          }
          try {
            verifyIncrementalUpdateBase(updateBytes, baseVersionVector);
          } catch {
            throw new PageOperationServiceError(
              "page-operations.dependencies-missing",
              "An operational update does not match its declared causal base.",
              409,
            );
          }

          const imported = document.importUpdate(updateBytes);
          if (imported.pending) {
            throw new PageOperationServiceError(
              "page-operations.dependencies-missing",
              "An operational update still has missing causal dependencies.",
              409,
            );
          }
          const resultVersionVector = imported.versionVector;
          importedUpdates.push({
            candidate,
            updateBytes,
            baseVersionVector,
            resultVersionVector,
            resultFrontiers: document.frontiersForVersionVector(resultVersionVector),
          });
          pending.splice(index, 1);
          progressed = true;
        }
        if (!progressed) {
          throw new PageOperationServiceError(
            "page-operations.dependencies-missing",
            "The submitted update batch is missing causal dependencies.",
            409,
          );
        }
      }

      // A request is one atomic transaction: no observer can see the state
      // between two accepted updates. Materialising and hashing the whole Loro
      // document after every keystroke made a 35-update offline catch-up export
      // roughly 70 complete snapshots. Import the causal batch first, project
      // once, then retain every immutable update identity and frontier.
      const projection = await document.project();
      const envelopeIds = await this.#deps.crypto.sealUpdateBatch(
        tx,
        importedUpdates.map(
          ({ updateBytes, baseVersionVector, resultVersionVector, resultFrontiers }) => ({
            updateBytes,
            baseFrontier: {
              versionVector: baseVersionVector,
              frontiers: document.frontiersForVersionVector(baseVersionVector),
            },
            resultFrontier: { versionVector: resultVersionVector, frontiers: resultFrontiers },
          }),
        ),
      );
      const appended = await appendAcceptedPageOperationUpdates(tx, {
        pageId: input.pageId,
        workspaceId: this.#deps.workspaceId,
        updates: importedUpdates.map(({ candidate }, index) => {
          const envelopes = envelopeIds[index];
          if (envelopes === undefined) {
            throw new Error("an operational update envelope batch is incomplete");
          }
          return {
            updateId: candidate.updateId as Uuid,
            authoredByDeviceId: input.deviceId,
            ...envelopes,
            updateDigest: candidate.updateDigest,
          };
        }),
        operationalDigest: projection.operationalDigest,
        canonicalDigest: projection.canonicalDigest,
        acceptedAt: this.#deps.now(),
      });
      state = appended.state;
      for (const [index, imported] of importedUpdates.entries()) {
        const persisted = appended.updates[index];
        if (persisted === undefined) throw new Error("an accepted operational update is missing");
        const { candidate, resultVersionVector } = imported;
        accepted.push({
          updateId: candidate.updateId as Uuid,
          pageSequence: persisted.pageSequence,
          resultVersionVector: encode(resultVersionVector),
        });
        responseUpdateIds.add(candidate.updateId);
      }

      let fileRequirements: ActivePageSyncResponseDto["fileRequirements"] = [];
      if (accepted.length > 0) {
        if (state.lastRevisionId === null) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The operational page has no retained revision boundary.",
            409,
          );
        }
        const materialized = await this.#deps.materializer.materialize(tx, {
          workspaceId: this.#deps.workspaceId,
          pageId: input.pageId,
          revisionId: state.lastRevisionId as Uuid,
          projection,
        });
        fileRequirements = [...materialized.fileRequirements];
      } else {
        // A transfer can complete after the document update that referenced
        // it. Polls must therefore re-evaluate bytes even when no new document
        // operation was accepted; otherwise upload-required stays stuck until
        // somebody edits the page again.
        fileRequirements = [
          ...(await this.#deps.materializer.refreshFileRequirements(tx, {
            pageId: input.pageId,
            projection,
          })),
        ];
      }

      const persistedVersionVector = decode(input.request.persistedVersionVector);
      if (!versionVectorDominates(document.versionVectorBytes(), persistedVersionVector)) {
        throw new PageOperationServiceError(
          "page-operations.dependencies-missing",
          "The durable client frontier contains updates that were not submitted.",
          409,
        );
      }
      const requestConfirmedPageSequence = await this.#confirmedRequestPrefix(tx, {
        pageId: input.pageId,
        lastUpdateSequence: state.lastUpdateSequence,
        knownServerPageSequence: input.request.knownServerPageSequence,
        persistedVersionVector,
      });
      const existingDeviceFrontier = await readPageDeviceFrontier(tx, {
        pageId: input.pageId,
        deviceId: input.deviceId,
      });
      let mayAdvanceDeviceFrontier = true;
      if (existingDeviceFrontier !== null) {
        const existing = await this.#deps.crypto.openFrontier(
          tx,
          existingDeviceFrontier.frontierEnvelopeId as Uuid,
        );
        // A stale tab may legitimately confirm an older or concurrent durable
        // state. It still receives catch-up, but it never moves the device's
        // compaction frontier backwards.
        mayAdvanceDeviceFrontier = versionVectorDominates(
          persistedVersionVector,
          existing.versionVector,
        );
      }
      if (mayAdvanceDeviceFrontier) {
        const confirmedPageSequence = Math.max(
          existingDeviceFrontier?.confirmedPageSequence ?? 0,
          requestConfirmedPageSequence,
        );
        const frontierDigest = await sha256Hex(persistedVersionVector);
        if (
          existingDeviceFrontier === null ||
          existingDeviceFrontier.frontierDigest !== frontierDigest ||
          existingDeviceFrontier.confirmedPageSequence !== confirmedPageSequence
        ) {
          const frontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
            versionVector: persistedVersionVector,
            frontiers: document.frontiersForVersionVector(persistedVersionVector),
          });
          await confirmPageDeviceFrontier(tx, {
            pageId: input.pageId,
            deviceId: input.deviceId,
            workspaceId: this.#deps.workspaceId,
            frontierEnvelopeId,
            frontierDigest,
            confirmedPageSequence,
            now: this.#deps.now(),
          });
        }
      }
      // Ambiguity detection over the causal window the client could not see:
      // every stored update its persisted frontier does not dominate is
      // concurrent with or newer than the client's work, so exactly those get
      // their semantic delta reconstructed and compared pairwise (FR-058).
      const mustDetectNewAmbiguity =
        accepted.length > 0 &&
        !versionVectorDominates(persistedVersionVector, document.versionVectorBytes());
      const ambiguitySummaries = mustDetectNewAmbiguity
        ? await this.#detectAmbiguities(tx, {
            pageId: input.pageId,
            persistedVersionVector,
          })
        : await this.#openAmbiguities(tx, input.pageId);

      const candidates = await listPageOperationUpdatesAfter(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId: input.pageId,
        after: requestConfirmedPageSequence,
        limit: MAX_PAGE_UPDATES_PER_SYNC + 1,
      });
      const remoteUpdates: ActivePageSyncResponseDto["remoteUpdates"] = [];
      let remoteBytes = 0;
      let throughPageSequence = requestConfirmedPageSequence;
      const candidateRows = candidates.slice(0, MAX_PAGE_UPDATES_PER_SYNC);
      const candidateFrontiers = await this.#deps.crypto.openFrontiers(
        tx,
        candidateRows.map(({ resultFrontierEnvelopeId }) => resultFrontierEnvelopeId as Uuid),
      );
      const rowsRequiringBytes = candidateRows.filter((row) => {
        if (responseUpdateIds.has(row.id)) return false;
        const result = candidateFrontiers.get(row.resultFrontierEnvelopeId as Uuid);
        return (
          result !== undefined &&
          !versionVectorDominates(persistedVersionVector, result.versionVector)
        );
      });
      if (
        rowsRequiringBytes.some(
          ({ baseFrontierEnvelopeId, updateEnvelopeId }) =>
            baseFrontierEnvelopeId === null || updateEnvelopeId === null,
        )
      ) {
        throw new PageOperationServiceError(
          "page-operations.dependencies-missing",
          "The requested operational history was compacted; reload the current checkpoint.",
          409,
        );
      }
      const candidateBytes = await this.#deps.crypto.openBytesMany(
        tx,
        "update",
        rowsRequiringBytes.map(({ updateEnvelopeId }) => updateEnvelopeId as Uuid),
      );
      const candidateBases = await this.#deps.crypto.openFrontiers(
        tx,
        rowsRequiringBytes.map(({ baseFrontierEnvelopeId }) => baseFrontierEnvelopeId as Uuid),
      );
      for (const row of candidateRows) {
        if (responseUpdateIds.has(row.id)) {
          throughPageSequence = row.pageSequence;
          continue;
        }
        const result = candidateFrontiers.get(row.resultFrontierEnvelopeId as Uuid);
        if (result === undefined) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "An operational update has no retained frontier.",
            409,
          );
        }
        if (versionVectorDominates(persistedVersionVector, result.versionVector)) {
          throughPageSequence = row.pageSequence;
          continue;
        }
        const bytes = candidateBytes.get(row.updateEnvelopeId as Uuid);
        const base = candidateBases.get(row.baseFrontierEnvelopeId as Uuid);
        if (bytes === undefined || base === undefined) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "An operational update has incomplete retained content.",
            409,
          );
        }
        let authoredResultVersionVector: Uint8Array;
        try {
          authoredResultVersionVector = incrementalUpdateResultVersionVector(
            bytes,
            base.versionVector,
          );
        } catch {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "An operational update has invalid retained causal metadata.",
            409,
          );
        }
        // The retained result frontier is the merged server state after
        // acceptance. A returning replica may already contain this authored
        // update but not the concurrent remote branch, so testing only that
        // merged frontier would echo the replica's own update back to it.
        if (versionVectorDominates(persistedVersionVector, authoredResultVersionVector)) {
          throughPageSequence = row.pageSequence;
          continue;
        }
        if (
          remoteUpdates.length > 0 &&
          remoteBytes + bytes.byteLength > input.request.maxRemoteBytes
        )
          break;
        if (bytes.byteLength > input.request.maxRemoteBytes) break;
        remoteBytes += bytes.byteLength;
        remoteUpdates.push({
          updateId: row.id as Uuid,
          pageSequence: row.pageSequence,
          authoredByDeviceId: row.authoredByDeviceId as Uuid,
          updateBytes: encode(bytes),
          updateDigest: row.updateDigest,
          acceptedAt: row.acceptedAt.toISOString(),
        });
        throughPageSequence = row.pageSequence;
      }
      const consolidated = await this.#consolidateHistory(tx, input.pageId, {
        force: input.request.revisionBoundary === "editor-closed",
      });
      if (consolidated !== null && consolidated !== undefined) {
        state = await lockPageOperationState(tx, this.#deps.workspaceId, input.pageId);
        const lastAccepted = accepted.at(-1);
        if (lastAccepted !== undefined) {
          accepted[accepted.length - 1] = {
            ...lastAccepted,
            consolidatedRevisionId: consolidated.revisionId,
          };
        }
      }
      if (accepted.length > 0) {
        if (state.lastRevisionId === null) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The operational page has no retained revision boundary.",
            409,
          );
        }
        const mutationId = accepted[0]?.updateId as Uuid;
        const acceptedAt = this.#deps.now();
        await tx.insert(schema.mutations).values({
          id: mutationId,
          workspaceId: this.#deps.workspaceId,
          commandType: "page-operations.updated",
          status: "accepted",
          submittedAt: acceptedAt,
          acceptedAt,
          resultRevisionIds: [state.lastRevisionId],
        });
        committedSequence = await recordChange(tx, {
          workspaceId: this.#deps.workspaceId,
          mutationId,
          revisionIds: [state.lastRevisionId as Uuid],
          changedItemIds: [input.pageId],
        });
      }
      return {
        mode: "active" as const,
        requestId: input.request.requestId as Uuid,
        pageId: input.pageId,
        accepted,
        repeated,
        remoteUpdates,
        serverVersionVector: encode(document.versionVectorBytes()),
        throughPageSequence,
        latestPageSequence: state.lastUpdateSequence,
        hasMore: throughPageSequence < state.lastUpdateSequence,
        canonical: {
          format: "myownnotion.document+json" as const,
          formatVersion: 3 as const,
          digest: projection.canonicalDigest,
          lastConsolidatedRevisionId: state.lastRevisionId as Uuid | null,
          hasUnconsolidatedChanges: state.revisionWindowStartedAt !== null,
        },
        ambiguities: ambiguitySummaries,
        fileRequirements,
      };
    });
    announceCommitted(committedSequence);
    if (committedSequence !== undefined) {
      try {
        this.#deps.onPageCommitted?.({
          pageId: input.pageId,
          latestPageSequence: response.latestPageSequence,
        });
      } catch {
        // The transaction is already durable. A dead live listener is repaired
        // by frontier catch-up and must never turn that commit into a failure.
      }
    }
    if (committedSequence !== undefined && this.#deps.search !== undefined) {
      try {
        await this.#deps.search.applyCommittedChanges([input.pageId], committedSequence);
      } catch {
        // Canonical state is committed. Search marks itself stale and rebuilds;
        // synchronization must not be reported as failed after that commit.
      }
    }
    return response;
  }

  async loadForMutation(tx: Transaction, pageId: Uuid): Promise<LoadedOperationalPage> {
    return await this.#load(tx, pageId);
  }

  /**
   * Applies server-authored commands — ambiguity resolutions today — inside
   * the caller's transaction: transact, project, materialize, append an
   * accepted update row, then record one change-feed entry (plan §8: a
   * resolution is a semantic boundary).
   *
   * The resolution revision closes the consolidation window and becomes the
   * page's retained boundary; source updates stay immutable. Announcements
   * belong to the caller, which knows when its own transaction commits.
   */
  async applyServerCommands(
    input: {
      readonly pageId: Uuid;
      readonly deviceId: Uuid;
      readonly mutationId: Uuid;
      readonly commandType?: "page-operations.updated" | "revision.restore";
      readonly commands: readonly import("@myownnotion/page-state").PageCommand[];
    },
    tx: Transaction,
  ): Promise<{
    revisionId: Uuid;
    committedSequence: number;
    latestPageSequence: number;
  }> {
    const loaded = await this.#load(tx, input.pageId);
    const document = loaded.document;
    const operationalBoundaryId = loaded.state.lastRevisionId as Uuid | null;
    if (operationalBoundaryId === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational page has no retained revision boundary.",
        409,
      );
    }
    const itemRevisionHead = await lockItemRevisionHead(tx, this.#deps.workspaceId, input.pageId);
    if (
      itemRevisionHead === null ||
      !(await revisionDescendsFrom(tx, itemRevisionHead, operationalBoundaryId))
    ) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The canonical and operational page histories no longer share a safe frontier.",
        409,
      );
    }
    // The resolution applies on top of the current merged state; its causal
    // base is therefore exactly what the page holds before transacting.
    const baseVersionVector = document.versionVectorBytes();
    const transaction = document.transact(input.commands);
    if (!transaction.changed) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "A resolution produced no operational change.",
        409,
      );
    }
    const [projection, resultCheckpoint] = await Promise.all([
      document.project(),
      document.checkpoint(),
    ]);
    await this.#deps.materializer.materialize(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.pageId,
      revisionId: itemRevisionHead,
      projection,
    });

    const baseFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
      versionVector: baseVersionVector,
      frontiers: document.frontiersForVersionVector(baseVersionVector),
    });
    const resultFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
      versionVector: resultCheckpoint.versionVector,
      frontiers: resultCheckpoint.frontiers,
    });
    const updateEnvelopeId = await this.#deps.crypto.sealBytes(
      tx,
      "update",
      transaction.updateBytes,
    );
    const appended = await appendAcceptedPageOperationUpdate(tx, {
      updateId: input.mutationId,
      pageId: input.pageId,
      workspaceId: this.#deps.workspaceId,
      authoredByDeviceId: input.deviceId,
      baseFrontierEnvelopeId,
      resultFrontierEnvelopeId,
      updateEnvelopeId,
      updateDigest: await sha256Hex(transaction.updateBytes),
      operationalDigest: projection.operationalDigest,
      canonicalDigest: projection.canonicalDigest,
      acceptedAt: this.#deps.now(),
    });

    const acceptedAt = this.#deps.now();
    const revisionId = generateUuidV7();
    const snapshot = await buildItemSnapshot(tx, input.pageId);
    await insertRevision(tx, {
      id: revisionId,
      itemId: input.pageId,
      mutationId: input.mutationId,
      parentRevisionIds: [itemRevisionHead],
      snapshot,
      acceptedAt,
    });
    await this.#deps.protectedContent.writeRevisionSnapshot(tx, { revisionId, snapshot });
    await supersedeRevision(tx, itemRevisionHead, acceptedAt);
    await tx
      .update(schema.pageOperationStates)
      .set({
        lastRevisionId: revisionId,
        revisionWindowStartedAt: null,
        revisionWindowLastUpdateAt: null,
        revisionWindowFrontierEnvelopeId: null,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(schema.pageOperationStates.pageId, input.pageId),
          eq(schema.pageOperationStates.workspaceId, this.#deps.workspaceId),
        ),
      );
    await tx
      .update(schema.items)
      .set({ currentRevisionId: revisionId, updatedAt: acceptedAt })
      .where(eq(schema.items.id, input.pageId));

    await tx.insert(schema.mutations).values({
      id: input.mutationId,
      workspaceId: this.#deps.workspaceId,
      commandType: input.commandType ?? "page-operations.updated",
      status: "accepted",
      submittedAt: acceptedAt,
      acceptedAt,
      resultRevisionIds: [revisionId],
    });
    const committedSequence = await recordChange(tx, {
      workspaceId: this.#deps.workspaceId,
      mutationId: input.mutationId,
      revisionIds: [revisionId],
      changedItemIds: [input.pageId],
    });
    return {
      revisionId,
      committedSequence,
      latestPageSequence: appended.state.lastUpdateSequence,
    };
  }

  /**
   * Detects durable ambiguities inside the causal window the client could not
   * see, and summarises every still-open ambiguity for the response.
   *
   * An update is interesting when the client's persisted frontier does not
   * dominate its result: it is concurrent with or newer than the work the
   * client had, so only those need their semantic delta reconstructed — by
   * replaying the log from the verified checkpoint and diffing the canonical
   * projections on either side of each import (FR-058).
   */
  async #detectAmbiguities(
    tx: Transaction,
    input: {
      readonly pageId: Uuid;
      readonly persistedVersionVector: Uint8Array;
    },
  ): Promise<ActivePageSyncResponseDto["ambiguities"]> {
    // Replay checkpoints may move forward while an authorized device still
    // owns an older branch. Semantic comparison therefore starts at the
    // checkpoint immediately before the first retained update, not at the
    // faster current replay checkpoint. After safe compaction those payloads
    // disappear and the promoted shallow checkpoint becomes this base.
    const firstRetainedRows = await tx
      .select({ pageSequence: schema.pageOperationUpdates.pageSequence })
      .from(schema.pageOperationUpdates)
      .where(
        and(
          eq(schema.pageOperationUpdates.workspaceId, this.#deps.workspaceId),
          eq(schema.pageOperationUpdates.pageId, input.pageId),
          isNotNull(schema.pageOperationUpdates.updateEnvelopeId),
        ),
      )
      .orderBy(asc(schema.pageOperationUpdates.pageSequence))
      .limit(1);
    const firstRetainedSequence = firstRetainedRows[0]?.pageSequence;
    if (firstRetainedSequence === undefined) {
      return await this.#openAmbiguities(tx, input.pageId);
    }
    const checkpointRow = await readPageOperationCheckpointAtSequence(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.pageId,
      throughPageSequence: firstRetainedSequence - 1,
    });
    if (checkpointRow === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The retained ambiguity window has no causal checkpoint.",
        409,
      );
    }
    const checkpointBytes = await this.#deps.crypto.openBytes(
      tx,
      "checkpoint",
      checkpointRow.snapshotEnvelopeId as Uuid,
    );
    const checkpointFrontier = await this.#deps.crypto.openFrontier(
      tx,
      checkpointRow.frontierEnvelopeId as Uuid,
    );
    const checkpoint: OperationalPageCheckpoint = {
      operationalFormat: "myownnotion.page-operations+loro",
      operationalVersion: 1,
      pageId: input.pageId,
      bytes: checkpointBytes,
      digest: checkpointRow.snapshotDigest,
      versionVector: checkpointFrontier.versionVector,
      frontiers: checkpointFrontier.frontiers,
    };
    const rows: PageOperationUpdateRow[] = [];
    let after = checkpointRow.throughPageSequence;
    for (;;) {
      const batch = await listPageOperationUpdatesAfter(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId: input.pageId,
        after,
        limit: 512,
      });
      if (batch.length === 0) break;
      rows.push(...batch);
      after = batch.at(-1)?.pageSequence ?? after;
      if (batch.length < 512) break;
    }
    if (
      rows.some(
        ({ baseFrontierEnvelopeId, updateEnvelopeId }) =>
          baseFrontierEnvelopeId === null || updateEnvelopeId === null,
      )
    ) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The ambiguity window was compacted beyond its active checkpoint.",
        409,
      );
    }
    const bases = new Map<string, Uint8Array>();
    const frontiers = await this.#deps.crypto.openFrontiers(
      tx,
      rows.flatMap(({ baseFrontierEnvelopeId, resultFrontierEnvelopeId }) => [
        baseFrontierEnvelopeId as Uuid,
        resultFrontierEnvelopeId as Uuid,
      ]),
    );
    for (const row of rows) {
      const baseFrontier = frontiers.get(row.baseFrontierEnvelopeId as Uuid);
      const resultFrontier = frontiers.get(row.resultFrontierEnvelopeId as Uuid);
      if (baseFrontier === undefined || resultFrontier === undefined) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "An operational update has an incomplete causal frontier.",
          409,
        );
      }
      bases.set(row.id, baseFrontier.versionVector);
    }
    if (rows.length > 1) {
      const updateBytes = await this.#deps.crypto.openBytesMany(
        tx,
        "update",
        rows.map(({ updateEnvelopeId }) => updateEnvelopeId as Uuid),
      );
      const candidates = rows.map((row) => {
        const bytes = updateBytes.get(row.updateEnvelopeId as Uuid);
        const baseVersionVector = bases.get(row.id);
        if (baseVersionVector === undefined || bytes === undefined) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "An operational update has incomplete retained content.",
            409,
          );
        }
        let authoredResultVersionVector: Uint8Array;
        try {
          authoredResultVersionVector = incrementalUpdateResultVersionVector(
            bytes,
            baseVersionVector,
          );
        } catch {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "An operational update has invalid retained causal metadata.",
            409,
          );
        }
        return { row, bytes, authoredResultVersionVector };
      });

      // Consecutive local operations are one intention. Keep only maximal
      // authored frontiers so a 30-keystroke offline edit is compared as the
      // complete branch, while genuinely divergent devices remain distinct.
      const tips: typeof candidates = [];
      for (const candidate of candidates) {
        if (
          tips.some((tip) =>
            versionVectorDominates(
              tip.authoredResultVersionVector,
              candidate.authoredResultVersionVector,
            ),
          )
        ) {
          continue;
        }
        for (let index = tips.length - 1; index >= 0; index -= 1) {
          const tip = tips[index];
          if (
            tip !== undefined &&
            versionVectorDominates(
              candidate.authoredResultVersionVector,
              tip.authoredResultVersionVector,
            )
          ) {
            tips.splice(index, 1);
          }
        }
        tips.push(candidate);
      }

      const hasUnseenTip = tips.some(
        (tip) =>
          !versionVectorDominates(input.persistedVersionVector, tip.authoredResultVersionVector),
      );
      if (tips.length > 1 && hasUnseenTip) {
        const commonCandidates = candidates.filter((candidate) =>
          tips.every((tip) =>
            versionVectorDominates(
              tip.authoredResultVersionVector,
              candidate.authoredResultVersionVector,
            ),
          ),
        );
        const commonIds = new Set(commonCandidates.map(({ row }) => row.id));
        const common = await OperationalPageDocument.fromCheckpoint({
          pageId: input.pageId,
          checkpoint,
        });
        if (common.importUpdates(commonCandidates.map(({ bytes }) => bytes)).pending) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "A retained common update has missing causal dependencies.",
            409,
          );
        }
        const commonCheckpoint = await common.checkpoint();
        const commonVersionVector = common.versionVectorBytes();
        const beforeBlocks = (await common.project()).document.blocks;

        // Replay each maximal branch independently from the common frontier.
        // A merged replay would let a CRDT-level deletion hide the edited
        // subtree before the semantic safety layer can preserve it (FR-058).
        const records: SemanticUpdateRecord[] = [];
        for (const tip of tips) {
          const branch = await OperationalPageDocument.fromCheckpoint({
            pageId: input.pageId,
            checkpoint: commonCheckpoint,
          });
          const branchUpdates = candidates
            .filter(
              (candidate) =>
                !commonIds.has(candidate.row.id) &&
                versionVectorDominates(
                  tip.authoredResultVersionVector,
                  candidate.authoredResultVersionVector,
                ),
            )
            .map(({ bytes }) => bytes);
          if (branch.importUpdates(branchUpdates).pending) {
            throw new PageOperationServiceError(
              "page-operations.projection-invalid",
              "A retained branch update has missing causal dependencies.",
              409,
            );
          }
          if (
            !versionVectorBytesEqual(branch.versionVectorBytes(), tip.authoredResultVersionVector)
          ) {
            throw new PageOperationServiceError(
              "page-operations.projection-invalid",
              "A retained branch did not reconstruct its authored frontier.",
              409,
            );
          }
          const afterBlocks = (await branch.project()).document.blocks;
          records.push(
            semanticRecordFromProjectionDiff({
              updateId: tip.row.id as Uuid,
              baseVersionVector: commonVersionVector,
              resultVersionVector: tip.authoredResultVersionVector,
              beforeBlocks,
              afterBlocks,
            }),
          );
        }
        for (const ambiguity of detectPageAmbiguities(records)) {
          const existing = await readPageAmbiguityByLogicalKey(tx, {
            pageId: input.pageId,
            logicalKey: ambiguity.logicalKey,
          });
          if (existing !== null) continue;
          const detailsEnvelopeId = await this.#deps.crypto.sealBytes(
            tx,
            "ambiguity",
            new TextEncoder().encode(JSON.stringify(ambiguity)),
          );
          await insertPageAmbiguity(tx, {
            ambiguityId: generateUuidV7(),
            pageId: input.pageId,
            workspaceId: this.#deps.workspaceId,
            logicalKey: ambiguity.logicalKey,
            kind: ambiguity.kind,
            detailsEnvelopeId,
            sourceUpdateIds: [...ambiguity.sourceUpdateIds],
            openedAt: this.#deps.now(),
          });
        }
      }
    }

    return await this.#openAmbiguities(tx, input.pageId);
  }

  async #openAmbiguities(
    tx: Transaction,
    pageId: Uuid,
  ): Promise<ActivePageSyncResponseDto["ambiguities"]> {
    const open = await listOpenPageAmbiguities(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId,
    });
    const details = await this.#deps.crypto.openBytesMany(
      tx,
      "ambiguity",
      open.map(({ detailsEnvelopeId }) => detailsEnvelopeId as Uuid),
    );
    return open.map((row) => {
      const bytes = details.get(row.detailsEnvelopeId as Uuid);
      if (bytes === undefined) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "An open ambiguity has no retained details.",
          409,
        );
      }
      return {
        ambiguityId: row.id as Uuid,
        pageId,
        kind: row.kind as ActivePageSyncResponseDto["ambiguities"][number]["kind"],
        blockIds: blockIdsFromAmbiguityDetails(bytes, row.logicalKey),
        openedAt: row.openedAt.toISOString(),
        status: "open" as const,
      };
    });
  }
}

/**
 * Summaries deliberately expose block identities, never source update ids.
 * Both happen to be UUIDs in the logical key, so the sealed detail is the
 * only unambiguous source for this field.
 */
function blockIdsFromAmbiguityDetails(bytes: Uint8Array, logicalKey: string): Uuid[] {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    value = null;
  }
  if (value === null || typeof value !== "object") {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "An open ambiguity has invalid retained details.",
      409,
    );
  }
  const record = value as Record<string, unknown>;
  if (record["logicalKey"] !== logicalKey || !Array.isArray(record["blockIds"])) {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "An open ambiguity does not match its retained details.",
      409,
    );
  }
  return record["blockIds"] as Uuid[];
}
