/**
 * Encrypted persistence boundary for convergent page state.
 *
 * IndexedDB keeps only identities and routing fields in the clear. Checkpoint
 * bytes, causal vectors, canonical content, semantic changes, ambiguity
 * details and legacy branches are serialized into device-bound envelopes. The
 * binding includes both page and record identity where appropriate, so moving
 * a ciphertext between rows fails authentication instead of opening the wrong
 * page.
 */

import type { BlockDocumentV3, Uuid } from "@myownnotion/domain";
import {
  type CanonicalProjectionResult,
  type LegacyOfflineBranch,
  OPERATIONAL_FORMAT,
  OPERATIONAL_FORMAT_VERSION,
  type OperationalPageCheckpoint,
  operationalFrontiersEqual,
  type PageAmbiguity,
  type PageSemanticChange,
  sha256Hex,
  verifyLegacyOfflineBranch,
  versionVectorBytesEqual,
  versionVectorDominates,
} from "@myownnotion/page-state";
import { Dexie } from "dexie";
import type {
  LocalDatabase,
  LocalPageAmbiguityStatus,
  PageOperationLocalAvailability,
  PageOperationStateStatus,
  PageOperationUpdateStatus,
  SealedLegacyOfflineBranchRow,
  SealedPageAmbiguityRow,
  SealedPageOperationStateRow,
  SealedPageOperationUpdateRow,
} from "../local-store/schema.ts";
import { LOCAL_ENTITY_TYPES, type LocalCipher } from "../security/local-encryption.ts";
import { LocalRecordCodec } from "../security/local-record-codec.ts";

const PAGE_OPERATION_PAYLOAD_VERSION = 1 as const;

export interface PageOperationEncryptionContext {
  readonly installationId: string;
  readonly workspaceId: string;
}

export interface PageOperationStateRecord {
  readonly pageId: Uuid;
  readonly status: PageOperationStateStatus;
  readonly operationalVersion: number;
  readonly canonicalFormatVersion: number;
  readonly latestServerPageSequence: number;
  readonly localAvailability: PageOperationLocalAvailability;
  readonly lastAccessedAt: string;
  readonly recordVersion: number;
  readonly checkpoint: OperationalPageCheckpoint | null;
  readonly projection: CanonicalProjectionResult | null;
  readonly versionVector: Uint8Array;
  readonly frontiers: Uint8Array;
  /** Last server frontier observed; null before the first successful exchange. */
  readonly serverVersionVector: Uint8Array | null;
}

export interface PageOperationServerResult {
  readonly pageSequence: number;
  readonly resultVersionVector: Uint8Array;
  readonly consolidatedRevisionId?: Uuid;
  readonly acceptedAt?: string;
}

export interface PageOperationUpdateRecord {
  readonly updateId: Uuid;
  readonly pageId: Uuid;
  readonly status: PageOperationUpdateStatus;
  readonly enqueueOrder: number;
  readonly createdAt: string;
  readonly recordVersion: number;
  readonly operationalVersion: number;
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly resultFrontiers: Uint8Array;
  readonly updateBytes: Uint8Array;
  readonly updateDigest: string;
  readonly semanticChanges: readonly PageSemanticChange[];
  readonly serverResult?: PageOperationServerResult;
}

/**
 * Immutable proof published after one operational update is durable.
 *
 * Same-origin channels use this as a wake-up hint only. Receivers re-read the
 * encrypted IndexedDB authority and never import these bytes directly.
 */
export interface DurablePageUpdateNotice {
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly updateBytes: Uint8Array;
  readonly resultVersionVector: Uint8Array;
}

export interface PageAmbiguityRecord {
  readonly ambiguityId: Uuid;
  readonly pageId: Uuid;
  readonly kind: SealedPageAmbiguityRow["kind"];
  readonly status: LocalPageAmbiguityStatus;
  readonly openedAt: string;
  readonly recordVersion: number;
  readonly details: PageAmbiguity;
}

/** One causally consistent IndexedDB read used to (re)open an editor session. */
export interface PageOperationLocalSnapshot {
  readonly state: PageOperationStateRecord | null;
  readonly updates: PageOperationUpdateRecord[];
  readonly ambiguities: PageAmbiguityRecord[];
}

export interface LegacyOfflineBranchRecord {
  readonly pageId: Uuid;
  readonly branchId: Uuid;
  readonly status: SealedLegacyOfflineBranchRow["status"];
  readonly createdAt: string;
  readonly recordVersion: number;
  readonly branch: LegacyOfflineBranch;
  readonly requiredFileIds: readonly Uuid[];
}

interface SerializedCheckpoint {
  readonly operationalFormat: typeof OPERATIONAL_FORMAT;
  readonly operationalVersion: typeof OPERATIONAL_FORMAT_VERSION;
  readonly pageId: Uuid;
  readonly bytes: string;
  readonly digest: string;
  readonly versionVector: string;
  readonly frontiers: string;
}

interface SerializedProjection {
  readonly pageId: Uuid;
  readonly operationalFrontier: string;
  readonly operationalDigest: string;
  readonly document: BlockDocumentV3;
  readonly canonicalDigest: string;
  readonly pageLinkTargets: readonly Uuid[];
  readonly fileUsageIds: readonly Uuid[];
  readonly warnings: CanonicalProjectionResult["warnings"];
}

interface SerializedStatePayload {
  readonly payloadVersion: typeof PAGE_OPERATION_PAYLOAD_VERSION;
  readonly routing: Omit<
    PageOperationStateRecord,
    "checkpoint" | "projection" | "versionVector" | "frontiers" | "serverVersionVector"
  >;
  readonly checkpoint: SerializedCheckpoint | null;
  readonly projection: SerializedProjection | null;
  readonly versionVector: string;
  readonly frontiers: string;
  readonly serverVersionVector: string | null;
}

interface SerializedUpdatePayload {
  readonly payloadVersion: typeof PAGE_OPERATION_PAYLOAD_VERSION;
  readonly routing: Pick<
    PageOperationUpdateRecord,
    "updateId" | "pageId" | "status" | "enqueueOrder" | "createdAt" | "recordVersion"
  >;
  readonly operationalVersion: number;
  readonly baseVersionVector: string;
  readonly resultVersionVector: string;
  readonly resultFrontiers: string;
  readonly updateBytes: string;
  readonly updateDigest: string;
  readonly semanticChanges: readonly PageSemanticChange[];
  readonly serverResult?: {
    readonly pageSequence: number;
    readonly resultVersionVector: string;
    readonly consolidatedRevisionId?: Uuid;
    readonly acceptedAt?: string;
  };
}

interface SerializedAmbiguityPayload {
  readonly payloadVersion: typeof PAGE_OPERATION_PAYLOAD_VERSION;
  readonly routing: Omit<PageAmbiguityRecord, "details">;
  readonly details: PageAmbiguity;
}

interface SerializedLegacyBranchPayload {
  readonly payloadVersion: typeof PAGE_OPERATION_PAYLOAD_VERSION;
  readonly routing: Omit<LegacyOfflineBranchRecord, "branch" | "requiredFileIds">;
  readonly branch: LegacyOfflineBranch;
  readonly requiredFileIds: readonly Uuid[];
}

function cloneBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export function encodePageOperationBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodePageOperationBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new TypeError("invalid page-operation base64url");
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4,
  )}`;
  const binary = atob(padded);
  const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  if (encodePageOperationBytes(result) !== value) {
    throw new TypeError("non-canonical page-operation base64url");
  }
  return result;
}

function assertPositiveRecordVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("page-operation recordVersion must be a positive integer");
  }
}

function assertPayload(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid encrypted page-operation payload");
  }
  if ((value as { payloadVersion?: unknown }).payloadVersion !== PAGE_OPERATION_PAYLOAD_VERSION) {
    throw new TypeError("unsupported encrypted page-operation payload version");
  }
}

function serializeCheckpoint(checkpoint: OperationalPageCheckpoint): SerializedCheckpoint {
  return {
    operationalFormat: checkpoint.operationalFormat,
    operationalVersion: checkpoint.operationalVersion,
    pageId: checkpoint.pageId,
    bytes: encodePageOperationBytes(checkpoint.bytes),
    digest: checkpoint.digest,
    versionVector: encodePageOperationBytes(checkpoint.versionVector),
    frontiers: encodePageOperationBytes(checkpoint.frontiers),
  };
}

function deserializeCheckpoint(value: unknown, expectedPageId: Uuid): OperationalPageCheckpoint {
  assertPayloadObject(value, "checkpoint");
  if (
    value["operationalFormat"] !== OPERATIONAL_FORMAT ||
    value["operationalVersion"] !== OPERATIONAL_FORMAT_VERSION ||
    value["pageId"] !== expectedPageId ||
    typeof value["bytes"] !== "string" ||
    typeof value["digest"] !== "string" ||
    typeof value["versionVector"] !== "string" ||
    typeof value["frontiers"] !== "string"
  ) {
    throw new TypeError("invalid encrypted operational checkpoint");
  }
  return {
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
    pageId: expectedPageId,
    bytes: decodePageOperationBytes(value["bytes"]),
    digest: value["digest"],
    versionVector: decodePageOperationBytes(value["versionVector"]),
    frontiers: decodePageOperationBytes(value["frontiers"]),
  };
}

function serializeProjection(projection: CanonicalProjectionResult): SerializedProjection {
  return {
    ...projection,
    operationalFrontier: encodePageOperationBytes(projection.operationalFrontier),
  };
}

function deserializeProjection(value: unknown, expectedPageId: Uuid): CanonicalProjectionResult {
  assertPayloadObject(value, "projection");
  if (
    value["pageId"] !== expectedPageId ||
    typeof value["operationalFrontier"] !== "string" ||
    typeof value["operationalDigest"] !== "string" ||
    typeof value["canonicalDigest"] !== "string" ||
    value["document"] === null ||
    typeof value["document"] !== "object" ||
    !Array.isArray(value["pageLinkTargets"]) ||
    !Array.isArray(value["fileUsageIds"]) ||
    !Array.isArray(value["warnings"])
  ) {
    throw new TypeError("invalid encrypted canonical projection");
  }
  return {
    pageId: expectedPageId,
    operationalFrontier: decodePageOperationBytes(value["operationalFrontier"]),
    operationalDigest: value["operationalDigest"],
    document: value["document"] as BlockDocumentV3,
    canonicalDigest: value["canonicalDigest"],
    pageLinkTargets: value["pageLinkTargets"] as Uuid[],
    fileUsageIds: value["fileUsageIds"] as Uuid[],
    warnings: value["warnings"] as CanonicalProjectionResult["warnings"],
  };
}

function assertPayloadObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`invalid encrypted ${label}`);
  }
}

function stateBindingId(pageId: Uuid): string {
  return pageId;
}

function updateBindingId(pageId: Uuid, updateId: Uuid): string {
  return `${pageId}.${updateId}`;
}

function ambiguityBindingId(pageId: Uuid, ambiguityId: Uuid): string {
  return `${pageId}.${ambiguityId}`;
}

function branchBindingId(pageId: Uuid, branchId: Uuid): string {
  return `${pageId}.${branchId}`;
}

/** Pure row codec, usable before a Dexie transaction is opened. */
export class PageOperationRecordCodec {
  readonly #cipher: LocalCipher;
  readonly #context: PageOperationEncryptionContext;

  constructor(cipher: LocalCipher, context: PageOperationEncryptionContext) {
    this.#cipher = cipher;
    this.#context = context;
  }

  #binding(entityType: string, entityId: string, recordVersion: number) {
    assertPositiveRecordVersion(recordVersion);
    return {
      installationId: this.#context.installationId,
      workspaceId: this.#context.workspaceId,
      entityType,
      entityId,
      keyGeneration: 1,
      recordVersion,
    };
  }

  async sealState(record: PageOperationStateRecord): Promise<SealedPageOperationStateRow> {
    assertStateConsistency(record);
    const { checkpoint, projection, versionVector, frontiers, serverVersionVector, ...metadata } =
      record;
    const payload: SerializedStatePayload = {
      payloadVersion: PAGE_OPERATION_PAYLOAD_VERSION,
      routing: metadata,
      checkpoint: checkpoint === null ? null : serializeCheckpoint(checkpoint),
      projection: projection === null ? null : serializeProjection(projection),
      versionVector: encodePageOperationBytes(versionVector),
      frontiers: encodePageOperationBytes(frontiers),
      serverVersionVector:
        serverVersionVector === null ? null : encodePageOperationBytes(serverVersionVector),
    };
    return {
      ...metadata,
      sealedState: await this.#cipher.seal(
        this.#binding(
          LOCAL_ENTITY_TYPES.pageOperationState,
          stateBindingId(record.pageId),
          record.recordVersion,
        ),
        payload,
      ),
    };
  }

  async openState(row: SealedPageOperationStateRow): Promise<PageOperationStateRecord> {
    const payload = await this.#cipher.open(
      this.#binding(
        LOCAL_ENTITY_TYPES.pageOperationState,
        stateBindingId(row.pageId),
        row.recordVersion,
      ),
      row.sealedState,
    );
    assertPayload(payload);
    assertRoutingMetadata(payload["routing"], row, [
      "pageId",
      "status",
      "operationalVersion",
      "canonicalFormatVersion",
      "latestServerPageSequence",
      "localAvailability",
      "lastAccessedAt",
      "recordVersion",
    ]);
    if (
      typeof payload["versionVector"] !== "string" ||
      typeof payload["frontiers"] !== "string" ||
      (payload["serverVersionVector"] !== null &&
        typeof payload["serverVersionVector"] !== "string")
    ) {
      throw new TypeError("invalid encrypted page state vectors");
    }
    const record: PageOperationStateRecord = {
      pageId: row.pageId,
      status: row.status,
      operationalVersion: row.operationalVersion,
      canonicalFormatVersion: row.canonicalFormatVersion,
      latestServerPageSequence: row.latestServerPageSequence,
      localAvailability: row.localAvailability,
      lastAccessedAt: row.lastAccessedAt,
      recordVersion: row.recordVersion,
      checkpoint:
        payload["checkpoint"] === null
          ? null
          : deserializeCheckpoint(payload["checkpoint"], row.pageId),
      projection:
        payload["projection"] === null
          ? null
          : deserializeProjection(payload["projection"], row.pageId),
      versionVector: decodePageOperationBytes(payload["versionVector"]),
      frontiers: decodePageOperationBytes(payload["frontiers"]),
      serverVersionVector:
        payload["serverVersionVector"] === null
          ? null
          : decodePageOperationBytes(payload["serverVersionVector"]),
    };
    assertStateConsistency(record);
    return record;
  }

  async sealUpdate(record: PageOperationUpdateRecord): Promise<SealedPageOperationUpdateRow> {
    if ((await sha256Hex(record.updateBytes)) !== record.updateDigest) {
      throw new TypeError("page-operation update digest mismatch before persistence");
    }
    const {
      operationalVersion,
      baseVersionVector,
      resultVersionVector,
      resultFrontiers,
      updateBytes,
      updateDigest,
      semanticChanges,
      serverResult,
      ...metadata
    } = record;
    const payload: SerializedUpdatePayload = {
      payloadVersion: PAGE_OPERATION_PAYLOAD_VERSION,
      routing: {
        updateId: record.updateId,
        pageId: record.pageId,
        status: record.status,
        enqueueOrder: record.enqueueOrder,
        createdAt: record.createdAt,
        recordVersion: record.recordVersion,
      },
      operationalVersion,
      baseVersionVector: encodePageOperationBytes(baseVersionVector),
      resultVersionVector: encodePageOperationBytes(resultVersionVector),
      resultFrontiers: encodePageOperationBytes(resultFrontiers),
      updateBytes: encodePageOperationBytes(updateBytes),
      updateDigest,
      semanticChanges,
      ...(serverResult === undefined
        ? {}
        : {
            serverResult: {
              pageSequence: serverResult.pageSequence,
              resultVersionVector: encodePageOperationBytes(serverResult.resultVersionVector),
              ...(serverResult.consolidatedRevisionId === undefined
                ? {}
                : { consolidatedRevisionId: serverResult.consolidatedRevisionId }),
              ...(serverResult.acceptedAt === undefined
                ? {}
                : { acceptedAt: serverResult.acceptedAt }),
            },
          }),
    };
    return {
      ...metadata,
      sealedBody: await this.#cipher.seal(
        this.#binding(
          LOCAL_ENTITY_TYPES.pageOperationUpdate,
          updateBindingId(record.pageId, record.updateId),
          record.recordVersion,
        ),
        payload,
      ),
    };
  }

  async openUpdate(row: SealedPageOperationUpdateRow): Promise<PageOperationUpdateRecord> {
    const payload = await this.#cipher.open(
      this.#binding(
        LOCAL_ENTITY_TYPES.pageOperationUpdate,
        updateBindingId(row.pageId, row.updateId),
        row.recordVersion,
      ),
      row.sealedBody,
    );
    assertPayload(payload);
    assertRoutingMetadata(payload["routing"], row, [
      "updateId",
      "pageId",
      "status",
      "enqueueOrder",
      "createdAt",
      "recordVersion",
    ]);
    if (
      typeof payload["baseVersionVector"] !== "string" ||
      typeof payload["resultVersionVector"] !== "string" ||
      typeof payload["resultFrontiers"] !== "string" ||
      typeof payload["updateBytes"] !== "string" ||
      typeof payload["updateDigest"] !== "string" ||
      !Number.isInteger(payload["operationalVersion"]) ||
      !Array.isArray(payload["semanticChanges"])
    ) {
      throw new TypeError("invalid encrypted page update metadata");
    }
    const updateBytes = decodePageOperationBytes(payload["updateBytes"]);
    if ((await sha256Hex(updateBytes)) !== payload["updateDigest"]) {
      throw new TypeError("encrypted page update digest mismatch");
    }
    const serverResult = deserializeServerResult(payload["serverResult"]);
    return {
      updateId: row.updateId,
      pageId: row.pageId,
      status: row.status,
      enqueueOrder: row.enqueueOrder,
      createdAt: row.createdAt,
      recordVersion: row.recordVersion,
      operationalVersion: payload["operationalVersion"] as number,
      baseVersionVector: decodePageOperationBytes(payload["baseVersionVector"]),
      resultVersionVector: decodePageOperationBytes(payload["resultVersionVector"]),
      resultFrontiers: decodePageOperationBytes(payload["resultFrontiers"]),
      updateBytes,
      updateDigest: payload["updateDigest"],
      semanticChanges: payload["semanticChanges"] as PageSemanticChange[],
      ...(serverResult === undefined ? {} : { serverResult }),
    };
  }

  async sealAmbiguity(record: PageAmbiguityRecord): Promise<SealedPageAmbiguityRow> {
    if (record.details.kind !== record.kind) {
      throw new TypeError("page ambiguity kind does not match its routing metadata");
    }
    const { details, ...metadata } = record;
    const payload: SerializedAmbiguityPayload = {
      payloadVersion: PAGE_OPERATION_PAYLOAD_VERSION,
      routing: metadata,
      details,
    };
    return {
      ...metadata,
      sealedDetails: await this.#cipher.seal(
        this.#binding(
          LOCAL_ENTITY_TYPES.pageAmbiguityDetails,
          ambiguityBindingId(record.pageId, record.ambiguityId),
          record.recordVersion,
        ),
        payload,
      ),
    };
  }

  async openAmbiguity(row: SealedPageAmbiguityRow): Promise<PageAmbiguityRecord> {
    const payload = await this.#cipher.open(
      this.#binding(
        LOCAL_ENTITY_TYPES.pageAmbiguityDetails,
        ambiguityBindingId(row.pageId, row.ambiguityId),
        row.recordVersion,
      ),
      row.sealedDetails,
    );
    assertPayload(payload);
    assertRoutingMetadata(payload["routing"], row, [
      "ambiguityId",
      "pageId",
      "kind",
      "status",
      "openedAt",
      "recordVersion",
    ]);
    assertPayloadObject(payload["details"], "page ambiguity details");
    const details = payload["details"] as unknown as PageAmbiguity;
    if (details.kind !== row.kind) {
      throw new TypeError("encrypted page ambiguity metadata mismatch");
    }
    return {
      ambiguityId: row.ambiguityId,
      pageId: row.pageId,
      kind: row.kind,
      status: row.status,
      openedAt: row.openedAt,
      recordVersion: row.recordVersion,
      details,
    };
  }

  async sealLegacyBranch(record: LegacyOfflineBranchRecord): Promise<SealedLegacyOfflineBranchRow> {
    if (
      record.branch.pageId !== record.pageId ||
      record.branch.branchId !== record.branchId ||
      record.branch.status !== record.status ||
      record.branch.createdAt !== record.createdAt
    ) {
      throw new TypeError("legacy branch does not match its routing metadata");
    }
    await verifyLegacyOfflineBranch(record.branch);
    const { branch, requiredFileIds, ...metadata } = record;
    const payload: SerializedLegacyBranchPayload = {
      payloadVersion: PAGE_OPERATION_PAYLOAD_VERSION,
      routing: metadata,
      branch,
      requiredFileIds,
    };
    return {
      ...metadata,
      sealedBranch: await this.#cipher.seal(
        this.#binding(
          LOCAL_ENTITY_TYPES.legacyOfflineBranch,
          branchBindingId(record.pageId, record.branchId),
          record.recordVersion,
        ),
        payload,
      ),
    };
  }

  async openLegacyBranch(row: SealedLegacyOfflineBranchRow): Promise<LegacyOfflineBranchRecord> {
    const payload = await this.#cipher.open(
      this.#binding(
        LOCAL_ENTITY_TYPES.legacyOfflineBranch,
        branchBindingId(row.pageId, row.branchId),
        row.recordVersion,
      ),
      row.sealedBranch,
    );
    assertPayload(payload);
    assertRoutingMetadata(payload["routing"], row, [
      "pageId",
      "branchId",
      "status",
      "createdAt",
      "recordVersion",
    ]);
    assertPayloadObject(payload["branch"], "legacy offline branch");
    if (!Array.isArray(payload["requiredFileIds"])) {
      throw new TypeError("invalid legacy branch file requirements");
    }
    const branch = payload["branch"] as unknown as LegacyOfflineBranch;
    if (
      branch.pageId !== row.pageId ||
      branch.branchId !== row.branchId ||
      branch.status !== row.status ||
      branch.createdAt !== row.createdAt
    ) {
      throw new TypeError("encrypted legacy branch metadata mismatch");
    }
    await verifyLegacyOfflineBranch(branch);
    return {
      pageId: row.pageId,
      branchId: row.branchId,
      status: row.status,
      createdAt: row.createdAt,
      recordVersion: row.recordVersion,
      branch,
      requiredFileIds: payload["requiredFileIds"] as Uuid[],
    };
  }
}

function deserializeServerResult(value: unknown): PageOperationServerResult | undefined {
  if (value === undefined) return undefined;
  assertPayloadObject(value, "page update server result");
  if (
    !Number.isInteger(value["pageSequence"]) ||
    typeof value["resultVersionVector"] !== "string"
  ) {
    throw new TypeError("invalid encrypted page update server result");
  }
  if (
    value["consolidatedRevisionId"] !== undefined &&
    typeof value["consolidatedRevisionId"] !== "string"
  ) {
    throw new TypeError("invalid consolidated revision id");
  }
  if (value["acceptedAt"] !== undefined && typeof value["acceptedAt"] !== "string") {
    throw new TypeError("invalid accepted timestamp");
  }
  return {
    pageSequence: value["pageSequence"] as number,
    resultVersionVector: decodePageOperationBytes(value["resultVersionVector"]),
    ...(value["consolidatedRevisionId"] === undefined
      ? {}
      : { consolidatedRevisionId: value["consolidatedRevisionId"] as Uuid }),
    ...(value["acceptedAt"] === undefined ? {} : { acceptedAt: value["acceptedAt"] }),
  };
}

function assertRoutingMetadata(value: unknown, rowValue: unknown, keys: readonly string[]): void {
  assertPayloadObject(value, "page-operation routing metadata");
  assertPayloadObject(rowValue, "page-operation row metadata");
  for (const key of keys) {
    if (value[key] !== rowValue[key]) {
      throw new TypeError("encrypted page-operation routing metadata mismatch");
    }
  }
}

function assertStateConsistency(record: PageOperationStateRecord): void {
  assertPositiveRecordVersion(record.recordVersion);
  if (!Number.isInteger(record.latestServerPageSequence) || record.latestServerPageSequence < 0) {
    throw new TypeError("latest server page sequence must be a non-negative integer");
  }
  if (record.status === "active" && (record.checkpoint === null || record.projection === null)) {
    throw new TypeError("an active operational page requires checkpoint and projection");
  }
  if (record.checkpoint !== null) {
    if (record.checkpoint.pageId !== record.pageId) {
      throw new TypeError("operational checkpoint belongs to another page");
    }
    if (!versionVectorDominates(record.versionVector, record.checkpoint.versionVector)) {
      throw new TypeError("page state does not descend from its checkpoint");
    }
    if (
      versionVectorBytesEqual(record.checkpoint.versionVector, record.versionVector) &&
      !operationalFrontiersEqual(record.checkpoint.frontiers, record.frontiers)
    ) {
      throw new TypeError("page state and checkpoint frontiers differ");
    }
  }
  if (record.projection !== null) {
    if (record.projection.pageId !== record.pageId) {
      throw new TypeError("canonical projection belongs to another page");
    }
    if (!operationalFrontiersEqual(record.projection.operationalFrontier, record.frontiers)) {
      throw new TypeError("page state and canonical projection frontiers differ");
    }
  }
}

/** Database repository. All crypto completes before a transaction is opened. */
export class EncryptedPageOperationLog {
  readonly db: LocalDatabase;
  readonly codec: PageOperationRecordCodec;
  /** Shared-key codec for retained workspace recovery records. */
  readonly localCodec: LocalRecordCodec;

  constructor(db: LocalDatabase, cipher: LocalCipher, context: PageOperationEncryptionContext) {
    this.db = db;
    this.codec = new PageOperationRecordCodec(cipher, context);
    this.localCodec = new LocalRecordCodec(cipher, context);
  }

  async getState(pageId: Uuid): Promise<PageOperationStateRecord | null> {
    const row = await this.db.pageOperationStates.get(pageId);
    return row === undefined ? null : await this.codec.openState(row);
  }

  /**
   * Reads the state row, update journal and open ambiguities from one IndexedDB
   * snapshot, then decrypts them after the transaction closes.
   *
   * Reading those tables through three independent promises can observe a
   * reconciler between its atomic state advance and a later read. The pair is
   * valid before and after that commit, but the mixed view reconstructs
   * neither frontier and used to leave a returning editor stuck on “Loading”.
   */
  async readPageSnapshot(pageId: Uuid): Promise<PageOperationLocalSnapshot> {
    const [stateRow, updateRows, ambiguityRows] = await this.db.transaction(
      "r",
      [this.db.pageOperationStates, this.db.pageOperationUpdates, this.db.pageAmbiguities],
      async () =>
        await Promise.all([
          this.db.pageOperationStates.get(pageId),
          this.db.pageOperationUpdates.where("pageId").equals(pageId).sortBy("enqueueOrder"),
          this.db.pageAmbiguities.where("[pageId+status]").equals([pageId, "open"]).toArray(),
        ]),
    );
    const [state, updates, ambiguities] = await Promise.all([
      stateRow === undefined ? Promise.resolve(null) : this.codec.openState(stateRow),
      Promise.all(updateRows.map(async (row) => await this.codec.openUpdate(row))),
      Promise.all(ambiguityRows.map(async (row) => await this.codec.openAmbiguity(row))),
    ]);
    return { state, updates, ambiguities };
  }

  async getUpdate(updateId: Uuid): Promise<PageOperationUpdateRecord | null> {
    const row = await this.db.pageOperationUpdates.get(updateId);
    return row === undefined ? null : await this.codec.openUpdate(row);
  }

  /**
   * Proves a tab-channel notice against the shared encrypted authority.
   *
   * A queued row must match byte-for-byte. If server acknowledgement already
   * compacted that row away, the durable page frontier must causally dominate
   * the notice instead. The caller may then adopt the IndexedDB state; the
   * untrusted accelerator payload itself is never applied to an editor.
   */
  async assertDurableUpdate(notice: DurablePageUpdateNotice): Promise<void> {
    // Keep these reads ordered. If the first one observes that compaction has
    // removed the update, the following state read is guaranteed to observe
    // that same committed transaction (or something newer), including the
    // frontier that replaced the row. Parallel reads could straddle the
    // transaction in the opposite order and reject a valid notice briefly.
    const stored = await this.getUpdate(notice.updateId);
    if (stored !== null) {
      const matches =
        stored.pageId === notice.pageId &&
        stored.updateBytes.byteLength === notice.updateBytes.byteLength &&
        stored.updateBytes.every((byte, index) => byte === notice.updateBytes[index]) &&
        versionVectorBytesEqual(stored.resultVersionVector, notice.resultVersionVector);
      if (matches) return;
      throw new Error("the tab notice does not match the shared durable update");
    }
    const state = await this.getState(notice.pageId);
    if (state !== null && versionVectorDominates(state.versionVector, notice.resultVersionVector)) {
      return;
    }
    throw new Error("the tab notice is not present in the shared durable page");
  }

  async listUpdates(
    pageId: Uuid,
    statuses?: readonly PageOperationUpdateStatus[],
  ): Promise<PageOperationUpdateRecord[]> {
    const rows = await this.db.pageOperationUpdates
      .where("pageId")
      .equals(pageId)
      .sortBy("enqueueOrder");
    const allowed = statuses === undefined ? null : new Set(statuses);
    const opened: PageOperationUpdateRecord[] = [];
    for (const row of rows) {
      if (allowed !== null && !allowed.has(row.status)) continue;
      opened.push(await this.codec.openUpdate(row));
    }
    return opened;
  }

  /**
   * Lists only routing identities for pages that own updates in the requested
   * states. The status-first compound index is intentional: using `toArray()`
   * on the status index would load every sealed update envelope merely to learn
   * its page ID, which makes an offline backlog's encrypted bytes part of the
   * application boot path.
   */
  async listPageIdsWithUpdates(
    statuses: readonly PageOperationUpdateStatus[] = ["pending", "sending"],
  ): Promise<Uuid[]> {
    const pageIds = new Set<Uuid>();
    for (const status of new Set(statuses)) {
      const keys = await this.db.pageOperationUpdates
        .where("[status+pageId]")
        .between([status, Dexie.minKey], [status, Dexie.maxKey], true, true)
        // Do not use `uniqueKeys()` here. It opens a `nextunique` IndexedDB
        // cursor, which current WebKit rejects for this compound range with
        // `UnknownError: Unable to open cursor`. Plain key iteration is
        // portable and still reads index metadata only; the Set below removes
        // repeated page IDs without opening encrypted update envelopes.
        .keys();
      for (const key of keys) {
        const parts = key as readonly unknown[];
        if (!Array.isArray(key) || parts[0] !== status || typeof parts[1] !== "string") {
          throw new TypeError("invalid page-operation queue routing key");
        }
        pageIds.add(parts[1] as Uuid);
      }
    }
    return [...pageIds].sort();
  }

  async countUpdates(statuses: readonly PageOperationUpdateStatus[]): Promise<number> {
    const uniqueStatuses = [...new Set(statuses)];
    const counts = await Promise.all(
      uniqueStatuses.map(
        async (status) => await this.db.pageOperationUpdates.where("status").equals(status).count(),
      ),
    );
    return counts.reduce((total, count) => total + count, 0);
  }

  /**
   * Finds durable pre-activation branches without opening their ciphertext.
   *
   * A branch can outlive its editor: the owner may edit offline, navigate to
   * another page and only then reconnect. Routing by the clear status index
   * lets boot/reconnection resume that work without requiring the original
   * editor component (or its in-memory session) to still exist.
   */
  async listPageIdsWithLegacyBranches(
    statuses: readonly SealedLegacyOfflineBranchRow["status"][] = ["editing", "sending"],
  ): Promise<Uuid[]> {
    const pageIds = new Set<Uuid>();
    for (const status of new Set(statuses)) {
      const keys = await this.db.legacyOfflineBranches.where("status").equals(status).primaryKeys();
      for (const key of keys) {
        if (typeof key !== "string") {
          throw new TypeError("invalid legacy page branch routing key");
        }
        pageIds.add(key as Uuid);
      }
    }
    return [...pageIds].sort();
  }

  async putAmbiguity(record: PageAmbiguityRecord): Promise<void> {
    const sealed = await this.codec.sealAmbiguity(record);
    await this.db.pageAmbiguities.put(sealed);
  }

  async listOpenAmbiguities(pageId: Uuid): Promise<PageAmbiguityRecord[]> {
    const rows = await this.db.pageAmbiguities
      .where("[pageId+status]")
      .equals([pageId, "open"])
      .toArray();
    return await Promise.all(rows.map((row) => this.codec.openAmbiguity(row)));
  }

  async putLegacyBranch(record: LegacyOfflineBranchRecord): Promise<void> {
    const sealed = await this.codec.sealLegacyBranch(record);
    await this.db.legacyOfflineBranches.put(sealed);
  }

  async getLegacyBranch(pageId: Uuid): Promise<LegacyOfflineBranchRecord | null> {
    const row = await this.db.legacyOfflineBranches.get(pageId);
    return row === undefined ? null : await this.codec.openLegacyBranch(row);
  }

  async recoverInterruptedSending(pageId?: Uuid): Promise<number> {
    const rows =
      pageId === undefined
        ? await this.db.pageOperationUpdates.where("status").equals("sending").toArray()
        : await this.db.pageOperationUpdates
            .where("[pageId+status]")
            .equals([pageId, "sending"])
            .toArray();
    const replacements: Array<{
      readonly previous: SealedPageOperationUpdateRow;
      readonly next: SealedPageOperationUpdateRow;
    }> = [];
    for (const row of rows) {
      const opened = await this.codec.openUpdate(row);
      replacements.push({
        previous: row,
        next: await this.codec.sealUpdate({
          ...opened,
          status: "pending",
          recordVersion: opened.recordVersion + 1,
        }),
      });
    }
    if (replacements.length === 0) return 0;
    await this.db.transaction("rw", this.db.pageOperationUpdates, async () => {
      for (const { previous, next } of replacements) {
        const current = await this.db.pageOperationUpdates.get(previous.updateId);
        if (
          current?.recordVersion !== previous.recordVersion ||
          current.status !== previous.status
        ) {
          throw new Error("page update changed while recovering interrupted sends");
        }
        await this.db.pageOperationUpdates.put(next);
      }
    });
    return replacements.length;
  }

  async transitionUpdate(
    updateId: Uuid,
    status: PageOperationUpdateStatus,
    serverResult?: PageOperationServerResult,
  ): Promise<PageOperationUpdateRecord> {
    const row = await this.db.pageOperationUpdates.get(updateId);
    if (row === undefined) throw new Error(`page update not found: ${updateId}`);
    const opened = await this.codec.openUpdate(row);
    const allowed: Record<PageOperationUpdateStatus, readonly PageOperationUpdateStatus[]> = {
      pending: ["pending", "sending", "blocked"],
      sending: ["pending", "sending", "accepted", "blocked"],
      accepted: ["accepted"],
      blocked: ["pending", "blocked"],
    };
    if (!allowed[opened.status].includes(status)) {
      throw new TypeError(`page update cannot transition from ${opened.status} to ${status}`);
    }
    const nextServerResult = serverResult ?? opened.serverResult;
    if (status === "accepted" && nextServerResult === undefined) {
      throw new TypeError("an accepted page update requires its sealed server result");
    }
    if (
      nextServerResult !== undefined &&
      !versionVectorDominates(nextServerResult.resultVersionVector, opened.resultVersionVector)
    ) {
      throw new TypeError("server result does not include the accepted page update");
    }
    const next: PageOperationUpdateRecord = {
      ...opened,
      status,
      recordVersion: opened.recordVersion + 1,
      ...(nextServerResult === undefined ? {} : { serverResult: nextServerResult }),
    };
    const sealed = await this.codec.sealUpdate(next);
    await this.db.transaction("rw", this.db.pageOperationUpdates, async () => {
      const current = await this.db.pageOperationUpdates.get(updateId);
      if (current?.recordVersion !== row.recordVersion || current.status !== row.status) {
        throw new Error("page update changed during status transition");
      }
      await this.db.pageOperationUpdates.put(sealed);
    });
    return next;
  }

  async advanceServerFrontier(
    pageId: Uuid,
    serverVersionVector: Uint8Array,
    latestServerPageSequence: number,
  ): Promise<PageOperationStateRecord> {
    const current = await this.getState(pageId);
    if (current === null) throw new Error(`page operation state not found: ${pageId}`);
    if (
      current.serverVersionVector !== null &&
      !versionVectorDominates(serverVersionVector, current.serverVersionVector)
    ) {
      throw new TypeError("server page frontier cannot retreat");
    }
    if (latestServerPageSequence < current.latestServerPageSequence) {
      throw new TypeError("server page sequence cannot retreat");
    }
    const next: PageOperationStateRecord = {
      ...current,
      serverVersionVector,
      latestServerPageSequence,
      recordVersion: current.recordVersion + 1,
    };
    const sealed = await this.codec.sealState(next);
    await this.db.transaction("rw", this.db.pageOperationStates, async () => {
      const row = await this.db.pageOperationStates.get(pageId);
      if (row?.recordVersion !== current.recordVersion) {
        throw new Error("page state changed while advancing the server frontier");
      }
      await this.db.pageOperationStates.put(sealed);
    });
    return next;
  }

  /** Removes accepted bytes only when both durable local and confirmed server state include them. */
  async pruneAcceptedIncluded(pageId: Uuid): Promise<Uuid[]> {
    const state = await this.getState(pageId);
    if (state?.checkpoint == null || state.serverVersionVector === null) return [];
    const checkpointVersionVector = state.checkpoint.versionVector;
    const serverVersionVector = state.serverVersionVector;
    const accepted = await this.listUpdates(pageId, ["accepted"]);
    const included = accepted.filter(
      (update) =>
        versionVectorDominates(checkpointVersionVector, update.resultVersionVector) &&
        versionVectorDominates(serverVersionVector, update.resultVersionVector),
    );
    if (included.length > 0) {
      await this.db.transaction(
        "rw",
        [this.db.pageOperationStates, this.db.pageOperationUpdates],
        async () => {
          const currentState = await this.db.pageOperationStates.get(pageId);
          if (currentState?.recordVersion !== state.recordVersion) {
            throw new Error("page state changed while pruning accepted updates");
          }
          for (const update of included) {
            const current = await this.db.pageOperationUpdates.get(update.updateId);
            if (current?.recordVersion !== update.recordVersion || current.status !== "accepted") {
              throw new Error("page update changed while pruning accepted updates");
            }
          }
          await this.db.pageOperationUpdates.bulkDelete(included.map(({ updateId }) => updateId));
        },
      );
    }
    return included.map(({ updateId }) => updateId);
  }
}

export function copyPageOperationBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return cloneBytes(bytes);
}
