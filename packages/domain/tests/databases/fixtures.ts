import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabaseQueryEntry,
  type DatabaseView,
  type EntryValues,
  type Uuid,
} from "../../src/index.ts";

export const IDS = {
  database: asUuid("018f0000-0000-7000-8000-000000000001"),
  title: asUuid("018f0000-0000-7000-8000-000000000002"),
  text: asUuid("018f0000-0000-7000-8000-000000000003"),
  number: asUuid("018f0000-0000-7000-8000-000000000004"),
  date: asUuid("018f0000-0000-7000-8000-000000000005"),
  status: asUuid("018f0000-0000-7000-8000-000000000006"),
  select: asUuid("018f0000-0000-7000-8000-000000000007"),
  multi: asUuid("018f0000-0000-7000-8000-000000000008"),
  checkbox: asUuid("018f0000-0000-7000-8000-000000000009"),
  relation: asUuid("018f0000-0000-7000-8000-000000000010"),
  todo: asUuid("018f0000-0000-7000-8000-000000000011"),
  doing: asUuid("018f0000-0000-7000-8000-000000000012"),
  high: asUuid("018f0000-0000-7000-8000-000000000013"),
  view: asUuid("018f0000-0000-7000-8000-000000000014"),
  filter: asUuid("018f0000-0000-7000-8000-000000000015"),
  entryA: asUuid("018f0000-0000-7000-8000-000000000016"),
  entryB: asUuid("018f0000-0000-7000-8000-000000000017"),
  entryC: asUuid("018f0000-0000-7000-8000-000000000018"),
  relationA: asUuid("018f0000-0000-7000-8000-000000000019"),
  relationB: asUuid("018f0000-0000-7000-8000-000000000020"),
  revision: asUuid("018f0000-0000-7000-8000-000000000021"),
} as const;

export function baseProperties(): DatabaseProperty[] {
  return [
    {
      id: IDS.title,
      name: "Titre",
      type: "title",
      positionKey: "a",
      state: "active",
      config: {},
    },
    {
      id: IDS.text,
      name: "Note",
      type: "text",
      positionKey: "b",
      state: "active",
      config: {},
    },
    {
      id: IDS.number,
      name: "Charge",
      type: "number",
      positionKey: "c",
      state: "active",
      config: {},
    },
    {
      id: IDS.date,
      name: "Échéance",
      type: "date",
      positionKey: "d",
      state: "active",
      config: { mode: "date" },
    },
    {
      id: IDS.status,
      name: "Statut",
      type: "status",
      positionKey: "e",
      state: "active",
      config: {
        options: [
          { id: IDS.todo, label: "À faire", positionKey: "a", tone: "neutral", state: "active" },
          { id: IDS.doing, label: "En cours", positionKey: "b", tone: "blue", state: "active" },
        ],
      },
    },
    {
      id: IDS.select,
      name: "Priorité",
      type: "select",
      positionKey: "f",
      state: "active",
      config: {
        options: [{ id: IDS.high, label: "Haute", positionKey: "a", tone: "red", state: "active" }],
      },
    },
    {
      id: IDS.multi,
      name: "Tags",
      type: "multi-select",
      positionKey: "g",
      state: "active",
      config: {
        options: [
          { id: IDS.todo, label: "À faire", positionKey: "a", tone: "neutral", state: "active" },
          { id: IDS.doing, label: "En cours", positionKey: "b", tone: "blue", state: "active" },
        ],
      },
    },
    {
      id: IDS.checkbox,
      name: "Terminé",
      type: "checkbox",
      positionKey: "h",
      state: "active",
      config: {},
    },
    {
      id: IDS.relation,
      name: "Liens",
      type: "relation",
      positionKey: "i",
      state: "active",
      config: { cardinality: "many" },
    },
  ];
}

export function tableView(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: IDS.view,
    name: "Table principale",
    type: "table",
    positionKey: "a",
    state: "active",
    properties: baseProperties().map((property) => ({
      propertyId: property.id,
      visible: true,
      positionKey: property.positionKey,
    })),
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: null,
    options: { density: "comfortable", freezeTitle: true },
    ...overrides,
  } as DatabaseView;
}

export function definition(overrides: Partial<DatabaseDefinition> = {}): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: IDS.database,
    properties: baseProperties(),
    views: [tableView()],
    taskRoles: {
      statusPropertyId: IDS.status,
      dueDatePropertyId: IDS.date,
      priorityPropertyId: IDS.select,
    },
    ...overrides,
  };
}

export function values(entryId: Uuid, map: EntryValues["values"] = {}): EntryValues {
  return {
    format: "myownnotion.database-entry-values+json",
    formatVersion: 1,
    databaseId: IDS.database,
    entryId,
    values: map,
    preserved: [],
  };
}

export function queryEntry(
  entryId: Uuid,
  title: string,
  map: EntryValues["values"] = {},
  relationTargets: Readonly<Record<Uuid, readonly Uuid[]>> = {},
): DatabaseQueryEntry {
  return { entryId, title, values: map, relationTargets };
}
