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

/**
 * Asking that an item stay on the owner's devices (feature 005, FR-016).
 *
 * The desired state, not a toggle, for the reason `FavouriteItemSchema` gives:
 * the offline outbox replays, and a toggle replayed an even number of times
 * lands on the answer the owner did not give.
 */
export const OfflineIntentSchema = Type.Object(
  { offline: Type.Boolean() },
  { additionalProperties: false },
);
export type OfflineIntentDto = Static<typeof OfflineIntentSchema>;

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

export const TrashImpactSchema = Type.Object(
  {
    isDatabase: Type.Boolean(),
    activeEntryCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type TrashImpactDto = Static<typeof TrashImpactSchema>;

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
  /**
   * Which device wrote this, and what kind of change it was (feature 006,
   * FR-022).
   *
   * The device is nullable and the name optional, because a revision written
   * before this feature has no device to name and a device the owner deleted has
   * no name to give. Both are reported as unknown rather than filled in: a
   * history that guesses is worse than one that admits a gap.
   *
   * What is deliberately absent is anything technical (FR-023) — no session
   * identifier, no key generation, nothing derived from key material. A history
   * is read and exported, so a secret recorded here would leak through every
   * path that shows it.
   */
  authoredByDeviceId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
  authoredByDeviceName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** What the change was, in the owner's terms rather than a command name. */
  changeNature: Type.Optional(Type.String()),
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

// ---------------------------------------------------------------------------
// Private workspace search (feature 008)
// ---------------------------------------------------------------------------

export const SearchRequestSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 512 }),
    kinds: Type.Optional(Type.Array(ItemKindSchema, { uniqueItems: true, maxItems: 3 })),
    branchRootItemId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false },
);
export type SearchRequestDto = Static<typeof SearchRequestSchema>;

export const SearchPathSegmentSchema = Type.Object(
  {
    itemId: UuidSchema,
    title: DisplayNameSchema,
  },
  { additionalProperties: false },
);

export const SearchResultSchema = Type.Object(
  {
    itemId: UuidSchema,
    revisionId: UuidSchema,
    kind: ItemKindSchema,
    title: DisplayNameSchema,
    path: Type.Array(SearchPathSegmentSchema),
    matchedField: Type.Union([
      Type.Literal("title"),
      Type.Literal("fileName"),
      Type.Literal("body"),
      Type.Literal("property"),
    ]),
    propertyId: Type.Union([UuidSchema, Type.Null()]),
    propertyName: Type.Union([DisplayNameSchema, Type.Null()]),
    snippet: Type.Union([Type.String({ maxLength: 320 }), Type.Null()]),
    conflict: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SearchResultDto = Static<typeof SearchResultSchema>;

export const SearchResponseSchema = Type.Object(
  {
    coverage: Type.Literal("complete"),
    generation: Type.Integer({ minimum: 1 }),
    results: Type.Array(SearchResultSchema, { maxItems: 50 }),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SearchResponseDto = Static<typeof SearchResponseSchema>;

export const SearchProblemCodeSchema = Type.Union([
  Type.Literal("search.empty-query"),
  Type.Literal("search.query-too-long"),
  Type.Literal("search.invalid-filter"),
  Type.Literal("search.invalid-cursor"),
  Type.Literal("search.cursor-stale"),
  Type.Literal("search.building"),
  Type.Literal("search.degraded"),
]);

export const SearchUnavailableProblemSchema = Type.Intersect([
  ProblemSchema,
  Type.Object({
    code: SearchProblemCodeSchema,
    searchState: Type.Union([Type.Literal("building"), Type.Literal("degraded")]),
    indexedCount: Type.Integer({ minimum: 0 }),
    expectedCount: Type.Integer({ minimum: 0 }),
  }),
]);
export type SearchUnavailableProblemDto = Static<typeof SearchUnavailableProblemSchema>;

// ---------------------------------------------------------------------------
// Page-backed databases and structured tasks (feature 009)
// ---------------------------------------------------------------------------

const DatabaseStateSchema = Type.Union([Type.Literal("active"), Type.Literal("retired")]);
const DatabaseEmptyConfigSchema = Type.Object({}, { additionalProperties: false });
const DatabasePlacementInputSchema = Type.Object(
  {
    id: UuidSchema,
    parentItemId: NullableUuid,
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);

export const DatabasePropertyOptionSchema = Type.Object(
  {
    id: UuidSchema,
    label: DisplayNameSchema,
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
    tone: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
    state: DatabaseStateSchema,
  },
  { additionalProperties: false },
);

const DatabasePropertyBase = {
  id: UuidSchema,
  name: DisplayNameSchema,
  positionKey: Type.String({ minLength: 1, maxLength: 255 }),
  state: DatabaseStateSchema,
};

export const DatabasePropertySchema = Type.Union([
  Type.Object(
    {
      ...DatabasePropertyBase,
      type: Type.Union([
        Type.Literal("title"),
        Type.Literal("text"),
        Type.Literal("number"),
        Type.Literal("checkbox"),
      ]),
      config: DatabaseEmptyConfigSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DatabasePropertyBase,
      type: Type.Literal("date"),
      config: Type.Object(
        { mode: Type.Union([Type.Literal("date"), Type.Literal("instant")]) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DatabasePropertyBase,
      type: Type.Union([
        Type.Literal("status"),
        Type.Literal("select"),
        Type.Literal("multi-select"),
      ]),
      config: Type.Object(
        { options: Type.Array(DatabasePropertyOptionSchema) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DatabasePropertyBase,
      type: Type.Literal("relation"),
      config: Type.Object(
        { cardinality: Type.Union([Type.Literal("one"), Type.Literal("many")]) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const DatabasePropertyValueSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("text"), value: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("number"),
      decimal: Type.String({ pattern: "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("date"), date: Type.String({ format: "date" }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("instant"), instant: Type.String({ format: "date-time" }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("status"), optionId: UuidSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("select"), optionId: UuidSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("multi-select"),
      optionIds: Type.Array(UuidSchema, { uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("checkbox"), checked: Type.Boolean() },
    { additionalProperties: false },
  ),
]);

const UuidKeySchema = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
export const DatabaseValuesMapSchema = Type.Record(UuidKeySchema, DatabasePropertyValueSchema);
export const DatabaseRelationTargetsMapSchema = Type.Record(
  UuidKeySchema,
  Type.Array(UuidSchema, { uniqueItems: true }),
);

export const DatabaseFilterCriterionSchema = Type.Object(
  {
    id: UuidSchema,
    propertyId: UuidSchema,
    operator: Type.Union(
      [
        "equals",
        "not-equals",
        "is-empty",
        "is-not-empty",
        "contains",
        "not-contains",
        "before",
        "after",
        "between",
        "less-than",
        "greater-than",
      ].map((operator) => Type.Literal(operator)),
    ),
    operand: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const DatabaseSortCriterionSchema = Type.Object(
  {
    propertyId: UuidSchema,
    direction: Type.Union([Type.Literal("ascending"), Type.Literal("descending")]),
    missing: Type.Union([Type.Literal("first"), Type.Literal("last")]),
  },
  { additionalProperties: false },
);

export const DatabaseViewPropertySchema = Type.Object(
  {
    propertyId: UuidSchema,
    visible: Type.Boolean(),
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
    width: Type.Optional(Type.Integer({ minimum: 80, maximum: 800 })),
  },
  { additionalProperties: false },
);

export const DatabaseViewSchema = Type.Object(
  {
    id: UuidSchema,
    name: DisplayNameSchema,
    type: Type.Union([
      Type.Literal("table"),
      Type.Literal("board"),
      Type.Literal("gallery"),
      Type.Literal("list"),
      Type.Literal("calendar"),
    ]),
    positionKey: Type.String({ minLength: 1, maxLength: 255 }),
    state: DatabaseStateSchema,
    properties: Type.Array(DatabaseViewPropertySchema),
    filter: Type.Object(
      {
        mode: Type.Union([Type.Literal("all"), Type.Literal("any")]),
        criteria: Type.Array(DatabaseFilterCriterionSchema),
      },
      { additionalProperties: false },
    ),
    sorts: Type.Array(DatabaseSortCriterionSchema),
    group: Type.Union([
      Type.Object({ propertyId: UuidSchema }, { additionalProperties: false }),
      Type.Null(),
    ]),
    options: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false },
);

export const DatabaseTaskRoleMappingSchema = Type.Object(
  {
    statusPropertyId: UuidSchema,
    dueDatePropertyId: NullableUuid,
    priorityPropertyId: NullableUuid,
  },
  { additionalProperties: false },
);

export const DatabaseDefinitionSchema = Type.Object(
  {
    format: Type.Literal("myownnotion.database-definition+json"),
    formatVersion: Type.Literal(1),
    databaseId: UuidSchema,
    properties: Type.Array(DatabasePropertySchema, { minItems: 1 }),
    views: Type.Array(DatabaseViewSchema, { minItems: 1 }),
    taskRoles: Type.Union([DatabaseTaskRoleMappingSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type DatabaseDefinitionDto = Static<typeof DatabaseDefinitionSchema>;

export const CreateDatabaseRequestSchema = Type.Object(
  {
    id: UuidSchema,
    name: DisplayNameSchema,
    placement: DatabasePlacementInputSchema,
    titlePropertyId: UuidSchema,
    titlePropertyName: Type.Optional(DisplayNameSchema),
    initialViewId: UuidSchema,
    initialViewName: DisplayNameSchema,
  },
  { additionalProperties: false },
);
export type CreateDatabaseRequestDto = Static<typeof CreateDatabaseRequestSchema>;

export const DefinitionImpactSchema = Type.Object(
  {
    destructive: Type.Boolean(),
    affectedEntryCount: Type.Integer({ minimum: 0 }),
    affectedValueCount: Type.Integer({ minimum: 0 }),
    reasons: Type.Array(
      Type.Union([
        Type.Literal("property-retired"),
        Type.Literal("property-type-changed"),
        Type.Literal("option-retired"),
        Type.Literal("task-role-invalidated"),
      ]),
    ),
    impactDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export type DefinitionImpactDto = Static<typeof DefinitionImpactSchema>;

export const ReplaceDefinitionCandidateSchema = Type.Object(
  { baseRevisionId: UuidSchema, definition: DatabaseDefinitionSchema },
  { additionalProperties: false },
);
export const ReplaceDefinitionRequestSchema = Type.Object(
  {
    baseRevisionId: UuidSchema,
    definition: DatabaseDefinitionSchema,
    impactConfirmation: Type.Optional(
      Type.Object(
        {
          digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          decision: Type.Union([
            Type.Literal("preserve-incompatible"),
            Type.Literal("discard-confirmed"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ReplaceDefinitionRequestDto = Static<typeof ReplaceDefinitionRequestSchema>;

export const CreateEntryRequestSchema = Type.Object(
  {
    id: UuidSchema,
    title: DisplayNameSchema,
    placement: DatabasePlacementInputSchema,
    document: Type.Optional(PageDocumentSchema),
    values: DatabaseValuesMapSchema,
    relationTargets: DatabaseRelationTargetsMapSchema,
  },
  { additionalProperties: false },
);
export type CreateEntryRequestDto = Static<typeof CreateEntryRequestSchema>;

export const ReplaceEntryValuesRequestSchema = Type.Object(
  {
    baseRevisionId: UuidSchema,
    values: DatabaseValuesMapSchema,
    relationTargets: DatabaseRelationTargetsMapSchema,
  },
  { additionalProperties: false },
);
export type ReplaceEntryValuesRequestDto = Static<typeof ReplaceEntryValuesRequestSchema>;

export const DatabaseSchema = Type.Object(
  {
    databaseId: UuidSchema,
    definitionRevisionId: UuidSchema,
    lifecycle: LifecycleSchema,
    name: Type.String(),
    definition: DatabaseDefinitionSchema,
  },
  { additionalProperties: false },
);
export type DatabaseDto = Static<typeof DatabaseSchema>;

export const DatabaseEntrySchema = Type.Object(
  {
    databaseId: UuidSchema,
    entryId: UuidSchema,
    revisionId: UuidSchema,
    lifecycle: LifecycleSchema,
    title: Type.String(),
    document: Type.Union([PageDocumentSchema, Type.Null()]),
    values: DatabaseValuesMapSchema,
    relationTargets: DatabaseRelationTargetsMapSchema,
  },
  { additionalProperties: false },
);
export type DatabaseEntryDto = Static<typeof DatabaseEntrySchema>;

/** Full protected value payload used by snapshots and change catch-up. */
export const DatabaseEntryValuesPayloadSchema = Type.Object(
  {
    format: Type.Literal("myownnotion.database-entry-values+json"),
    formatVersion: Type.Literal(1),
    databaseId: UuidSchema,
    entryId: UuidSchema,
    values: DatabaseValuesMapSchema,
    preserved: Type.Array(
      Type.Object(
        {
          propertyId: UuidSchema,
          sourceType: Type.Union(
            [
              "title",
              "text",
              "number",
              "date",
              "status",
              "select",
              "multi-select",
              "checkbox",
              "relation",
            ].map((type) => Type.Literal(type)),
          ),
          value: Type.Unknown(),
          preservedAtRevisionId: UuidSchema,
          reason: Type.Union([
            Type.Literal("incompatible-conversion"),
            Type.Literal("retired-property"),
            Type.Literal("retired-option"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type DatabaseEntryValuesPayloadDto = Static<typeof DatabaseEntryValuesPayloadSchema>;

/** Exact local-projection row carried by sync, without duplicating item data. */
export const DatabaseProjectionSchema = Type.Object(
  {
    itemId: UuidSchema,
    definitionVersion: Type.Integer({ minimum: 1 }),
    definition: DatabaseDefinitionSchema,
  },
  { additionalProperties: false },
);
export type DatabaseProjectionDto = Static<typeof DatabaseProjectionSchema>;

export const DatabaseEntryProjectionSchema = Type.Object(
  {
    entryItemId: UuidSchema,
    databaseId: UuidSchema,
    valueVersion: Type.Integer({ minimum: 1 }),
    values: DatabaseEntryValuesPayloadSchema,
  },
  { additionalProperties: false },
);
export type DatabaseEntryProjectionDto = Static<typeof DatabaseEntryProjectionSchema>;

/**
 * New projection sets are optional so a newer client can still read a feed
 * produced before structured databases existed.
 */
export const ChangeEnvelopeSchema = Type.Object({
  sequence: Type.Integer({ minimum: 1 }),
  mutationId: UuidSchema,
  revisionIds: Type.Array(UuidSchema),
  nature: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  changedItems: Type.Optional(Type.Array(ItemSchema)),
  relationships: Type.Optional(Type.Array(RelationshipSchema)),
  databases: Type.Optional(Type.Array(DatabaseProjectionSchema)),
  databaseEntries: Type.Optional(Type.Array(DatabaseEntryProjectionSchema)),
});
export type ChangeEnvelopeDto = Static<typeof ChangeEnvelopeSchema>;

export const ChangesResponseSchema = Type.Object({
  changes: Type.Array(ChangeEnvelopeSchema),
  nextCursor: Type.String(),
  hasMore: Type.Boolean(),
});
export type ChangesResponseDto = Static<typeof ChangesResponseSchema>;

export const DatabaseMutationResultSchema = Type.Object(
  {
    mutationId: UuidSchema,
    revisionIds: Type.Array(UuidSchema, { minItems: 1 }),
    database: DatabaseSchema,
  },
  { additionalProperties: false },
);
export type DatabaseMutationResultDto = Static<typeof DatabaseMutationResultSchema>;

export const EntryMutationResultSchema = Type.Object(
  {
    mutationId: UuidSchema,
    revisionIds: Type.Array(UuidSchema, { minItems: 1 }),
    entry: DatabaseEntrySchema,
  },
  { additionalProperties: false },
);
export type EntryMutationResultDto = Static<typeof EntryMutationResultSchema>;

export const DatabaseQuerySchema = Type.Object(
  {
    viewId: UuidSchema,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  },
  { additionalProperties: false },
);
export type DatabaseQueryDto = Static<typeof DatabaseQuerySchema>;

export const DatabaseQueryRowSchema = Type.Object(
  {
    entryId: UuidSchema,
    revisionId: UuidSchema,
    title: Type.String(),
    values: DatabaseValuesMapSchema,
    relationTargets: DatabaseRelationTargetsMapSchema,
    groupId: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const DatabaseGroupSummarySchema = Type.Object(
  { id: Type.String(), label: Type.String(), count: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const DatabaseQueryPageSchema = Type.Object(
  {
    databaseId: UuidSchema,
    viewId: UuidSchema,
    definitionRevisionId: UuidSchema,
    generation: Type.Integer({ minimum: 1 }),
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
    availableCount: Type.Integer({ minimum: 0 }),
    expectedCount: Type.Integer({ minimum: 0 }),
    rows: Type.Array(DatabaseQueryRowSchema, { maxItems: 100 }),
    groups: Type.Array(DatabaseGroupSummarySchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type DatabaseQueryPageDto = Static<typeof DatabaseQueryPageSchema>;

export const DatabaseProjectionUnavailableProblemSchema = Type.Intersect([
  ProblemSchema,
  Type.Object({
    code: Type.Union([
      Type.Literal("database.projection-building"),
      Type.Literal("database.projection-degraded"),
    ]),
    projectionState: Type.Union([Type.Literal("building"), Type.Literal("degraded")]),
    indexedCount: Type.Integer({ minimum: 0 }),
    expectedCount: Type.Integer({ minimum: 0 }),
  }),
]);
export type DatabaseProjectionUnavailableProblemDto = Static<
  typeof DatabaseProjectionUnavailableProblemSchema
>;

export const CanonicalSnapshotSchema = Type.Object({
  workspaceId: UuidSchema,
  schemaVersion: Type.Integer({ minimum: 1 }),
  cursor: Type.String(),
  digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  items: Type.Array(ItemSchema),
  relationships: Type.Array(RelationshipSchema),
  // Optional for reading snapshots emitted before feature 009. New servers
  // always send both arrays, including when they are empty.
  databases: Type.Optional(Type.Array(DatabaseProjectionSchema)),
  databaseEntries: Type.Optional(Type.Array(DatabaseEntryProjectionSchema)),
});
export type CanonicalSnapshotDto = Static<typeof CanonicalSnapshotSchema>;

export const SearchHealthSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("cold"),
      Type.Literal("building"),
      Type.Literal("ready"),
      Type.Literal("degraded"),
    ]),
    generation: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    indexedCount: Type.Integer({ minimum: 0 }),
    expectedCount: Type.Integer({ minimum: 0 }),
    failureCode: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal("ready"),
    schemaVersion: Type.Integer({ minimum: 1 }),
    /** Safe operational state only; never titles, snippets, queries or keys. */
    search: Type.Optional(SearchHealthSchema),
  },
  { additionalProperties: false },
);

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
