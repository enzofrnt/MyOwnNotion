/**
 * Atomic lazy activation of a canonical page into operational Loro state
 * (T140, US5).
 */

import type { PageCheckpointResponseDto, RemotePageUpdateDto } from "@myownnotion/contracts";
import {
  activatePageOperationState,
  type Database,
  insertInitializingPageOperationState,
  insertPageOperationCheckpoint,
  isSerializationFailure,
  isUniqueViolation,
  listPageOperationUpdatesAfter,
  readItem,
  readPageOperationCheckpoint,
  readPageOperationState,
  runMutation,
  schema,
} from "@myownnotion/database";
import {
  type BlockDocumentV3,
  documentDigestV3,
  migrateStoredPageDocumentToV3,
  serialiseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { resolveProtectedContent } from "../security/content-resolution.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";

export interface PageActivationServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly protectedContent: ProtectedContent;
  readonly rotationPolicies: RotationPolicyService;
  readonly now?: () => Date;
}

function canonicalV3(input: {
  readonly formatVersion: number;
  readonly body: Record<string, unknown>;
}): BlockDocumentV3 {
  const migrated = migrateStoredPageDocumentToV3(input);
  if (!migrated.ok) {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "The canonical page cannot be activated without reducing its content.",
      409,
    );
  }
  return migrated.document;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export class PageActivationService {
  readonly #deps: Required<Pick<PageActivationServiceDeps, "now">> &
    Omit<PageActivationServiceDeps, "now">;

  constructor(deps: PageActivationServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async activate(input: {
    readonly pageId: Uuid;
    readonly requestId: Uuid;
    readonly expectedRevisionId: Uuid;
    readonly expectedCanonicalDigest: string;
    readonly maxRemoteBytes?: number;
  }): Promise<PageCheckpointResponseDto> {
    // Two tabs opening the same page race here on purpose (React strict
    // effects, a double click). Serializable isolation aborts the loser with
    // 40001, and losing an insert race surfaces as 23505; both mean "the
    // winner already activated this page", which is the idempotent answer —
    // one bounded retry re-reads the state and returns its checkpoint.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await runMutation(this.#deps.db, async (tx) => {
          await this.#deps.rotationPolicies.assertWritesAllowed(tx);
          const existing = await readPageOperationState(tx, this.#deps.workspaceId, input.pageId);
          if (existing?.status === "active") return;
          if (existing !== null) {
            throw new PageOperationServiceError(
              "page-operations.projection-invalid",
              "The operational page is not in an activatable state.",
              409,
            );
          }

          const stored = await readItem(tx, input.pageId);
          const [item] =
            stored === null
              ? []
              : await resolveProtectedContent(tx, [stored], this.#deps.protectedContent);
          if (item === undefined || item.kind !== "page" || item.pageDocument === null) {
            throw new PageOperationServiceError("item.not-found", "Page not found.", 404);
          }
          if (item.currentRevisionId !== input.expectedRevisionId) {
            throw new PageOperationServiceError(
              "page-operations.activation-stale",
              "The page changed before operational synchronization could be activated.",
              409,
            );
          }

          const document = canonicalV3(item.pageDocument);
          const canonicalDigest = await documentDigestV3(document);
          if (canonicalDigest !== input.expectedCanonicalDigest) {
            throw new PageOperationServiceError(
              "page-operations.activation-stale",
              "The page digest changed before operational synchronization could be activated.",
              409,
            );
          }

          const operational = OperationalPageDocument.create({ pageId: input.pageId, document });
          const [checkpoint, projection] = await Promise.all([
            operational.checkpoint(),
            operational.project(),
          ]);
          if (projection.canonicalDigest !== canonicalDigest) {
            throw new PageOperationServiceError(
              "page-operations.projection-invalid",
              "The operational projection does not reproduce the canonical page.",
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
          const now = this.#deps.now();
          await insertInitializingPageOperationState(tx, {
            pageId: input.pageId,
            workspaceId: this.#deps.workspaceId,
            canonicalDigest,
            lastRevisionId: item.currentRevisionId,
            now,
          });
          const checkpointId = crypto.randomUUID() as Uuid;
          await insertPageOperationCheckpoint(tx, {
            checkpointId,
            pageId: input.pageId,
            workspaceId: this.#deps.workspaceId,
            throughPageSequence: 0,
            frontierEnvelopeId,
            snapshotEnvelopeId,
            snapshotDigest: checkpoint.digest,
            canonicalDigest,
            revisionId: item.currentRevisionId,
            state: "verified",
            now,
          });

          const body = serialiseDocumentV3(projection.document);
          await tx
            .insert(schema.pageDocuments)
            .values({
              pageId: input.pageId,
              format: "myownnotion.document+json",
              formatVersion: 3,
              body,
            })
            .onConflictDoUpdate({
              target: schema.pageDocuments.pageId,
              set: { format: "myownnotion.document+json", formatVersion: 3, body },
            });
          await this.#deps.protectedContent.writePageBody(tx, {
            pageId: input.pageId,
            recordVersion: 1,
            body,
          });
          await activatePageOperationState(tx, {
            pageId: input.pageId,
            workspaceId: this.#deps.workspaceId,
            checkpointId,
            frontierEnvelopeId,
            operationalDigest: projection.operationalDigest,
            canonicalDigest,
            lastRevisionId: item.currentRevisionId,
            now,
          });
        });
        break;
      } catch (error) {
        const raced =
          isUniqueViolation(error, "page_operation_states_page_workspace_unique") ||
          isSerializationFailure(error);
        if (!raced || attempt === 1) throw error;
      }
    }
    return await this.checkpointResponse({
      pageId: input.pageId,
      requestId: input.requestId,
      maxRemoteBytes: input.maxRemoteBytes ?? 1024 * 1024,
    });
  }

  /**
   * Server-authoritative lazy activation used by a legacy offline branch.
   *
   * The old client only knows the revision it branched from, which may no
   * longer be the head. We therefore read the current head and still pass it
   * through the ordinary compare-and-activate guard. A concurrent canonical
   * write merely retries with the newer head; it is never overwritten.
   */
  async activateCurrent(input: {
    readonly pageId: Uuid;
    readonly requestId: Uuid;
    readonly maxRemoteBytes?: number;
  }): Promise<PageCheckpointResponseDto> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.#deps.db.transaction(async (tx) => {
        const stored = await readItem(tx, input.pageId);
        const [item] =
          stored === null
            ? []
            : await resolveProtectedContent(tx, [stored], this.#deps.protectedContent);
        if (item === undefined || item.kind !== "page" || item.pageDocument === null) return null;
        const document = canonicalV3(item.pageDocument);
        return {
          revisionId: item.currentRevisionId,
          canonicalDigest: await documentDigestV3(document),
        };
      });
      if (current === null) {
        throw new PageOperationServiceError("item.not-found", "Page not found.", 404);
      }
      try {
        return await this.activate({
          pageId: input.pageId,
          requestId: input.requestId,
          expectedRevisionId: current.revisionId,
          expectedCanonicalDigest: current.canonicalDigest,
          ...(input.maxRemoteBytes === undefined ? {} : { maxRemoteBytes: input.maxRemoteBytes }),
        });
      } catch (error) {
        if (
          !(error instanceof PageOperationServiceError) ||
          error.code !== "page-operations.activation-stale"
        ) {
          throw error;
        }
      }
    }
    throw new PageOperationServiceError(
      "page-operations.activation-stale",
      "The page kept changing while operational synchronization was activated.",
      409,
    );
  }

  async checkpointResponse(input: {
    readonly pageId: Uuid;
    readonly requestId: Uuid;
    readonly maxRemoteBytes: number;
  }): Promise<PageCheckpointResponseDto> {
    return await this.#deps.db.transaction(
      async (tx) => {
        const state = await readPageOperationState(tx, this.#deps.workspaceId, input.pageId);
        if (state === null || state.status === "legacy") {
          throw new PageOperationServiceError(
            "page-operations.not-active",
            "The page has not entered operational synchronization yet.",
            409,
          );
        }
        if (state.status !== "active" || state.currentCheckpointId === null) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The page has no verified operational checkpoint.",
            409,
          );
        }
        const checkpoint = await readPageOperationCheckpoint(tx, {
          workspaceId: this.#deps.workspaceId,
          pageId: input.pageId,
          checkpointId: state.currentCheckpointId as Uuid,
        });
        if (checkpoint === null || !["verified", "retained"].includes(checkpoint.state)) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The current operational checkpoint is not verified.",
            409,
          );
        }

        const snapshot = await this.#deps.crypto.openBytes(
          tx,
          "checkpoint",
          checkpoint.snapshotEnvelopeId as Uuid,
        );
        if ((await sha256Hex(snapshot)) !== checkpoint.snapshotDigest) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The current operational checkpoint failed its integrity check.",
            409,
          );
        }
        const frontier = await this.#deps.crypto.openFrontier(
          tx,
          checkpoint.frontierEnvelopeId as Uuid,
        );
        const candidates = await listPageOperationUpdatesAfter(tx, {
          workspaceId: this.#deps.workspaceId,
          pageId: input.pageId,
          after: checkpoint.throughPageSequence,
          limit: 65,
        });
        const followingUpdates: RemotePageUpdateDto[] = [];
        let totalBytes = 0;
        for (const update of candidates.slice(0, 64)) {
          const bytes = await this.#deps.crypto.openBytes(
            tx,
            "update",
            update.updateEnvelopeId as Uuid,
          );
          if (followingUpdates.length > 0 && totalBytes + bytes.byteLength > input.maxRemoteBytes)
            break;
          if (bytes.byteLength > input.maxRemoteBytes) break;
          totalBytes += bytes.byteLength;
          followingUpdates.push({
            updateId: update.id as Uuid,
            pageSequence: update.pageSequence,
            authoredByDeviceId: update.authoredByDeviceId as Uuid,
            updateBytes: base64url(bytes),
            updateDigest: update.updateDigest,
            acceptedAt: update.acceptedAt.toISOString(),
          });
        }

        return {
          mode: "checkpoint",
          requestId: input.requestId,
          pageId: input.pageId,
          operationalVersion: 1,
          checkpointId: checkpoint.id as Uuid,
          checkpointBytes: base64url(snapshot),
          checkpointDigest: checkpoint.snapshotDigest,
          versionVector: base64url(frontier.versionVector),
          throughPageSequence: checkpoint.throughPageSequence,
          canonicalDigest: checkpoint.canonicalDigest,
          lastConsolidatedRevisionId: state.lastRevisionId as Uuid | null,
          hasUnconsolidatedChanges: state.revisionWindowStartedAt !== null,
          followingUpdates,
          latestPageSequence: state.lastUpdateSequence,
          hasMore:
            candidates.length > followingUpdates.length ||
            state.lastUpdateSequence >
              (followingUpdates.at(-1)?.pageSequence ?? checkpoint.throughPageSequence),
          ambiguities: [],
        };
      },
      // READ COMMITTED can observe the state row before a concurrent append
      // and the update rows after it, producing a checkpoint whose declared
      // latest sequence is lower than an included update. One repeatable
      // read-only snapshot keeps every field in this response on the same
      // causal frontier without blocking writers.
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async isActive(pageId: Uuid): Promise<boolean> {
    const state = await readPageOperationState(this.#deps.db, this.#deps.workspaceId, pageId);
    return state?.status === "active" || state?.status === "blocked";
  }
}
