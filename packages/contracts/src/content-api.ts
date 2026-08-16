/**
 * Runtime request/response schemas for the canonical content API (T012).
 *
 * These TypeBox schemas are the executable mirror of
 * `specs/001-content-foundations/contracts/content-api.openapi.yaml`.
 * Fastify validates every request and serializes every response against
 * them; `tests/openapi.spec.ts` keeps them aligned with the OpenAPI source.
 */
import { type Static, Type } from "@sinclair/typebox";

export const UuidSchema = Type.String({ format: "uuid" });
export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: 512 });
export const ItemKindSchema = Type.Union([
  Type.Literal("page"),
  Type.Literal("folder"),
  Type.Literal("file"),
]);
export const LifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("trashed"),
  Type.Literal("purged"),
]);
export const PlacementKindSchema = Type.Union([
  Type.Literal("hierarchy"),
  Type.Literal("attachment"),
]);

const NullableUuid = Type.Union([UuidSchema, Type.Null()]);
const NullableDateTime = Type.Union([Type.String({ format: "date-time" }), Type.Null()]);

/**
 * The page document envelope.
 *
 * `formatVersion: 2` introduced the block content model (feature 003), whose
 * body is `{ blocks: Block[] }` as defined in `@myownnotion/domain` and
 * specified in `specs/003-core-workspace-experience/contracts/document-format.md`.
 * Version 1 bodies are free-form objects written before that model existed;
 * they are still read, and are upgraded by the client on the owner's first
 * edit — never by the server, which since feature 002 cannot read a stored
 * body at all.
 *
 * **`body` stays open on purpose, and it must not be tightened here.** The
 * server validating the block model would mean a client adding a block type
 * could not save until the server was upgraded to know about it — which is
 * precisely the forward compatibility FR-006 requires, broken at the API. The
 * server carries the body; the client owns its shape.
 */
export const PageDocumentSchema = Type.Object(
  {
    format: Type.Literal("myownnotion.document+json"),
    formatVersion: Type.Integer({ minimum: 1 }),
    body: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);

export const PlacementSchema = Type.Object({
  id: UuidSchema,
  itemId: UuidSchema,
  kind: PlacementKindSchema,
  parentItemId: NullableUuid,
  positionKey: Type.String(),
});

export const ItemSchema = Type.Object({
  id: UuidSchema,
  kind: ItemKindSchema,
  name: DisplayNameSchema,
  lifecycle: LifecycleSchema,
  currentRevisionId: UuidSchema,
  trashedAt: Type.Optional(NullableDateTime),
  purgeAfter: Type.Optional(NullableDateTime),
  // Optional so a client reading an older response, or a snapshot written
  // before favourites existed, is not rejected by its own contract.
  favourite: Type.Optional(Type.Boolean()),
  /** The owner asked for this to be kept on their devices (feature 005). */
  offlineIntent: Type.Optional(Type.Boolean()),
  pageDocument: Type.Optional(Type.Union([PageDocumentSchema, Type.Null()])),
  /**
   * Present for a file item (feature 005, FR-002).
   *
   * The read model has carried this since feature 001; it simply never reached
   * the client, so an attachment list could show a name and a size it had
   * inferred but not the type the server actually stored.
   */
  file: Type.Optional(
    Type.Union([
      Type.Object({
        mediaType: Type.String(),
        originalName: Type.String(),
        byteLength: Type.Number(),
      }),
      Type.Null(),
    ]),
  ),
  placements: Type.Array(PlacementSchema),
});
export type ItemDto = Static<typeof ItemSchema>;

/**
 * One place a file is referenced from (feature 005, FR-005).
 *
 * `usedByName` travels with the id because this list is read at the moment a
 * deletion is being confirmed: a list of identifiers tells an owner nothing
 * about what they are about to break.
 */
export const FileUsageSchema = Type.Object({
  usedByItemId: UuidSchema,
  usedByName: Type.String(),
  usageKind: Type.Union([
    Type.Literal("attachment"),
    Type.Literal("embed"),
    Type.Literal("hierarchy"),
  ]),
  blockId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
});
export type FileUsageDto = Static<typeof FileUsageSchema>;

export const FileUsagesResponseSchema = Type.Object({ usages: Type.Array(FileUsageSchema) });

export const CreatePlacementSchema = Type.Object(
  {
    id: Type.Optional(UuidSchema),
    kind: PlacementKindSchema,
    parentItemId: NullableUuid,
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type CreatePlacementDto = Static<typeof CreatePlacementSchema>;

export const CreateItemSchema = Type.Object(
  {
    id: UuidSchema,
    kind: Type.Union([Type.Literal("page"), Type.Literal("folder")]),
    name: DisplayNameSchema,
    placement: CreatePlacementSchema,
    pageDocument: Type.Optional(PageDocumentSchema),
  },
  { additionalProperties: false },
);
export type CreateItemDto = Static<typeof CreateItemSchema>;

export const UpdateItemSchema = Type.Object(
  {
    baseRevisionId: UuidSchema,
    name: Type.Optional(DisplayNameSchema),
  },
  { additionalProperties: false },
);
export type UpdateItemDto = Static<typeof UpdateItemSchema>;

/**
 * Converting a page to a folder, or the reverse (feature 004).
 *
 * A route of its own rather than a field on the generic update, because it is
 * an operation with its own guarantees rather than a field that happens to
 * change: it may destroy content, and it refuses to until the owner has said
 * so. `confirmedDestruction` defaults to false when absent — the other way
 * round would let a caller destroy a page's content by omitting a field.
 */
export const ConvertItemSchema = Type.Object(
  {
    targetKind: Type.Union([Type.Literal("page"), Type.Literal("folder")]),
    confirmedDestruction: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ConvertItemDto = Static<typeof ConvertItemSchema>;

/**
 * Marking an item as a favourite, or removing the mark (feature 003, FR-012).
 *
 * The desired state is carried explicitly rather than toggled. The offline
 * outbox replays commands, and a toggle replayed an even number of times lands
 * on the answer the owner did not give.
 */
export const FavouriteItemSchema = Type.Object(
  { favourite: Type.Boolean() },
  { additionalProperties: false },
);
export type FavouriteItemDto = Static<typeof FavouriteItemSchema>;

export const ReplacePageDocumentSchema = Type.Object(
  {
    baseRevisionId: UuidSchema,
    document: PageDocumentSchema,
    /** Stable targets extracted from pageLink marks for relation indexing. */
    pageLinkTargetIds: Type.Optional(Type.Array(UuidSchema, { maxItems: 1000 })),
  },
  { additionalProperties: false },
);
export type ReplacePageDocumentDto = Static<typeof ReplacePageDocumentSchema>;

export const RestoreItemSchema = Type.Object(
  {
    fallbackParentItemId: Type.Optional(NullableUuid),
  },
  { additionalProperties: false },
);
export type RestoreItemDto = Static<typeof RestoreItemSchema>;

export const MovePlacementSchema = Type.Object(
  {
    parentItemId: NullableUuid,
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type MovePlacementDto = Static<typeof MovePlacementSchema>;

export const CreateRelationshipSchema = Type.Object(
  {
    id: UuidSchema,
    sourceItemId: UuidSchema,
    targetItemId: UuidSchema,
    relationType: Type.String({ pattern: "^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$" }),
    metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
  },
  { additionalProperties: false },
);
export type CreateRelationshipDto = Static<typeof CreateRelationshipSchema>;

export const RelationshipSchema = Type.Object({
  id: UuidSchema,
  sourceItemId: UuidSchema,
  targetItemId: UuidSchema,
  relationType: Type.String(),
  metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
  createdRevisionId: UuidSchema,
  removedRevisionId: Type.Optional(NullableUuid),
  sourceAvailability: Type.Optional(Type.String()),
  targetAvailability: Type.Optional(Type.String()),
});
export type RelationshipDto = Static<typeof RelationshipSchema>;

export const RevisionSchema = Type.Object({
  id: UuidSchema,
  itemId: UuidSchema,
  mutationId: UuidSchema,
  parentRevisionIds: Type.Array(UuidSchema),
  acceptedAt: Type.String({ format: "date-time" }),
  snapshotRetained: Type.Boolean(),
  snapshot: Type.Optional(
    Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  ),
  snapshotExpiresAt: Type.Optional(NullableDateTime),
});
export type RevisionDto = Static<typeof RevisionSchema>;

export const CompareRevisionsSchema = Type.Object(
  {
    leftRevisionId: UuidSchema,
    rightRevisionId: UuidSchema,
  },
  { additionalProperties: false },
);

export const LineageClassificationSchema = Type.Union([
  Type.Literal("identical"),
  Type.Literal("left-ancestor"),
  Type.Literal("right-ancestor"),
  Type.Literal("concurrent"),
]);

export const RestoreRevisionSchema = Type.Object(
  {
    currentRevisionId: UuidSchema,
  },
  { additionalProperties: false },
);

export const MutationResultSchema = Type.Object({
  mutationId: UuidSchema,
  revisionIds: Type.Array(UuidSchema, { minItems: 1 }),
  item: Type.Optional(ItemSchema),
});
export type MutationResultDto = Static<typeof MutationResultSchema>;

export const ChangeEnvelopeSchema = Type.Object({
  sequence: Type.Integer({ minimum: 1 }),
  mutationId: UuidSchema,
  revisionIds: Type.Array(UuidSchema),
  changedItems: Type.Optional(Type.Array(ItemSchema)),
});
export type ChangeEnvelopeDto = Static<typeof ChangeEnvelopeSchema>;

export const ChangesResponseSchema = Type.Object({
  changes: Type.Array(ChangeEnvelopeSchema),
  nextCursor: Type.String(),
  hasMore: Type.Boolean(),
});
export type ChangesResponseDto = Static<typeof ChangesResponseSchema>;

export const QueuedMutationSchema = Type.Object(
  {
    mutationId: UuidSchema,
    commandType: Type.String({ minLength: 1 }),
    baseRevisionIds: Type.Array(UuidSchema),
    payload: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);
export type QueuedMutationDto = Static<typeof QueuedMutationSchema>;

export const MutationBatchSchema = Type.Object(
  {
    mutations: Type.Array(QueuedMutationSchema, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type MutationBatchDto = Static<typeof MutationBatchSchema>;

export const ProblemSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer({ minimum: 400, maximum: 599 }),
  code: Type.String(),
  detail: Type.Optional(Type.String()),
  invalidFields: Type.Optional(
    Type.Array(
      Type.Object({
        field: Type.String(),
        code: Type.String(),
      }),
    ),
  ),
  competingRevisionIds: Type.Optional(Type.Array(UuidSchema)),
});
export type ProblemDto = Static<typeof ProblemSchema>;

export const QueuedMutationResultSchema = Type.Object({
  mutationId: UuidSchema,
  status: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("already-accepted"),
    Type.Literal("rejected"),
    Type.Literal("conflict"),
  ]),
  revisionIds: Type.Optional(Type.Array(UuidSchema)),
  competingRevisionIds: Type.Optional(Type.Array(UuidSchema)),
  problem: Type.Optional(ProblemSchema),
});
export type QueuedMutationResultDto = Static<typeof QueuedMutationResultSchema>;

export const MutationBatchResponseSchema = Type.Object({
  results: Type.Array(QueuedMutationResultSchema),
});

export const CanonicalSnapshotSchema = Type.Object({
  workspaceId: UuidSchema,
  schemaVersion: Type.Integer({ minimum: 1 }),
  cursor: Type.String(),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  items: Type.Array(ItemSchema),
  relationships: Type.Array(RelationshipSchema),
});
export type CanonicalSnapshotDto = Static<typeof CanonicalSnapshotSchema>;

export const HealthResponseSchema = Type.Object({
  status: Type.Literal("ready"),
  schemaVersion: Type.Integer({ minimum: 1 }),
});

export const ExportStatusSchema = Type.Object({
  exportId: UuidSchema,
  status: Type.Union([Type.Literal("pending"), Type.Literal("ready"), Type.Literal("failed")]),
  digest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  downloadPath: Type.Optional(Type.String()),
  problem: Type.Optional(ProblemSchema),
});
export type ExportStatusDto = Static<typeof ExportStatusSchema>;

export const CreateExportResponseSchema = Type.Object({
  exportId: UuidSchema,
  status: Type.Literal("pending"),
});

export const ItemsListResponseSchema = Type.Object({
  items: Type.Array(ItemSchema),
});

export const RelationshipsListResponseSchema = Type.Object({
  relationships: Type.Array(RelationshipSchema),
});

/** Idempotency header carried by every mutating endpoint. */
export const IDEMPOTENCY_HEADER = "idempotency-key";
