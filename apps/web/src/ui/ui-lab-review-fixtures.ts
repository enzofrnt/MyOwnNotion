import type {
  ConflictRecordRow,
  PageAmbiguityRecord,
  StructuredConflictContext,
} from "@myownnotion/client-core";
import {
  asUuid,
  type BlockDocument,
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabaseView,
} from "@myownnotion/domain";
import type { DatabaseViewPage } from "../services/databases.ts";
import type { LocalContentService } from "../services/local-content.ts";

export const reviewId = (n: number) =>
  asUuid(`018f5000-0000-7000-8000-${String(n).padStart(12, "0")}`);
export const reviewProperties: readonly DatabaseProperty[] = [
  { id: reviewId(1), name: "Nom", type: "title", positionKey: "a", state: "active", config: {} },
  {
    id: reviewId(2),
    name: "État",
    type: "status",
    positionKey: "b",
    state: "active",
    config: {
      options: [
        {
          id: reviewId(20),
          label: "Pas commencé",
          tone: "gray",
          positionKey: "a",
          state: "active",
        },
        { id: reviewId(21), label: "En cours", tone: "blue", positionKey: "b", state: "active" },
        { id: reviewId(22), label: "Terminé", tone: "green", positionKey: "c", state: "active" },
      ],
    },
  },
  {
    id: reviewId(3),
    name: "Date",
    type: "date",
    positionKey: "c",
    state: "active",
    config: { mode: "date" },
  },
  { id: reviewId(4), name: "Texte", type: "text", positionKey: "d", state: "active", config: {} },
  {
    id: reviewId(5),
    name: "Valeur",
    type: "number",
    positionKey: "e",
    state: "active",
    config: {},
  },
  {
    id: reviewId(6),
    name: "Validé",
    type: "checkbox",
    positionKey: "f",
    state: "active",
    config: {},
  },
  {
    id: reviewId(7),
    name: "Catégories",
    type: "multi-select",
    positionKey: "g",
    state: "active",
    config: {
      options: [
        {
          id: reviewId(23),
          label: "Une option au nom particulièrement long",
          tone: "purple",
          positionKey: "a",
          state: "active",
        },
      ],
    },
  },
  {
    id: reviewId(8),
    name: "Priorité",
    type: "select",
    positionKey: "h",
    state: "active",
    config: {
      options: [
        { id: reviewId(24), label: "Haute", tone: "red", positionKey: "a", state: "active" },
      ],
    },
  },
  {
    id: reviewId(9),
    name: "Échéance précise",
    type: "date",
    positionKey: "i",
    state: "active",
    config: { mode: "instant" },
  },
  {
    id: reviewId(13),
    name: "Pages liées",
    type: "relation",
    positionKey: "j",
    state: "active",
    config: { cardinality: "many" },
  },
];
export const reviewTable: Extract<DatabaseView, { type: "table" }> = {
  id: reviewId(10),
  name: "Table",
  type: "table",
  positionKey: "a",
  state: "active",
  properties: reviewProperties.map((p) => ({
    propertyId: p.id,
    visible: true,
    positionKey: p.positionKey,
    width: p.type === "title" ? 300 : 180,
  })),
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { density: "comfortable", freezeTitle: true },
};
export const reviewDefinition: DatabaseDefinition = {
  format: "myownnotion.database-definition+json",
  formatVersion: 1,
  databaseId: reviewId(11),
  properties: reviewProperties,
  views: [reviewTable],
  taskRoles: null,
};
export const reviewPage: DatabaseViewPage = {
  databaseId: reviewId(11),
  viewId: reviewId(10),
  definitionRevisionId: reviewId(12),
  generation: 1,
  coverage: "complete",
  availableCount: 2,
  expectedCount: 2,
  rows: [
    {
      entryId: reviewId(30),
      revisionId: reviewId(12),
      title: "Préparer la prochaine version",
      values: {
        [reviewId(2)]: { kind: "status", optionId: reviewId(21) },
        [reviewId(3)]: { kind: "date", date: "2026-10-05" },
        [reviewId(4)]: { kind: "text", value: "Conserver une interface calme et prévisible." },
        [reviewId(5)]: { kind: "number", decimal: "42.5" },
        [reviewId(6)]: { kind: "checkbox", checked: true },
        [reviewId(7)]: { kind: "multi-select", optionIds: [reviewId(23)] },
      },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
    {
      entryId: reviewId(31),
      revisionId: reviewId(12),
      title: "Un projet avec un nom particulièrement long qui garde ses actions accessibles",
      values: {
        [reviewId(2)]: { kind: "status", optionId: reviewId(20) },
      },
      relationTargets: {},
      groupId: null,
      syncState: "pending",
      itemKind: "folder",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};
export const reviewDocument = (text: string): BlockDocument => ({
  blocks: [{ id: reviewId(40), type: "paragraph", content: [{ text }] }],
});
const conflict: ConflictRecordRow = {
  mutationId: reviewId(41),
  commandType: "page.document.replace",
  payload: {
    itemId: reviewId(42),
    document: {
      body: reviewDocument(
        "La préparation se termine sur cet appareil. https://exemple.local/un-chemin-particulierement-long-sans-espace-pour-verifier-la-largeur-du-contenu",
      ),
    },
  },
  baseRevisionIds: [reviewId(43)],
  localRevisionIds: [reviewId(44)],
  competingRevisionIds: [reviewId(45)],
  capturedAt: "2026-10-03T10:00:00Z",
  errorCode: "revision.stale-base",
};
// Only this lab boundary adapts a small memory fixture to the service shape.
// No production service is instantiated; decisions return a local failure.
export const reviewConflictService = {
  outbox: { activeConflicts: async () => [conflict] },
  api: {
    getRevision: async (revisionId: string) => ({
      ok: true,
      value: {
        snapshot: {
          pageDocument: {
            body: reviewDocument(
              revisionId === reviewId(43)
                ? "La préparation est prévue."
                : "La préparation continue sur l’autre appareil.",
            ),
          },
        },
      },
    }),
  },
  resolveConflict: async () => ({
    ok: false,
    error: {
      code: "example.local",
      title: "Exemple local : les deux versions restent conservées.",
    },
  }),
  resolveDatabaseEntryConflict: async () => ({
    ok: false,
    error: { code: "example.local", title: "Exemple local : aucun enregistrement sur le serveur." },
  }),
} as unknown as LocalContentService;
const entryValues = (value: string) => ({
  format: "myownnotion.database-entry-values+json" as const,
  formatVersion: 1 as const,
  databaseId: reviewId(11),
  entryId: reviewId(30),
  preserved: [],
  values: { [reviewId(4)]: { kind: "text" as const, value } },
});
export const reviewStructuredConflict: ConflictRecordRow & {
  readonly structured: StructuredConflictContext;
} = {
  ...conflict,
  mutationId: reviewId(46),
  commandType: "database.entry-values.replace",
  payload: { databaseId: reviewId(11), entryId: reviewId(30) },
  structured: {
    kind: "database-entry-values" as const,
    conflicts: [{ path: `values.${reviewId(4)}`, reason: "divergent-edit" as const }],
    ancestor: entryValues("Préparation"),
    local: entryValues("Préparation sur cet appareil"),
    remote: entryValues("Préparation sur l’autre appareil"),
    ancestorRelationTargets: {},
    localRelationTargets: {},
    remoteRelationTargets: {},
  },
};
export const reviewAmbiguity: PageAmbiguityRecord = {
  ambiguityId: reviewId(50),
  pageId: reviewId(42),
  kind: "delete-edit",
  status: "open",
  openedAt: "2026-10-03T10:00:00Z",
  recordVersion: 1,
  details: {
    logicalKey: "review-delete-edit",
    kind: "delete-edit",
    status: "open",
    blockIds: [reviewId(40)],
    sourceUpdateIds: [reviewId(51), reviewId(52)],
    recoverableSubtree: {
      id: reviewId(40),
      type: "paragraph",
      content: [{ text: "Un paragraphe modifié pendant que l’autre appareil le supprimait." }],
    },
  },
};
