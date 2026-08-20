import type { DatabaseQueryDto } from "@myownnotion/contracts";
import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseQueryEntry,
  type DatabaseView,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  DatabaseProjectionUnavailableError,
  DatabaseQueryRequestError,
  DatabaseQueryService,
  type DatabaseQueryServiceDeps,
  type StructuredProjectionSource,
} from "../src/databases/database-query-service.ts";

const ids = {
  database: asUuid("018f2000-0000-7000-8000-000000000001"),
  revision: asUuid("018f2000-0000-7000-8000-000000000002"),
  nextRevision: asUuid("018f2000-0000-7000-8000-000000000003"),
  title: asUuid("018f2000-0000-7000-8000-000000000004"),
  status: asUuid("018f2000-0000-7000-8000-000000000005"),
  todo: asUuid("018f2000-0000-7000-8000-000000000006"),
  done: asUuid("018f2000-0000-7000-8000-000000000007"),
  view: asUuid("018f2000-0000-7000-8000-000000000008"),
  filter: asUuid("018f2000-0000-7000-8000-000000000009"),
  entryA: asUuid("018f2000-0000-7000-8000-000000000010"),
  entryB: asUuid("018f2000-0000-7000-8000-000000000011"),
  entryC: asUuid("018f2000-0000-7000-8000-000000000012"),
} as const;

function view(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
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
    ...overrides,
  } as DatabaseView;
}

function definition(databaseView = view()): DatabaseDefinition {
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
    views: [databaseView],
    taskRoles: null,
  };
}

function entry(
  entryId: Uuid,
  title: string,
  status?: Uuid,
): DatabaseQueryEntry & { readonly revisionId: Uuid } {
  return {
    entryId,
    revisionId: asUuid(`018f2000-0000-7001-8000-${entryId.slice(-12)}`),
    title,
    values: status === undefined ? {} : { [ids.status]: { kind: "status", optionId: status } },
    relationTargets: {},
  };
}

function source(
  entries: StructuredProjectionSource["entries"],
  definitionRevisionId: Uuid = ids.revision,
  databaseView = view(),
): StructuredProjectionSource {
  return {
    databaseId: ids.database,
    definitionRevisionId,
    definition: definition(databaseView),
    entries,
  };
}

function query(service: DatabaseQueryService, request: Partial<DatabaseQueryDto> = {}) {
  return service.query(ids.database, { viewId: ids.view, ...request });
}

function mutableDependencies(initial: readonly StructuredProjectionSource[]) {
  let sources = [...initial];
  let failAffected = false;
  let failBuild = false;
  const deps: DatabaseQueryServiceDeps = {
    loadAll: async () => {
      if (failBuild) throw new Error("rebuild unavailable");
      return sources;
    },
    loadAffected: async () => {
      if (failAffected) throw new Error("incremental source unavailable");
      return { sources, removedDatabaseIds: [] };
    },
  };
  return {
    deps,
    replace(next: readonly StructuredProjectionSource[]) {
      sources = [...next];
    },
    fail() {
      failAffected = true;
      failBuild = true;
    },
  };
}

describe("DatabaseQueryService", () => {
  it("publishes one atomic generation with presence/equality indexes", async () => {
    const data = mutableDependencies([
      source([
        entry(ids.entryA, "Alpha", ids.todo),
        entry(ids.entryB, "Beta", ids.done),
        entry(ids.entryC, "Sans statut"),
      ]),
    ]);
    const service = new DatabaseQueryService(data.deps, Buffer.alloc(32, 7));

    await expect(() => query(service)).toThrow(DatabaseProjectionUnavailableError);
    await service.rebuild();

    expect(service.status()).toMatchObject({
      state: "ready",
      generation: 1,
      indexedCount: 3,
      expectedCount: 3,
      presenceIndexCount: 2,
      equalityIndexCount: 5,
    });
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryA]);
    expect(query(service).groups).toEqual([{ id: ids.todo, label: "À faire", count: 1 }]);
  });

  it("keeps the previous generation readable until a complete rebuild is published", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let builds = 0;
    const first = source([entry(ids.entryA, "Avant", ids.todo)]);
    const second = source([entry(ids.entryB, "Après", ids.todo)], ids.nextRevision);
    const service = new DatabaseQueryService(
      {
        loadAll: async () => {
          builds += 1;
          if (builds === 2) await gate;
          return builds === 1 ? [first] : [second];
        },
        loadAffected: async () => ({ sources: [second], removedDatabaseIds: [] }),
      },
      Buffer.alloc(32, 8),
    );
    await service.rebuild();

    const rebuilding = service.rebuild();
    expect(service.status().state).toBe("building");
    expect(query(service).rows[0]?.title).toBe("Avant");
    release?.();
    await rebuilding;

    expect(query(service).rows[0]?.title).toBe("Après");
    expect(service.status().generation).toBe(2);
  });

  it("replays committed changes that arrive during the first projection build", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const obsoleteDatabaseId = asUuid("018f2000-0000-7000-8000-000000000013");
    const before = source([entry(ids.entryA, "Avant", ids.todo)]);
    const after = source([entry(ids.entryB, "Après", ids.todo)], ids.nextRevision);
    const obsolete: StructuredProjectionSource = {
      ...source([entry(ids.entryC, "Obsolète", ids.todo)]),
      databaseId: obsoleteDatabaseId,
      definition: { ...definition(), databaseId: obsoleteDatabaseId },
    };
    const service = new DatabaseQueryService(
      {
        loadAll: async () => {
          await gate;
          return [before, obsolete];
        },
        loadAffected: async () => ({
          sources: [after],
          removedDatabaseIds: [obsoleteDatabaseId],
        }),
      },
      Buffer.alloc(32, 11),
    );

    const rebuilding = service.rebuild();
    await service.applyCommittedChanges([ids.entryA], 12);
    release?.();
    await rebuilding;

    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryB]);
    expect(() => service.query(obsoleteDatabaseId, { viewId: ids.view })).toThrowError(
      DatabaseQueryRequestError,
    );
    expect(service.status()).toMatchObject({ state: "ready", generation: 1, indexedCount: 1 });
  });

  it("applies committed upserts/removals and invalidates old cursors without duplicates", async () => {
    const firstSource = source([
      entry(ids.entryA, "Alpha", ids.todo),
      entry(ids.entryB, "Beta", ids.todo),
      entry(ids.entryC, "Gamma", ids.todo),
    ]);
    const data = mutableDependencies([firstSource]);
    const service = new DatabaseQueryService(data.deps, Buffer.alloc(32, 9));
    await service.rebuild();

    const first = query(service, { limit: 1 });
    expect(first.rows.map(({ entryId }) => entryId)).toEqual([ids.entryA]);
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor;
    if (cursor === null) throw new Error("expected another page");
    const second = query(service, { limit: 1, cursor });
    expect(second.rows.map(({ entryId }) => entryId)).toEqual([ids.entryB]);

    data.replace([
      source(
        [entry(ids.entryB, "Beta", ids.done), entry(ids.entryC, "Gamma", ids.todo)],
        ids.nextRevision,
      ),
    ]);
    await service.applyCommittedChanges([ids.entryA, ids.entryB], 12);

    expect(service.status()).toMatchObject({ state: "ready", generation: 2, indexedCount: 2 });
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryC]);
    expect(() => query(service, { limit: 1, cursor })).toThrowError(DatabaseQueryRequestError);
  });

  it("degrades and refuses stale completeness when an incremental refresh fails", async () => {
    const data = mutableDependencies([source([entry(ids.entryA, "Alpha", ids.todo)])]);
    const service = new DatabaseQueryService(data.deps, Buffer.alloc(32, 10));
    await service.rebuild();
    data.fail();

    await expect(service.applyCommittedChanges([ids.entryA], 2)).rejects.toThrow(
      "incremental source unavailable",
    );
    await expect(() => query(service)).toThrow(DatabaseProjectionUnavailableError);
    expect(service.status()).toMatchObject({ state: "degraded" });
  });
});
