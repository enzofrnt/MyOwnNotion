/**
 * Runtime contracts for protocol-v3 operational page synchronization.
 *
 * These schemas are deliberately transport-only. The operational engine
 * validates Loro bytes and canonical projection semantics after authentication;
 * this boundary rejects malformed, oversized or ambiguous JSON before any of
 * those bytes reach the engine.
 */

import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const PAGE_OPERATION_PROTOCOL_VERSION = 3 as const;
export const PAGE_OPERATIONAL_VERSION = 1 as const;
export const MAX_PAGE_UPDATES_PER_SYNC = 64;
export const MAX_PAGE_UPDATE_BATCH_BYTES = 1024 * 1024;
export const MAX_PAGE_VERSION_VECTOR_BYTES = 256 * 1024;
export const MAX_PAGE_CHECKPOINT_BYTES = 16 * 1024 * 1024;
export const MAX_LEGACY_BRANCH_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_LEGACY_SEMANTIC_TRANSACTIONS = 10_000;
export const MAX_LEGACY_COMMANDS_PER_TRANSACTION = 1024;

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const BASE64URL_PATTERN = "^[A-Za-z0-9_-]*$";
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
const RFC3339_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$";

export const PageOperationUuidSchema = Type.String({ pattern: UUID_PATTERN });
export const PageOperationBase64UrlSchema = Type.String({
  pattern: BASE64URL_PATTERN,
  maxLength: Math.ceil((MAX_PAGE_CHECKPOINT_BYTES * 4) / 3),
});
export const PageOperationSha256HexSchema = Type.String({
  pattern: SHA256_HEX_PATTERN,
});
export const PageOperationInstantSchema = Type.String({ pattern: RFC3339_PATTERN });

const UpdateBytesSchema = Type.String({
  pattern: BASE64URL_PATTERN,
  minLength: 2,
  maxLength: Math.ceil((MAX_PAGE_UPDATE_BATCH_BYTES * 4) / 3),
});
const VersionVectorSchema = Type.String({
  pattern: BASE64URL_PATTERN,
  maxLength: Math.ceil((MAX_PAGE_VERSION_VECTOR_BYTES * 4) / 3),
});
const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const PageOperationUpdateSchema = Type.Object(
  {
    updateId: PageOperationUuidSchema,
    baseVersionVector: VersionVectorSchema,
    updateBytes: UpdateBytesSchema,
    updateDigest: PageOperationSha256HexSchema,
    createdAt: PageOperationInstantSchema,
  },
  { additionalProperties: false },
);
export type PageOperationUpdateDto = Static<typeof PageOperationUpdateSchema>;

export const ActivePageSyncRequestSchema = Type.Object(
  {
    mode: Type.Literal("active"),
    requestId: PageOperationUuidSchema,
    operationalVersion: Type.Literal(PAGE_OPERATIONAL_VERSION),
    persistedVersionVector: VersionVectorSchema,
    knownServerPageSequence: SequenceSchema,
    updates: Type.Array(PageOperationUpdateSchema, { maxItems: MAX_PAGE_UPDATES_PER_SYNC }),
    maxRemoteBytes: Type.Integer({ minimum: 1, maximum: MAX_PAGE_UPDATE_BATCH_BYTES }),
    revisionBoundary: Type.Optional(Type.Literal("editor-closed")),
  },
  { additionalProperties: false },
);
export type ActivePageSyncRequestDto = Static<typeof ActivePageSyncRequestSchema>;

export const EmptyPageSyncRequestSchema = Type.Object(
  {
    mode: Type.Literal("empty"),
    requestId: PageOperationUuidSchema,
    knownServerPageSequence: Type.Literal(0),
    maxRemoteBytes: Type.Integer({ minimum: 1, maximum: MAX_PAGE_UPDATE_BATCH_BYTES }),
  },
  { additionalProperties: false },
);
export type EmptyPageSyncRequestDto = Static<typeof EmptyPageSyncRequestSchema>;

const PageDocumentV2Schema = Type.Object(
  {
    format: Type.Literal("myownnotion.document+json"),
    formatVersion: Type.Literal(2),
    body: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);

const PageDocumentV3Schema = Type.Object(
  {
    format: Type.Literal("myownnotion.document+json"),
    formatVersion: Type.Literal(3),
    body: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);

const CanonicalBlockSubtreeV3Schema = Type.Object(
  {
    type: Type.String({ minLength: 1, maxLength: 128 }),
    id: PageOperationUuidSchema,
  },
  { additionalProperties: true },
);

const CanonicalMarkV3Schema = Type.Object(
  { type: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: true },
);

export const LegacySemanticCommandSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("insert-block"),
      block: CanonicalBlockSubtreeV3Schema,
      parentBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
      beforeBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("move-block"),
      blockId: PageOperationUuidSchema,
      parentBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
      beforeBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("delete-block"), blockId: PageOperationUuidSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("replace-text"),
      blockId: PageOperationUuidSchema,
      baseFrom: Type.Integer({ minimum: 0 }),
      baseTo: Type.Integer({ minimum: 0 }),
      beforeContext: Type.String({ maxLength: 64 }),
      afterContext: Type.String({ maxLength: 64 }),
      text: Type.String({ maxLength: 1024 * 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("set-mark"),
      blockId: PageOperationUuidSchema,
      baseFrom: Type.Integer({ minimum: 0 }),
      baseTo: Type.Integer({ minimum: 0 }),
      mark: CanonicalMarkV3Schema,
      enabled: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("set-type-or-property"),
      blockId: PageOperationUuidSchema,
      key: Type.String({ minLength: 1, maxLength: 128 }),
      before: Type.Unknown(),
      after: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
]);
export type LegacySemanticCommandDto = Static<typeof LegacySemanticCommandSchema>;

export const LegacySemanticTransactionSchema = Type.Object(
  {
    transactionId: PageOperationUuidSchema,
    sequence: Type.Integer({ minimum: 1, maximum: MAX_LEGACY_SEMANTIC_TRANSACTIONS }),
    commands: Type.Array(LegacySemanticCommandSchema, {
      maxItems: MAX_LEGACY_COMMANDS_PER_TRANSACTION,
    }),
  },
  { additionalProperties: false },
);
export type LegacySemanticTransactionDto = Static<typeof LegacySemanticTransactionSchema>;

export const LegacyOfflineBranchSyncRequestSchema = Type.Object(
  {
    mode: Type.Literal("legacy-branch"),
    requestId: PageOperationUuidSchema,
    branchId: PageOperationUuidSchema,
    baseRevisionId: PageOperationUuidSchema,
    baseCanonicalDigest: PageOperationSha256HexSchema,
    baseDocument: Type.Optional(PageDocumentV2Schema),
    localDocument: PageDocumentV3Schema,
    localDocumentDigest: PageOperationSha256HexSchema,
    semanticTransactions: Type.Array(LegacySemanticTransactionSchema, {
      maxItems: MAX_LEGACY_SEMANTIC_TRANSACTIONS,
    }),
    createdAt: PageOperationInstantSchema,
  },
  { additionalProperties: false },
);
export type LegacyOfflineBranchSyncRequestDto = Static<typeof LegacyOfflineBranchSyncRequestSchema>;

export const PageSyncRequestSchema = Type.Union([
  ActivePageSyncRequestSchema,
  EmptyPageSyncRequestSchema,
  LegacyOfflineBranchSyncRequestSchema,
]);
export type PageSyncRequestDto = Static<typeof PageSyncRequestSchema>;

export const PageAmbiguitySummarySchema = Type.Object(
  {
    ambiguityId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    kind: Type.Union([
      Type.Literal("delete-edit"),
      Type.Literal("delete-move"),
      Type.Literal("type-transform"),
      Type.Literal("property-transform"),
      Type.Literal("schema"),
    ]),
    blockIds: Type.Array(PageOperationUuidSchema, { maxItems: 10_000 }),
    openedAt: PageOperationInstantSchema,
    status: Type.Literal("open"),
  },
  { additionalProperties: false },
);
export type PageAmbiguitySummaryDto = Static<typeof PageAmbiguitySummarySchema>;

export const RemotePageUpdateSchema = Type.Object(
  {
    updateId: PageOperationUuidSchema,
    pageSequence: SequenceSchema,
    authoredByDeviceId: PageOperationUuidSchema,
    updateBytes: UpdateBytesSchema,
    updateDigest: PageOperationSha256HexSchema,
    acceptedAt: PageOperationInstantSchema,
  },
  { additionalProperties: false },
);
export type RemotePageUpdateDto = Static<typeof RemotePageUpdateSchema>;

const AcceptedPageUpdateSchema = Type.Object(
  {
    updateId: PageOperationUuidSchema,
    pageSequence: SequenceSchema,
    resultVersionVector: VersionVectorSchema,
    consolidatedRevisionId: Type.Optional(PageOperationUuidSchema),
  },
  { additionalProperties: false },
);

const RepeatedPageUpdateSchema = Type.Object(
  {
    updateId: PageOperationUuidSchema,
    pageSequence: SequenceSchema,
    resultVersionVector: VersionVectorSchema,
  },
  { additionalProperties: false },
);

const CanonicalPageSummarySchema = Type.Object(
  {
    format: Type.Literal("myownnotion.document+json"),
    formatVersion: Type.Literal(3),
    digest: PageOperationSha256HexSchema,
    lastConsolidatedRevisionId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    hasUnconsolidatedChanges: Type.Boolean(),
  },
  { additionalProperties: false },
);

const FileRequirementSchema = Type.Object(
  {
    fileId: PageOperationUuidSchema,
    state: Type.Union([
      Type.Literal("present"),
      Type.Literal("upload-required"),
      Type.Literal("verifying"),
      Type.Literal("rejected"),
    ]),
  },
  { additionalProperties: false },
);

export const ActivePageSyncResponseSchema = Type.Object(
  {
    mode: Type.Literal("active"),
    requestId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    accepted: Type.Array(AcceptedPageUpdateSchema, { maxItems: MAX_PAGE_UPDATES_PER_SYNC }),
    repeated: Type.Array(RepeatedPageUpdateSchema, { maxItems: MAX_PAGE_UPDATES_PER_SYNC }),
    remoteUpdates: Type.Array(RemotePageUpdateSchema, { maxItems: MAX_PAGE_UPDATES_PER_SYNC }),
    serverVersionVector: VersionVectorSchema,
    latestPageSequence: SequenceSchema,
    hasMore: Type.Boolean(),
    canonical: CanonicalPageSummarySchema,
    ambiguities: Type.Array(PageAmbiguitySummarySchema, { maxItems: 10_000 }),
    fileRequirements: Type.Array(FileRequirementSchema, { maxItems: 10_000 }),
  },
  { additionalProperties: false },
);
export type ActivePageSyncResponseDto = Static<typeof ActivePageSyncResponseSchema>;

export const PageCheckpointResponseSchema = Type.Object(
  {
    mode: Type.Literal("checkpoint"),
    requestId: PageOperationUuidSchema,
    pageId: PageOperationUuidSchema,
    operationalVersion: Type.Literal(PAGE_OPERATIONAL_VERSION),
    checkpointId: PageOperationUuidSchema,
    checkpointBytes: PageOperationBase64UrlSchema,
    checkpointDigest: PageOperationSha256HexSchema,
    versionVector: VersionVectorSchema,
    throughPageSequence: SequenceSchema,
    canonicalDigest: PageOperationSha256HexSchema,
    lastConsolidatedRevisionId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    hasUnconsolidatedChanges: Type.Boolean(),
    followingUpdates: Type.Array(RemotePageUpdateSchema, { maxItems: MAX_PAGE_UPDATES_PER_SYNC }),
    latestPageSequence: SequenceSchema,
    hasMore: Type.Boolean(),
    ambiguities: Type.Array(PageAmbiguitySummarySchema, { maxItems: 10_000 }),
  },
  { additionalProperties: false },
);
export type PageCheckpointResponseDto = Static<typeof PageCheckpointResponseSchema>;

export const LegacyBranchConvertedResponseSchema = Type.Object(
  {
    ...PageCheckpointResponseSchema.properties,
    convertedBranchId: PageOperationUuidSchema,
    conversionUpdateIds: Type.Array(PageOperationUuidSchema, { maxItems: 10_000 }),
    localDocumentDigest: PageOperationSha256HexSchema,
  },
  { additionalProperties: false },
);
export type LegacyBranchConvertedResponseDto = Static<typeof LegacyBranchConvertedResponseSchema>;

export const PageSyncResponseSchema = Type.Union([
  ActivePageSyncResponseSchema,
  PageCheckpointResponseSchema,
  LegacyBranchConvertedResponseSchema,
]);
export type PageSyncResponseDto = Static<typeof PageSyncResponseSchema>;

export const ActivatePageRequestSchema = Type.Object(
  {
    requestId: PageOperationUuidSchema,
    expectedRevisionId: PageOperationUuidSchema,
    expectedCanonicalDigest: PageOperationSha256HexSchema,
  },
  { additionalProperties: false },
);
export type ActivatePageRequestDto = Static<typeof ActivatePageRequestSchema>;

export const ResolvePageAmbiguityRequestSchema = Type.Union([
  Type.Object(
    { requestId: PageOperationUuidSchema, decision: Type.Literal("confirm-delete") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      requestId: PageOperationUuidSchema,
      decision: Type.Literal("restore-change"),
      parentBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
      beforeBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      requestId: PageOperationUuidSchema,
      decision: Type.Literal("custom"),
      result: CanonicalBlockSubtreeV3Schema,
      parentBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
      beforeBlockId: Type.Union([PageOperationUuidSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);
export type ResolvePageAmbiguityRequestDto = Static<typeof ResolvePageAmbiguityRequestSchema>;

export const PAGE_OPERATION_PROBLEM_CODES = [
  "page-operations.protocol-read-only",
  "page-operations.activation-stale",
  "page-operations.update-id-reused",
  "page-operations.digest-mismatch",
  "page-operations.dependencies-missing",
  "page-operations.projection-invalid",
  "page-operations.device-revoked",
  "page-operations.rotation-blocked",
  "page-operations.quota",
  "page-operations.schema-unsupported",
] as const;

export const PageOperationProblemCodeSchema = Type.Union(
  PAGE_OPERATION_PROBLEM_CODES.map((code) => Type.Literal(code)),
);

export const PageOperationProblemSchema = Type.Object(
  {
    code: PageOperationProblemCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 1000 }),
    requiredProtocol: Type.Optional(Type.Literal(PAGE_OPERATION_PROTOCOL_VERSION)),
    readAllowed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type PageOperationProblemDto = Static<typeof PageOperationProblemSchema>;

export class PageOperationContractError extends TypeError {
  readonly code = "page-operations.invalid-contract" as const;
  readonly path: string;

  constructor(label: string, path = "/") {
    super(`${label} is invalid at ${path}`);
    this.name = "PageOperationContractError";
    this.path = path;
  }
}

function parseSchema<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const first = Value.Errors(schema, value).First();
    throw new PageOperationContractError(label, first?.path || "/");
  }
  return value as Static<T>;
}

function decodedBase64UrlLength(value: string, label: string): number {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new PageOperationContractError(label);
  }
  const remainder = value.length % 4;
  const last = value.at(-1);
  if (last !== undefined) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const index = alphabet.indexOf(last);
    if ((remainder === 2 && index % 16 !== 0) || (remainder === 3 && index % 4 !== 0)) {
      throw new PageOperationContractError(label);
    }
  }
  return Math.floor((value.length * 3) / 4);
}

function assertEncodedBytes(value: string, maximum: number, label: string): void {
  if (decodedBase64UrlLength(value, label) > maximum) {
    throw new PageOperationContractError(label);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new PageOperationContractError(label);
  }
}

function assertInstant(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new PageOperationContractError(label);
}

function assertOrderedPageSequences(
  updates: readonly { readonly pageSequence: number }[],
  minimumExclusive: number,
  maximumInclusive: number,
  label: string,
): void {
  let previous = minimumExclusive;
  for (const update of updates) {
    if (update.pageSequence <= previous || update.pageSequence > maximumInclusive) {
      throw new PageOperationContractError(label);
    }
    previous = update.pageSequence;
  }
}

export function parsePageSyncRequest(value: unknown): PageSyncRequestDto {
  const parsed = parseSchema(PageSyncRequestSchema, value, "page sync request");
  if (parsed.mode === "active") {
    assertEncodedBytes(
      parsed.persistedVersionVector,
      MAX_PAGE_VERSION_VECTOR_BYTES,
      "persisted version vector",
    );
    assertUnique(
      parsed.updates.map(({ updateId }) => updateId),
      "page update ids",
    );
    let total = 0;
    for (const update of parsed.updates) {
      assertEncodedBytes(
        update.baseVersionVector,
        MAX_PAGE_VERSION_VECTOR_BYTES,
        "update base version vector",
      );
      total += decodedBase64UrlLength(update.updateBytes, "page update bytes");
      assertInstant(update.createdAt, "page update timestamp");
    }
    if (total > MAX_PAGE_UPDATE_BATCH_BYTES) {
      throw new PageOperationContractError("page update batch bytes");
    }
  } else if (parsed.mode === "legacy-branch") {
    assertInstant(parsed.createdAt, "legacy branch timestamp");
    assertUnique(
      parsed.semanticTransactions.map(({ transactionId }) => transactionId),
      "legacy transaction ids",
    );
    for (const [index, transaction] of parsed.semanticTransactions.entries()) {
      if (transaction.sequence !== index + 1) {
        throw new PageOperationContractError("legacy transaction sequence");
      }
      for (const command of transaction.commands) {
        if (
          (command.type === "replace-text" || command.type === "set-mark") &&
          command.baseTo < command.baseFrom
        ) {
          throw new PageOperationContractError("legacy text range");
        }
      }
    }
    if (
      new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_LEGACY_BRANCH_JSON_BYTES
    ) {
      throw new PageOperationContractError("legacy branch body");
    }
  }
  return parsed;
}

export function parsePageSyncResponse(value: unknown): PageSyncResponseDto {
  const parsed = parseSchema(PageSyncResponseSchema, value, "page sync response");
  if (parsed.mode === "active") {
    assertEncodedBytes(
      parsed.serverVersionVector,
      MAX_PAGE_VERSION_VECTOR_BYTES,
      "server version vector",
    );
    if (parsed.accepted.length + parsed.repeated.length > MAX_PAGE_UPDATES_PER_SYNC) {
      throw new PageOperationContractError("accepted page update count");
    }
    assertUnique(
      [...parsed.accepted, ...parsed.repeated, ...parsed.remoteUpdates].map(
        ({ updateId }) => updateId,
      ),
      "page response update ids",
    );
    for (const result of [...parsed.accepted, ...parsed.repeated]) {
      if (result.pageSequence > parsed.latestPageSequence) {
        throw new PageOperationContractError("accepted page update sequence");
      }
    }
    assertOrderedPageSequences(
      parsed.remoteUpdates,
      0,
      parsed.latestPageSequence,
      "remote page update sequence",
    );
    let total = 0;
    for (const result of [...parsed.accepted, ...parsed.repeated]) {
      assertEncodedBytes(
        result.resultVersionVector,
        MAX_PAGE_VERSION_VECTOR_BYTES,
        "accepted update version vector",
      );
    }
    for (const update of parsed.remoteUpdates) {
      total += decodedBase64UrlLength(update.updateBytes, "remote update bytes");
      assertInstant(update.acceptedAt, "remote update timestamp");
    }
    if (total > MAX_PAGE_UPDATE_BATCH_BYTES) {
      throw new PageOperationContractError("remote page update batch bytes");
    }
  } else {
    assertEncodedBytes(parsed.checkpointBytes, MAX_PAGE_CHECKPOINT_BYTES, "checkpoint bytes");
    assertEncodedBytes(parsed.versionVector, MAX_PAGE_VERSION_VECTOR_BYTES, "version vector");
    if (parsed.throughPageSequence > parsed.latestPageSequence) {
      throw new PageOperationContractError("checkpoint page sequence");
    }
    assertUnique(
      parsed.followingUpdates.map(({ updateId }) => updateId),
      "following page update ids",
    );
    assertOrderedPageSequences(
      parsed.followingUpdates,
      parsed.throughPageSequence,
      parsed.latestPageSequence,
      "following page update sequence",
    );
    if (
      "conversionUpdateIds" in parsed &&
      new Set(parsed.conversionUpdateIds).size !== parsed.conversionUpdateIds.length
    ) {
      throw new PageOperationContractError("legacy conversion update ids");
    }
    let total = 0;
    for (const update of parsed.followingUpdates) {
      total += decodedBase64UrlLength(update.updateBytes, "following update bytes");
      assertInstant(update.acceptedAt, "following update timestamp");
    }
    if (total > MAX_PAGE_UPDATE_BATCH_BYTES) {
      throw new PageOperationContractError("following page update batch bytes");
    }
  }
  return parsed;
}

export function parseActivatePageRequest(value: unknown): ActivatePageRequestDto {
  return parseSchema(ActivatePageRequestSchema, value, "activate page request");
}

export function parseResolvePageAmbiguityRequest(value: unknown): ResolvePageAmbiguityRequestDto {
  return parseSchema(ResolvePageAmbiguityRequestSchema, value, "resolve page ambiguity request");
}

export function parsePageOperationProblem(value: unknown): PageOperationProblemDto {
  return parseSchema(PageOperationProblemSchema, value, "page operation problem");
}
