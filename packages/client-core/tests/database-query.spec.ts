import type { ItemDto } from "@myownnotion/contracts";
import {
  asUuid,
  type DatabaseDefinition,
  evaluateDatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  type LocalDatabase,
  LocalDatabaseQueryError,
  type LocalDatabaseQuerySource,
  LocalDatabaseRepository,
  LocalRepository,
  openLocalDatabase,
  queryLocalDatabase,
} from "../src/index.ts";
import { createTestCodec } from "./helpers/codec.ts";

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
  it.each(["unknown", "retired", "invalid filter"] as const)(
    "refuses a %s view instead of displaying misleading rows",
    (failure) => {
      const input = source([entry(ids.entryA, "Alpha", ids.todo)]);
      const candidate = {
        ...input,
        definition: {
          ...input.definition,
          views: input.definition.views.map((view) =>
            failure === "retired"
              ? { ...view, state: "retired" as const }
              : failure === "invalid filter"
                ? {
                    ...view,
                    filter: {
                      mode: "all" as const,
                      criteria: [
                        {
                          id: ids.filter,
                          propertyId: ids.title,
                          operator: "less-than" as const,
                          operand: { kind: "number" as const, decimal: "1" },
                        },
                      ],
                    },
                  }
                : view,
          ),
        },
      };
      try {
        queryLocalDatabase(candidate, {
          viewId: failure === "unknown" ? generateUuidV7() : ids.view,
        });
        throw new Error("An invalid view was accepted");
      } catch (error) {
        expect(error).toMatchObject({ code: "database.invalid-view" });
      }
    },
  );

  it.each([
    "invalid",
    "remote.1",
    "local.2.a.b.c.1.1.d",
    "local.1.a.b.c.1.0.d",
    "local.1.a.b.c.1.-1.d",
    "local.1.a.b.c.1.NaN.d",
    "local.1.a.b.c.1.1.5.d",
    "local.1.a.b.c.1.9007199254740992.d",
  ])("rejects malformed local cursor %s", (cursor) => {
    const input = source([entry(ids.entryA, "Alpha", ids.todo)]);
    expect(() => queryLocalDatabase(input, { viewId: ids.view, cursor })).toThrowError(
      expect.objectContaining({ code: "database.invalid-cursor" }),
    );
  });

  it("pages through a stable projection without repeating or omitting identities", () => {
    const input = source([
      entry(ids.entryA, "Alpha", ids.todo),
      entry(ids.entryB, "Beta", ids.todo),
      entry(ids.entryC, "Gamma", ids.todo),
    ]);
    const first = queryLocalDatabase(input, { viewId: ids.view, limit: 1 });
    if (first.nextCursor === null) throw new Error("Missing cursor");
    const next = queryLocalDatabase(input, {
      viewId: ids.view,
      cursor: first.nextCursor,
      limit: 2,
    });
    expect([...first.rows, ...next.rows].map((row) => row.entryId)).toEqual([
      ids.entryA,
      ids.entryB,
      ids.entryC,
    ]);
    expect(next.nextCursor).toBeNull();
    const foreign = { ...input, databaseId: generateUuidV7() };
    const cursor = first.nextCursor;
    expect(() => queryLocalDatabase(foreign, { viewId: ids.view, cursor })).toThrowError(
      expect.objectContaining({ code: "database.cursor-stale" }),
    );
  });
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

function projectedItem(
  id: Uuid,
  name: string,
  lifecycle: ItemDto["lifecycle"] = "active",
  parentItemId: Uuid | null = null,
  kind: "page" | "database" = "page",
): ItemDto {
  return {
    id,
    kind,
    name,
    lifecycle,
    currentRevisionId: generateUuidV7(),
    pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
    placements: [
      {
        id: generateUuidV7(),
        itemId: id,
        kind: "hierarchy",
        parentItemId,
        positionKey: "V",
      },
    ],
  };
}

describe("purged structured projections (T102, FR-046)", () => {
  it("keeps the owner tombstone but removes its source and entries on purge", async () => {
    const { codec } = await createTestCodec();
    const db: LocalDatabase = openLocalDatabase(`database-purge-${generateUuidV7()}`);
    const repository = new LocalRepository(db, codec);
    const databases = new LocalDatabaseRepository(db, codec);
    const values = {
      format: "myownnotion.database-entry-values+json" as const,
      formatVersion: 1 as const,
      databaseId: ids.database,
      entryId: ids.entryA,
      values: { [ids.status]: { kind: "status" as const, optionId: ids.todo } },
      preserved: [],
    };
    try {
      await repository.replaceFromSnapshot({
        workspaceId: generateUuidV7(),
        schemaVersion: 7,
        cursor: "before-purge",
        items: [
          projectedItem(ids.database, "Database", "active", null, "database"),
          projectedItem(ids.entryA, "Entry", "active", ids.database),
        ],
        databases: [
          { itemId: ids.database, definitionVersion: 1, definition: definition() as never },
        ],
        databaseEntries: [
          {
            entryItemId: ids.entryA,
            databaseId: ids.database,
            valueVersion: 1,
            values,
          },
        ],
      });
      expect(await databases.getDatabase(ids.database)).not.toBeNull();
      expect(await databases.getEntry(ids.entryA)).not.toBeNull();

      await repository.applyServerChange({
        cursor: "after-purge",
        items: [projectedItem(ids.database, "Unavailable database", "purged", null, "database")],
        // A stale source envelope accompanying the owner tombstone cannot revive it.
        databases: [
          { itemId: ids.database, definitionVersion: 1, definition: definition() as never },
        ],
        databaseEntries: [
          {
            entryItemId: ids.entryA,
            databaseId: ids.database,
            valueVersion: 1,
            values,
          },
        ],
      });

      expect((await repository.getItem(ids.database))?.lifecycle).toBe("purged");
      expect(await databases.getDatabase(ids.database)).toBeNull();
      expect(await databases.getEntry(ids.entryA)).toBeNull();
      await repository.applyServerChange({
        cursor: "entry-purge",
        items: [projectedItem(ids.entryA, "Unavailable entry", "purged")],
      });
      expect(await databases.getEntry(ids.entryA)).toBeNull();
      expect(await repository.getLastChangeCursor()).toBe("entry-purge");
    } finally {
      await db.delete();
    }
  });
});
