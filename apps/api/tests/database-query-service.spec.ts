import type { DatabaseQueryDto } from "@myownnotion/contracts";
import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseFilterOperand,
  type DatabaseProperty,
  type DatabaseQueryEntry,
  type DatabaseView,
  evaluateDatabaseView,
  type FilterCriterion,
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
  it("never drops a canonical result when the equality operand needs normalization", async () => {
    const model = definition(
      view({
        group: null,
        filter: {
          mode: "all",
          criteria: [
            {
              id: ids.filter,
              propertyId: ids.status,
              operator: "equals",
              operand: { kind: "number", decimal: "+02.00" },
            },
          ],
        },
      }),
    );
    const data: StructuredProjectionSource = {
      ...source([]),
      definition: {
        ...model,
        properties: [
          model.properties[0] as DatabaseProperty,
          {
            id: ids.status,
            name: "Charge",
            type: "number",
            state: "active",
            positionKey: "b",
            config: {},
          },
        ],
      },
      entries: [
        { ...entry(ids.entryA, "Two"), values: { [ids.status]: { kind: "number", decimal: "2" } } },
      ],
    };
    const service = new DatabaseQueryService(mutableDependencies([data]).deps);
    await service.rebuild();
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryA]);
  });

  it("keeps indexed all/any and negative filters equivalent to canonical evaluation across value types", async () => {
    const common = { id: ids.status, name: "Value", state: "active", positionKey: "b" } as const;
    const choices = {
      options: [
        { id: ids.todo, label: "Todo", positionKey: "a", tone: "neutral", state: "active" },
        { id: ids.done, label: "Done", positionKey: "b", tone: "green", state: "active" },
      ],
    } as const;
    const cases: {
      property: DatabaseProperty;
      value: DatabaseFilterOperand;
      operand: DatabaseFilterOperand;
    }[] = [
      {
        property: { ...common, type: "number", config: {} },
        value: { kind: "number", decimal: "2" },
        operand: { kind: "number", decimal: "+02.00" },
      },
      {
        property: { ...common, type: "date", config: { mode: "instant" } },
        value: { kind: "instant", instant: "2026-09-01T00:00:00.000Z" },
        operand: { kind: "instant", instant: "2026-09-01T02:00:00+02:00" },
      },
      {
        property: { ...common, type: "checkbox", config: {} },
        value: { kind: "checkbox", checked: false },
        operand: { kind: "checkbox", checked: false },
      },
      {
        property: { ...common, type: "text", config: {} },
        value: { kind: "text", value: "Alpha" },
        operand: { kind: "text", value: "Alpha" },
      },
      {
        property: { ...common, type: "status", config: choices },
        value: { kind: "status", optionId: ids.todo },
        operand: { kind: "status", optionId: ids.todo },
      },
      {
        property: { ...common, type: "multi-select", config: choices },
        value: { kind: "multi-select", optionIds: [ids.todo, ids.done] },
        operand: { kind: "multi-select", optionIds: [ids.done, ids.todo, ids.todo] },
      },
      {
        property: { ...common, type: "relation", config: { cardinality: "many" } },
        value: { kind: "relation", targetIds: [ids.entryA, ids.entryB] },
        operand: { kind: "relation", targetIds: [ids.entryB, ids.entryA, ids.entryA] },
      },
    ];
    for (const { property, value, operand } of cases) {
      if (value.kind === "date-range" || value.kind === "instant-range")
        throw new Error("Not a stored value");
      const rows = [
        {
          ...entry(ids.entryA, "Alpha"),
          ...(value.kind === "relation"
            ? { relationTargets: { [ids.status]: value.targetIds } }
            : { values: { [ids.status]: value } }),
        },
        entry(ids.entryB, "Beta"),
        entry(ids.entryC, "Gamma"),
      ];
      for (const mode of ["all", "any"] as const) {
        for (const operator of ["equals", "not-equals", "is-empty", "is-not-empty"] as const) {
          const criteria: FilterCriterion[] = [
            { id: ids.filter, propertyId: ids.status, operator, operand },
            {
              id: ids.nextRevision,
              propertyId: ids.title,
              operator: "contains",
              operand: { kind: "text", value: "a" },
            },
          ];
          const databaseView = view({ filter: { mode, criteria }, group: null });
          const model = definition(databaseView);
          const data = {
            ...source(rows),
            definition: {
              ...model,
              properties: [model.properties[0] as DatabaseProperty, property],
            },
          };
          const service = new DatabaseQueryService(mutableDependencies([data]).deps);
          await service.rebuild();
          const canonical = evaluateDatabaseView(data.definition, ids.view, rows);
          if (!canonical.ok) throw new Error(JSON.stringify(canonical.error));
          expect(
            query(service).rows.map(({ entryId }) => entryId),
            `${property.type}/${mode}/${operator}`,
          ).toEqual(canonical.value.rows.map(({ entryId }) => entryId));
        }
      }
      if (property.type === "checkbox" || property.type === "status") {
        const model = definition(view({ filter: { mode: "all", criteria: [] } }));
        const data = {
          ...source(rows),
          definition: { ...model, properties: [model.properties[0] as DatabaseProperty, property] },
        };
        const service = new DatabaseQueryService(mutableDependencies([data]).deps);
        await service.rebuild();
        expect(query(service).groups).toEqual([
          {
            id: property.type === "checkbox" ? "unchecked" : ids.todo,
            label: property.type === "checkbox" ? "Non coché" : "Todo",
            count: 1,
          },
          { id: "missing", label: "Sans valeur", count: 2 },
        ]);
      }
    }
  });

  it("keeps indexes coherent through removals, missing values, unreported additions and source deletion", async () => {
    let current = source([entry(ids.entryA, "Alpha", ids.todo), entry(ids.entryB, "Beta")]);
    let removed = false;
    const service = new DatabaseQueryService({
      loadAll: async () => [current],
      loadAffected: async () => ({
        sources: removed ? [] : [current],
        removedDatabaseIds: removed ? [ids.database] : [],
      }),
    });
    await service.rebuild();
    await service.applyCommittedChanges([], 1);
    await service.applyCommittedChanges([ids.nextRevision], 2);
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryA]);
    current = source([entry(ids.entryB, "Beta")]);
    await service.applyCommittedChanges([ids.entryA], 3);
    expect(query(service).rows).toEqual([]);
    current = source([
      entry(ids.entryA, "Alpha", ids.todo),
      entry(ids.entryB, "Beta", ids.todo),
      entry(ids.entryC, "Gamma", ids.todo),
    ]);
    // A broader refresh must rebuild the index instead of silently missing C.
    await service.applyCommittedChanges([ids.entryA], 4);
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([
      ids.entryA,
      ids.entryB,
      ids.entryC,
    ]);
    current = source([entry(ids.entryA, "Alpha", ids.done), entry(ids.entryB, "Beta", ids.done)]);
    await service.applyCommittedChanges([ids.entryA, ids.entryB, ids.entryC], 5);
    expect(query(service).rows).toEqual([]);
    removed = true;
    await service.applyCommittedChanges([ids.database], 6);
    expect(() => query(service)).toThrowError(
      expect.objectContaining({ code: "database.not-found" }),
    );
    expect(service.status().indexedCount).toBe(0);
    removed = false;
    current = source([entry(ids.entryC, "Gamma", ids.todo)]);
    await service.applyCommittedChanges([ids.database], 7);
    expect(query(service).rows.map(({ entryId }) => entryId)).toEqual([ids.entryC]);
  });

  it("rejects malformed, noncanonical, tampered and foreign cursors without returning partial results", async () => {
    const data = mutableDependencies([
      source([entry(ids.entryA, "Alpha", ids.todo), entry(ids.entryB, "Beta", ids.todo)]),
    ]);
    const service = new DatabaseQueryService(data.deps);
    await service.rebuild();
    const cursor = query(service, { limit: 1 }).nextCursor;
    if (cursor === null) throw new Error("Expected next page");
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<
      string,
      unknown
    >;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const invalid = [
      `${cursor}=`,
      "A",
      encode(null),
      encode([]),
      encode({}),
      ...Object.keys(payload).map((field) => encode({ ...payload, [field]: null })),
      encode({ ...payload, offset: 0 }),
      encode({ ...payload, offset: 1.5 }),
      encode({ ...payload, signature: "x" }),
      encode({ ...payload, signature: "a".repeat(43) }),
      encode({ ...payload, offset: 2 }),
    ];
    for (const value of invalid)
      expect(() => query(service, { cursor: value })).toThrowError(
        expect.objectContaining({ code: "database.invalid-cursor" }),
      );
    const other = new DatabaseQueryService(data.deps);
    await other.rebuild();
    expect(() => query(other, { cursor })).toThrowError(
      expect.objectContaining({ code: "database.invalid-cursor" }),
    );
    expect(() => query(service, { viewId: ids.nextRevision })).toThrowError(
      expect.objectContaining({ code: "database.invalid-view" }),
    );
    expect(query(service, { cursor }).rows.map(({ entryId }) => entryId)).toEqual([ids.entryB]);
  });
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

  it("refreshes changed entry buckets without rebuilding an unchanged definition", async () => {
    let rejectUnchangedIndexReads = false;
    const unchanged = entry(ids.entryB, "Beta", ids.done);
    const guardedUnchanged = Object.defineProperty({ ...unchanged }, "title", {
      enumerable: true,
      get: () => {
        if (rejectUnchangedIndexReads) throw new Error("unchanged entry was re-indexed");
        return unchanged.title;
      },
    }) as StructuredProjectionSource["entries"][number];
    const data = mutableDependencies([
      source([entry(ids.entryA, "Alpha", ids.todo), guardedUnchanged]),
    ]);
    const service = new DatabaseQueryService(data.deps, Buffer.alloc(32, 12));
    await service.rebuild();

    data.replace([source([entry(ids.entryA, "Alpha done", ids.done), guardedUnchanged])]);
    rejectUnchangedIndexReads = true;
    await service.applyCommittedChanges([ids.entryA], 2);

    expect(query(service).rows).toEqual([]);
    expect(service.status()).toMatchObject({ state: "ready", generation: 2, indexedCount: 2 });
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
