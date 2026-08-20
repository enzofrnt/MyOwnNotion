import {
  asUuid,
  type DatabaseDefinition,
  evaluateDatabaseView,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  LocalDatabaseQueryError,
  type LocalDatabaseQuerySource,
  queryLocalDatabase,
} from "../src/index.ts";

const ids = {
  database: asUuid("018f3000-0000-7000-8000-000000000001"),
  revision: asUuid("018f3000-0000-7000-8000-000000000002"),
  nextRevision: asUuid("018f3000-0000-7000-8000-000000000003"),
  title: asUuid("018f3000-0000-7000-8000-000000000004"),
  status: asUuid("018f3000-0000-7000-8000-000000000005"),
  todo: asUuid("018f3000-0000-7000-8000-000000000006"),
  done: asUuid("018f3000-0000-7000-8000-000000000007"),
  view: asUuid("018f3000-0000-7000-8000-000000000008"),
  filter: asUuid("018f3000-0000-7000-8000-000000000009"),
  entryA: asUuid("018f3000-0000-7000-8000-000000000010"),
  entryB: asUuid("018f3000-0000-7000-8000-000000000011"),
  entryC: asUuid("018f3000-0000-7000-8000-000000000012"),
} as const;

function definition(): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: ids.database,
    properties: [
      {
        id: ids.title,
        name: "Titre",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
      {
        id: ids.status,
        name: "Statut",
        type: "status",
        positionKey: "b",
        state: "active",
        config: {
          options: [
            { id: ids.todo, label: "À faire", positionKey: "a", tone: "neutral", state: "active" },
            { id: ids.done, label: "Terminé", positionKey: "b", tone: "green", state: "active" },
          ],
        },
      },
    ],
    views: [
      {
        id: ids.view,
        name: "À faire",
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [
          { propertyId: ids.title, visible: true, positionKey: "a" },
          { propertyId: ids.status, visible: true, positionKey: "b" },
        ],
        filter: {
          mode: "all",
          criteria: [
            {
              id: ids.filter,
              propertyId: ids.status,
              operator: "equals",
              operand: { kind: "status", optionId: ids.todo },
            },
          ],
        },
        sorts: [],
        group: { propertyId: ids.status },
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles: null,
  };
}

function entry(
  entryId: Uuid,
  title: string,
  status: Uuid,
  availability: "present" | "offloaded" | "never-fetched" = "present",
): LocalDatabaseQuerySource["entries"][number] {
  return {
    entryId,
    revisionId: asUuid(`018f3000-0000-7001-8000-${entryId.slice(-12)}`),
    title,
    availability,
    values: { [ids.status]: { kind: "status", optionId: status } },
    relationTargets: {},
  };
}

function source(
  entries: LocalDatabaseQuerySource["entries"],
  overrides: Partial<LocalDatabaseQuerySource> = {},
): LocalDatabaseQuerySource {
  return {
    databaseId: ids.database,
    definitionRevisionId: ids.revision,
    definition: definition(),
    generation: 1,
    expectedCount: entries.length,
    entries,
    ...overrides,
  };
}

describe("local saved database queries", () => {
  it("has the same filtered identities, order and groups as the shared evaluator", () => {
    const localSource = source([
      entry(ids.entryB, "Beta", ids.todo),
      entry(ids.entryA, "Alpha", ids.todo),
      entry(ids.entryC, "Gamma", ids.done),
    ]);
    const local = queryLocalDatabase(localSource, { viewId: ids.view });
    const shared = evaluateDatabaseView(localSource.definition, ids.view, localSource.entries);
    if (!shared.ok) throw new Error(shared.error.code);

    expect(local.coverage).toBe("complete");
    expect(local.rows.map(({ entryId }) => entryId)).toEqual(
      shared.value.rows.map(({ entryId }) => entryId),
    );
    expect(local.groups).toEqual([{ id: ids.todo, label: "À faire", count: 2 }]);
  });

  it("labels an incomplete local projection partial and never exposes exhaustive groups", () => {
    const local = queryLocalDatabase(
      source(
        [
          entry(ids.entryA, "Présente", ids.todo),
          entry(ids.entryB, "Déchargée", ids.todo, "offloaded"),
        ],
        { expectedCount: 3 },
      ),
      { viewId: ids.view },
    );

    expect(local).toMatchObject({
      coverage: "partial",
      availableCount: 1,
      expectedCount: 3,
      groups: [],
    });
    expect(local.rows.map(({ entryId }) => entryId)).toEqual([ids.entryA]);
  });

  it("recalculates after a committed source replacement and invalidates its old cursor", () => {
    const before = source([
      entry(ids.entryA, "Alpha", ids.todo),
      entry(ids.entryB, "Beta", ids.todo),
    ]);
    const first = queryLocalDatabase(before, { viewId: ids.view, limit: 1 });
    const cursor = first.nextCursor;
    if (cursor === null) throw new Error("expected a second local page");

    const after = source(
      [entry(ids.entryA, "Alpha", ids.done), entry(ids.entryB, "Beta", ids.todo)],
      { definitionRevisionId: ids.nextRevision, generation: 2 },
    );
    expect(
      queryLocalDatabase(after, { viewId: ids.view }).rows.map(({ entryId }) => entryId),
    ).toEqual([ids.entryB]);
    expect(() => queryLocalDatabase(after, { viewId: ids.view, cursor })).toThrowError(
      LocalDatabaseQueryError,
    );
  });
});
