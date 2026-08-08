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

const EditorStyleMarkSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("bold"),
      Type.Literal("italic"),
      Type.Literal("strike"),
      Type.Literal("code"),
    ]),
  },
  { additionalProperties: false },
);

const WikiLinkMarkSchema = Type.Object(
  {
    type: Type.Literal("wikiLink"),
    attrs: Type.Object(
      {
        targetItemId: UuidSchema,
        occurrenceId: UuidSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const EditorMarkSchema = Type.Union([EditorStyleMarkSchema, WikiLinkMarkSchema]);

const LegacyTaskItemAttributesSchema = Type.Object(
  { checked: Type.Boolean() },
  { additionalProperties: false },
);

export const TaskItemAttributesSchema = Type.Object(
  {
    checked: Type.Boolean(),
    taskId: UuidSchema,
    status: Type.Union([
      Type.Literal("todo"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
      Type.Literal("cancelled"),
    ]),
    dueDate: Type.Union([Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }), Type.Null()]),
    priority: Type.Union([
      Type.Literal("none"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  },
  { additionalProperties: false },
);

const EditorTextSchema = Type.Object(
  {
    type: Type.Literal("text"),
    text: Type.String({ minLength: 1 }),
    marks: Type.Optional(Type.Array(EditorMarkSchema, { uniqueItems: true })),
  },
  { additionalProperties: false },
);

export const EditorDocumentNodeSchema = Type.Recursive((Node) =>
  Type.Union([
    EditorTextSchema,
    Type.Object(
      { type: Type.Literal("paragraph"), content: Type.Optional(Type.Array(EditorTextSchema)) },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("heading"),
        attrs: Type.Object(
          { level: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]) },
          { additionalProperties: false },
        ),
        content: Type.Optional(Type.Array(EditorTextSchema)),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal("blockquote"), content: Type.Array(Node, { minItems: 1 }) },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("codeBlock"),
        attrs: Type.Optional(
          Type.Object(
            { language: Type.Optional(Type.Union([Type.String(), Type.Null()])) },
            { additionalProperties: false },
          ),
        ),
        content: Type.Optional(
          Type.Array(
            Type.Object(
              { type: Type.Literal("text"), text: Type.String({ minLength: 1 }) },
              { additionalProperties: false },
            ),
          ),
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object({ type: Type.Literal("horizontalRule") }, { additionalProperties: false }),
    Type.Object(
      {
        type: Type.Union([
          Type.Literal("listItem"),
          Type.Literal("bulletList"),
          Type.Literal("orderedList"),
        ]),
        attrs: Type.Optional(Type.Object({}, { additionalProperties: false })),
        content: Type.Array(Node, { minItems: 1 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("taskList"),
        content: Type.Array(Node, { minItems: 1 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("taskItem"),
        attrs: Type.Union([LegacyTaskItemAttributesSchema, TaskItemAttributesSchema]),
        content: Type.Array(Node, { minItems: 1 }),
      },
      { additionalProperties: false },
    ),
  ]),
);

export const EditorDocumentSchema = Type.Object(
  {
    type: Type.Literal("doc"),
    content: Type.Array(EditorDocumentNodeSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const PageDocumentSchema = Type.Object(
  {
    format: Type.Literal("myownnotion.document+json"),
    // Domain validation owns the supported-version ceiling so unknown future
    // versions receive the stable content-safe error code rather than a
    // generic transport rejection.
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
  pageDocument: Type.Optional(Type.Union([PageDocumentSchema, Type.Null()])),
  placements: Type.Array(PlacementSchema),
});
export type ItemDto = Static<typeof ItemSchema>;

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

export const ReplacePageDocumentSchema = Type.Object(
  {
    baseRevisionId: UuidSchema,
    document: PageDocumentSchema,
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
  relationshipSourceItemIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
  changedRelationships: Type.Optional(Type.Array(RelationshipSchema)),
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
