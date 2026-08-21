/**
 * Transactional import and bidirectional catch-up for active operational pages
 * (T139, US5).
 */

import type { ActivePageSyncRequestDto, ActivePageSyncResponseDto } from "@myownnotion/contracts";
import {
  appendAcceptedPageOperationUpdate,
  confirmPageDeviceFrontier,
  type Database,
  listPageOperationUpdatesAfter,
  lockPageOperationState,
  type PageOperationStateRow,
  readPageDeviceFrontier,
  readPageOperationCheckpoint,
  readPageOperationUpdate,
  recordChange,
  runMutation,
  schema,
  type Transaction,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import {
  type OperationalPageCheckpoint,
  OperationalPageDocument,
  sha256Hex,
  verifyIncrementalUpdateBase,
  versionVectorDominates,
} from "@myownnotion/page-state";
import type { SearchService } from "../search/search-service.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import type { CanonicalMaterializer } from "./canonical-materializer.ts";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";

export interface PageOperationServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly materializer: CanonicalMaterializer;
  readonly rotationPolicies: RotationPolicyService;
  readonly search?: SearchService | undefined;
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
}

export class PageOperationService {
  readonly #deps: Required<Pick<PageOperationServiceDeps, "now">> &
    Omit<PageOperationServiceDeps, "now">;

  constructor(deps: PageOperationServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async #load(tx: Transaction, pageId: Uuid): Promise<LoadedOperationalPage> {
    const state = await lockPageOperationState(tx, this.#deps.workspaceId, pageId);
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
      for (const row of rows) {
        const bytes = await this.#deps.crypto.openBytes(tx, "update", row.updateEnvelopeId as Uuid);
        if ((await sha256Hex(bytes)) !== row.updateDigest || document.importUpdate(bytes).pending) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The operational update log failed verification.",
            409,
          );
        }
        after = row.pageSequence;
      }
    }

    const projection = await document.project();
    if (
      projection.canonicalDigest !== state.canonicalDigest ||
      projection.operationalDigest !== state.operationalDigest
    ) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The operational state no longer matches its canonical projection.",
        409,
      );
    }
    return { document, state };
  }

  /** Shared locked loader for migration and later server-side maintenance. */
  async loadForMutation(tx: Transaction, pageId: Uuid): Promise<LoadedOperationalPage> {
    return await this.#load(tx, pageId);
  }

  async sync(input: {
    readonly pageId: Uuid;
    readonly deviceId: Uuid;
    readonly request: ActivePageSyncRequestDto;
  }): Promise<ActivePageSyncResponseDto> {
    let committedSequence: number | undefined;
    const response = await runMutation(this.#deps.db, async (tx) => {
      await this.#deps.rotationPolicies.assertWritesAllowed(tx);
      const loaded = await this.#load(tx, input.pageId);
      let state = loaded.state;
      const document = loaded.document;
      const accepted: ActivePageSyncResponseDto["accepted"] = [];
      const repeated: ActivePageSyncResponseDto["repeated"] = [];
      const responseUpdateIds = new Set<string>();
      const newUpdates = [] as ActivePageSyncRequestDto["updates"][number][];

      for (const candidate of input.request.updates) {
        const existing = await readPageOperationUpdate(tx, candidate.updateId as Uuid);
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
        const result = await this.#deps.crypto.openFrontier(
          tx,
          existing.resultFrontierEnvelopeId as Uuid,
        );
        repeated.push({
          updateId: existing.id as Uuid,
          pageSequence: existing.pageSequence,
          resultVersionVector: encode(result.versionVector),
        });
        responseUpdateIds.add(existing.id);
      }

      const pending = [...newUpdates];
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
          const [projection, resultCheckpoint] = await Promise.all([
            document.project(),
            document.checkpoint(),
          ]);
          const baseFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
            versionVector: baseVersionVector,
            frontiers: document.frontiersForVersionVector(baseVersionVector),
          });
          const resultFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
            versionVector: resultCheckpoint.versionVector,
            frontiers: resultCheckpoint.frontiers,
          });
          const updateEnvelopeId = await this.#deps.crypto.sealBytes(tx, "update", updateBytes);
          const appended = await appendAcceptedPageOperationUpdate(tx, {
            updateId: candidate.updateId as Uuid,
            pageId: input.pageId,
            workspaceId: this.#deps.workspaceId,
            authoredByDeviceId: input.deviceId,
            baseFrontierEnvelopeId,
            resultFrontierEnvelopeId,
            updateEnvelopeId,
            updateDigest: candidate.updateDigest,
            operationalDigest: projection.operationalDigest,
            canonicalDigest: projection.canonicalDigest,
            acceptedAt: this.#deps.now(),
          });
          state = appended.state;
          accepted.push({
            updateId: candidate.updateId as Uuid,
            pageSequence: appended.pageSequence,
            resultVersionVector: encode(resultCheckpoint.versionVector),
          });
          responseUpdateIds.add(candidate.updateId);
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

      const projection = await document.project();
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
      }

      const persistedVersionVector = decode(input.request.persistedVersionVector);
      if (!versionVectorDominates(document.versionVectorBytes(), persistedVersionVector)) {
        throw new PageOperationServiceError(
          "page-operations.dependencies-missing",
          "The durable client frontier contains updates that were not submitted.",
          409,
        );
      }
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
        let confirmedPageSequence = 0;
        let after = 0;
        while (after < state.lastUpdateSequence) {
          const rows = await listPageOperationUpdatesAfter(tx, {
            workspaceId: this.#deps.workspaceId,
            pageId: input.pageId,
            after,
            limit: 256,
          });
          if (rows.length === 0) break;
          for (const row of rows) {
            const result = await this.#deps.crypto.openFrontier(
              tx,
              row.resultFrontierEnvelopeId as Uuid,
            );
            if (versionVectorDominates(persistedVersionVector, result.versionVector)) {
              confirmedPageSequence = row.pageSequence;
            }
            after = row.pageSequence;
          }
        }
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
      const candidates = await listPageOperationUpdatesAfter(tx, {
        workspaceId: this.#deps.workspaceId,
        pageId: input.pageId,
        after: input.request.knownServerPageSequence,
        limit: 65,
      });
      const remoteUpdates: ActivePageSyncResponseDto["remoteUpdates"] = [];
      let remoteBytes = 0;
      let throughPageSequence = input.request.knownServerPageSequence;
      for (const row of candidates.slice(0, 64)) {
        if (responseUpdateIds.has(row.id)) {
          throughPageSequence = row.pageSequence;
          continue;
        }
        const result = await this.#deps.crypto.openFrontier(
          tx,
          row.resultFrontierEnvelopeId as Uuid,
        );
        if (versionVectorDominates(persistedVersionVector, result.versionVector)) {
          throughPageSequence = row.pageSequence;
          continue;
        }
        const bytes = await this.#deps.crypto.openBytes(tx, "update", row.updateEnvelopeId as Uuid);
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
        ambiguities: [],
        fileRequirements,
      };
    });
    announceCommitted(committedSequence);
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
}
