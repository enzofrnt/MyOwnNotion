/** One-time, idempotent conversion of pre-activation offline page edits. */

import { createHash } from "node:crypto";
import {
  type LegacyBranchConvertedResponseDto,
  type LegacyOfflineBranchSyncRequestDto,
  MAX_PAGE_UPDATE_BATCH_BYTES,
  parsePageSyncResponse,
} from "@myownnotion/contracts";
import {
  appendAcceptedPageOperationUpdate,
  completeLegacyBranchConversion,
  type Database,
  getRevision,
  insertLegacyBranchConversion,
  insertPageAmbiguity,
  listOpenPageAmbiguities,
  listPageOperationUpdatesAfter,
  lockItemRevisionHead,
  lockLegacyBranchConversion,
  readPageAmbiguityByLogicalKey,
  readPageOperationCheckpoint,
  recordChange,
  revisionDescendsFrom,
  runMutation,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  type BlockDocument,
  documentDigestV3,
  generateUuidV7,
  migrateDocumentV2ToV3,
  migrateStoredPageDocumentToV3,
  normaliseDocument,
  normaliseDocumentV3,
  readDocumentBody,
  readVersionedDocumentEnvelope,
  type Uuid,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import {
  convertLegacyOfflineBranch,
  type LegacyOfflineBranch,
  type LegacySemanticTransaction,
  type PageAmbiguity,
  sha256Hex,
  verifyLegacyOfflineBranch,
} from "@myownnotion/page-state";
import type { SearchService } from "../search/search-service.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { authorizeSynchronizationWrite } from "../security/synchronization-authorization.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import type { CanonicalMaterializer } from "./canonical-materializer.ts";
import type { PageActivationService } from "./page-activation-service.ts";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";
import type { PageOperationService } from "./page-operation-service.ts";

export interface LegacyBranchServiceDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly crypto: PageOperationCrypto;
  readonly protectedContent: ProtectedContent;
  readonly materializer: CanonicalMaterializer;
  readonly activation: PageActivationService;
  readonly operations: PageOperationService;
  readonly rotationPolicies: RotationPolicyService;
  readonly search?: SearchService | undefined;
  readonly onPageCommitted?:
    | ((event: { readonly pageId: Uuid; readonly latestPageSequence: number }) => void)
    | undefined;
  readonly now?: () => Date;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestDigest(request: LegacyOfflineBranchSyncRequestDto): string {
  const { requestId: _requestId, ...stableBranch } = request;
  return createHash("sha256").update(canonicalJson(stableBranch)).digest("hex");
}

function parseV2Document(envelope: unknown): BlockDocument {
  const read = readVersionedDocumentEnvelope(envelope);
  if (read.kind === "v2") {
    if (!read.result.ok) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The legacy base document is invalid.",
        409,
      );
    }
    return normaliseDocument(read.result.document);
  }
  if (
    envelope !== null &&
    typeof envelope === "object" &&
    (envelope as Record<string, unknown>)["format"] === "myownnotion.document+json" &&
    (envelope as Record<string, unknown>)["formatVersion"] === 1
  ) {
    const body = (envelope as Record<string, unknown>)["body"];
    const legacy = readDocumentBody(body);
    if (legacy.kind === "legacy") return normaliseDocument(upgradeLegacyBody(legacy.body));
    if (legacy.result.ok) return normaliseDocument(legacy.result.document);
  }
  throw new PageOperationServiceError(
    "page-operations.schema-unsupported",
    "The retained legacy base cannot be represented as a v2 document.",
    409,
  );
}

function parseLocalDocument(request: LegacyOfflineBranchSyncRequestDto) {
  const read = readVersionedDocumentEnvelope(request.localDocument);
  if (read.kind !== "v3" || !read.result.ok) {
    throw new PageOperationServiceError(
      "page-operations.projection-invalid",
      "The legacy branch local document is invalid.",
      409,
    );
  }
  return normaliseDocumentV3(read.result.document);
}

function snapshotPageDocument(snapshot: unknown): unknown {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot))
    return undefined;
  return (snapshot as Record<string, unknown>)["pageDocument"];
}

function migrateEnvelope(envelope: unknown) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const record = envelope as Record<string, unknown>;
  if (typeof record["formatVersion"] !== "number") return null;
  const migrated = migrateStoredPageDocumentToV3({
    formatVersion: record["formatVersion"],
    body: record["body"],
  });
  return migrated.ok ? normaliseDocumentV3(migrated.document) : null;
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export class LegacyBranchService {
  readonly #deps: Required<Pick<LegacyBranchServiceDeps, "now">> &
    Omit<LegacyBranchServiceDeps, "now">;

  constructor(deps: LegacyBranchServiceDeps) {
    this.#deps = { ...deps, now: deps.now ?? (() => new Date()) };
  }

  async #branch(
    tx: Transaction,
    pageId: Uuid,
    request: LegacyOfflineBranchSyncRequestDto,
    operationalBoundaryId: Uuid | null,
  ): Promise<LegacyOfflineBranch> {
    const revision = await getRevision(tx, request.baseRevisionId as Uuid);
    if (revision === null || revision.itemId !== pageId) {
      throw new PageOperationServiceError(
        "page-operations.dependencies-missing",
        "The legacy branch base revision is not part of this page.",
        409,
      );
    }
    const retainedProtected = await this.#deps.protectedContent.readRevisionSnapshot<
      Record<string, unknown>
    >(tx, revision.id);
    const retainedEnvelope = snapshotPageDocument(retainedProtected ?? revision.snapshot);
    const suppliedEnvelope = request.baseDocument;
    const baseEnvelope = suppliedEnvelope ?? retainedEnvelope;
    if (baseEnvelope === undefined) {
      throw new PageOperationServiceError(
        "page-operations.dependencies-missing",
        "The legacy branch base snapshot is no longer retained and was not supplied.",
        409,
      );
    }
    const baseDocumentV2 = parseV2Document(baseEnvelope);
    const baseDocument = normaliseDocumentV3(migrateDocumentV2ToV3(baseDocumentV2));
    const baseDigest = await documentDigestV3(baseDocument);
    if (baseDigest !== request.baseCanonicalDigest) {
      throw new PageOperationServiceError(
        "page-operations.digest-mismatch",
        "The legacy branch base does not match its canonical digest.",
        409,
      );
    }
    if (suppliedEnvelope !== undefined && retainedEnvelope !== undefined) {
      const retained = migrateEnvelope(retainedEnvelope);
      if (retained !== null && (await documentDigestV3(retained)) !== baseDigest) {
        throw new PageOperationServiceError(
          "page-operations.digest-mismatch",
          "The supplied legacy base differs from the retained revision.",
          409,
        );
      }
    }

    if (operationalBoundaryId === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The active page has no canonical revision boundary.",
        409,
      );
    }
    const itemRevisionHead = await lockItemRevisionHead(tx, this.#deps.workspaceId, pageId);
    if (itemRevisionHead === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The active page has no canonical item head.",
        409,
      );
    }
    if (!(await revisionDescendsFrom(tx, itemRevisionHead, operationalBoundaryId))) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The canonical and operational page histories no longer share a safe frontier.",
        409,
      );
    }
    if (!(await revisionDescendsFrom(tx, itemRevisionHead, request.baseRevisionId as Uuid))) {
      throw new PageOperationServiceError(
        "page-operations.dependencies-missing",
        "The legacy branch base is not an ancestor of the canonical page.",
        409,
      );
    }

    const branch: LegacyOfflineBranch = {
      mode: "legacy-branch",
      branchId: request.branchId as Uuid,
      pageId,
      baseRevisionId: request.baseRevisionId as Uuid,
      baseCanonicalDigest: request.baseCanonicalDigest,
      baseDocumentV2,
      baseDocument,
      localDocument: parseLocalDocument(request),
      localDocumentDigest: request.localDocumentDigest,
      semanticTransactions:
        request.semanticTransactions as unknown as readonly LegacySemanticTransaction[],
      createdAt: request.createdAt,
      status: "sending",
    };
    try {
      await verifyLegacyOfflineBranch(branch);
    } catch {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The legacy branch journal does not reconstruct its local document.",
        409,
      );
    }
    return branch;
  }

  async #storedResponse(
    tx: Transaction,
    envelopeId: Uuid,
    requestId: Uuid,
  ): Promise<LegacyBranchConvertedResponseDto> {
    const bytes = await this.#deps.crypto.openBytes(tx, "legacyResponse", envelopeId);
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The stored legacy conversion response is invalid.",
        409,
      );
    }
    const parsed = parsePageSyncResponse(value);
    if (!("convertedBranchId" in parsed)) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The stored legacy conversion response has the wrong mode.",
        409,
      );
    }
    return { ...parsed, requestId };
  }

  async #response(
    tx: Transaction,
    input: {
      readonly pageId: Uuid;
      readonly requestId: Uuid;
      readonly branchId: Uuid;
      readonly localDocumentDigest: string;
      readonly conversionUpdateIds: readonly Uuid[];
    },
  ): Promise<LegacyBranchConvertedResponseDto> {
    const loaded = await this.#deps.operations.loadForMutation(tx, input.pageId);
    const state = loaded.state;
    if (state.currentCheckpointId === null) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The converted page has no checkpoint.",
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
        "The converted page checkpoint is not verified.",
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
        "The converted page checkpoint failed verification.",
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
    const followingUpdates: LegacyBranchConvertedResponseDto["followingUpdates"] = [];
    let totalBytes = 0;
    for (const update of candidates.slice(0, 64)) {
      const bytes = await this.#deps.crypto.openBytes(
        tx,
        "update",
        update.updateEnvelopeId as Uuid,
      );
      if (
        followingUpdates.length > 0 &&
        totalBytes + bytes.byteLength > MAX_PAGE_UPDATE_BATCH_BYTES
      )
        break;
      if (bytes.byteLength > MAX_PAGE_UPDATE_BATCH_BYTES) break;
      totalBytes += bytes.byteLength;
      followingUpdates.push({
        updateId: update.id as Uuid,
        pageSequence: update.pageSequence,
        authoredByDeviceId: update.authoredByDeviceId as Uuid,
        updateBytes: encode(bytes),
        updateDigest: update.updateDigest,
        acceptedAt: update.acceptedAt.toISOString(),
      });
    }
    const ambiguityRows = await listOpenPageAmbiguities(tx, {
      workspaceId: this.#deps.workspaceId,
      pageId: input.pageId,
    });
    const ambiguities = await Promise.all(
      ambiguityRows.map(async (ambiguity) => {
        const bytes = await this.#deps.crypto.openBytes(
          tx,
          "ambiguity",
          ambiguity.detailsEnvelopeId as Uuid,
        );
        let details: PageAmbiguity;
        try {
          details = JSON.parse(Buffer.from(bytes).toString("utf8")) as PageAmbiguity;
        } catch {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "A stored page ambiguity is invalid.",
            409,
          );
        }
        if (details.logicalKey !== ambiguity.logicalKey || details.kind !== ambiguity.kind) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "A stored page ambiguity does not match its routing metadata.",
            409,
          );
        }
        return {
          ambiguityId: ambiguity.id as Uuid,
          pageId: ambiguity.pageId as Uuid,
          kind: ambiguity.kind as LegacyBranchConvertedResponseDto["ambiguities"][number]["kind"],
          blockIds: [...details.blockIds],
          openedAt: ambiguity.openedAt.toISOString(),
          status: "open" as const,
        };
      }),
    );
    return {
      mode: "checkpoint",
      requestId: input.requestId,
      pageId: input.pageId,
      operationalVersion: 1,
      checkpointId: checkpoint.id as Uuid,
      checkpointBytes: encode(snapshot),
      checkpointDigest: checkpoint.snapshotDigest,
      versionVector: encode(frontier.versionVector),
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
      ambiguities,
      convertedBranchId: input.branchId,
      conversionUpdateIds: [...input.conversionUpdateIds],
      localDocumentDigest: input.localDocumentDigest,
    };
  }

  async convert(input: {
    readonly pageId: Uuid;
    readonly ownerId: string;
    readonly deviceId: Uuid;
    readonly request: LegacyOfflineBranchSyncRequestDto;
  }): Promise<LegacyBranchConvertedResponseDto> {
    await this.#deps.activation.activateCurrent({
      pageId: input.pageId,
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      requestId: input.request.requestId as Uuid,
      maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
    });
    const digest = requestDigest(input.request);
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
      const loaded = await this.#deps.operations.loadForMutation(tx, input.pageId);
      const existing = await lockLegacyBranchConversion(tx, input.request.branchId as Uuid);
      if (existing !== null) {
        if (
          existing.pageId !== input.pageId ||
          existing.workspaceId !== this.#deps.workspaceId ||
          existing.requestDigest !== digest ||
          existing.localDocumentDigest !== input.request.localDocumentDigest
        ) {
          throw new PageOperationServiceError(
            "page-operations.update-id-reused",
            "A legacy branch identity was reused with different content.",
            409,
          );
        }
        if (existing.status !== "converted" || existing.responseEnvelopeId === null) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The legacy branch conversion did not finish cleanly.",
            409,
          );
        }
        return await this.#storedResponse(
          tx,
          existing.responseEnvelopeId as Uuid,
          input.request.requestId as Uuid,
        );
      }

      const branch = await this.#branch(
        tx,
        input.pageId,
        input.request,
        loaded.state.lastRevisionId as Uuid | null,
      );
      await insertLegacyBranchConversion(tx, {
        branchId: branch.branchId,
        pageId: input.pageId,
        workspaceId: this.#deps.workspaceId,
        requestDigest: digest,
        localDocumentDigest: branch.localDocumentDigest,
        createdAt: new Date(branch.createdAt),
      });
      const conversion = await convertLegacyOfflineBranch({
        branch,
        activePage: loaded.document,
      });
      const conversionUpdateIds: Uuid[] = [];
      let state = loaded.state;
      if (conversion.transaction !== undefined) {
        const transaction = conversion.transaction;
        const projection = await loaded.document.project();
        const baseFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
          versionVector: transaction.baseVersionVector,
          frontiers: loaded.document.frontiersForVersionVector(transaction.baseVersionVector),
        });
        const resultCheckpoint = await loaded.document.checkpoint();
        const resultFrontierEnvelopeId = await this.#deps.crypto.sealFrontier(tx, {
          versionVector: resultCheckpoint.versionVector,
          frontiers: resultCheckpoint.frontiers,
        });
        const updateEnvelopeId = await this.#deps.crypto.sealBytes(
          tx,
          "update",
          transaction.updateBytes,
        );
        const updateId = generateUuidV7();
        const appended = await appendAcceptedPageOperationUpdate(tx, {
          updateId,
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
        state = appended.state;
        conversionUpdateIds.push(updateId);
        if (state.lastRevisionId === null) {
          throw new PageOperationServiceError(
            "page-operations.projection-invalid",
            "The converted page has no retained revision boundary.",
            409,
          );
        }
        await this.#deps.materializer.materialize(tx, {
          workspaceId: this.#deps.workspaceId,
          pageId: input.pageId,
          revisionId: state.lastRevisionId as Uuid,
          projection,
        });
      }

      for (const ambiguity of conversion.ambiguities) {
        const prior = await readPageAmbiguityByLogicalKey(tx, {
          pageId: input.pageId,
          logicalKey: ambiguity.logicalKey,
        });
        if (prior !== null) continue;
        const detailsEnvelopeId = await this.#deps.crypto.sealBytes(
          tx,
          "ambiguity",
          Buffer.from(JSON.stringify(ambiguity), "utf8"),
        );
        await insertPageAmbiguity(tx, {
          ambiguityId: generateUuidV7(),
          pageId: input.pageId,
          workspaceId: this.#deps.workspaceId,
          logicalKey: ambiguity.logicalKey,
          kind: ambiguity.kind,
          detailsEnvelopeId,
          sourceUpdateIds: ambiguity.sourceUpdateIds,
          openedAt: this.#deps.now(),
        });
      }

      const converted = await this.#response(tx, {
        pageId: input.pageId,
        requestId: input.request.requestId as Uuid,
        branchId: branch.branchId,
        localDocumentDigest: branch.localDocumentDigest,
        conversionUpdateIds,
      });
      const responseEnvelopeId = await this.#deps.crypto.sealBytes(
        tx,
        "legacyResponse",
        Buffer.from(JSON.stringify(converted), "utf8"),
      );
      await completeLegacyBranchConversion(tx, {
        branchId: branch.branchId,
        requestDigest: digest,
        responseEnvelopeId,
        checkpointId: converted.checkpointId as Uuid,
        conversionUpdateIds,
        convertedAt: this.#deps.now(),
      });

      if (state.lastRevisionId === null) {
        throw new PageOperationServiceError(
          "page-operations.projection-invalid",
          "The converted page has no revision for its change feed.",
          409,
        );
      }
      const mutationId = conversionUpdateIds[0] ?? branch.branchId;
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
      return converted;
    });
    announceCommitted(committedSequence);
    if (committedSequence !== undefined) {
      try {
        this.#deps.onPageCommitted?.({
          pageId: input.pageId,
          latestPageSequence: response.latestPageSequence,
        });
      } catch {
        // Durable conversion wins over an ephemeral notification failure.
      }
    }
    if (committedSequence !== undefined && this.#deps.search !== undefined) {
      try {
        await this.#deps.search.applyCommittedChanges([input.pageId], committedSequence);
      } catch {
        // Canonical state is committed; search will rebuild from the change cursor.
      }
    }
    return response;
  }
}
