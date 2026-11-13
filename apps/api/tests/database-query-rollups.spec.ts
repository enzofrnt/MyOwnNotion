import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabaseView,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  DatabaseQueryService,
  type StructuredProjectionSource,
} from "../src/databases/database-query-service.ts";

const id = (suffix: number): Uuid =>
  asUuid(`018f7000-0000-7000-8000-${String(suffix).padStart(12, "0")}`);
const ids = {
  projects: id(1),
  purchases: id(2),
  view: id(3),
  purchasesView: id(4),
  title: id(10),
  relation: id(11),
  total: id(12),
  double: id(13),
  average: id(14),
  purchaseTitle: id(20),
  amount: id(21),
};

function property(
  propertyId: Uuid,
  name: string,
  type: DatabaseProperty["type"],
  config: unknown = {},
): DatabaseProperty {
  return {
    id: propertyId,
    name,
    type,
    positionKey: propertyId.slice(-4),
    state: "active",
    config,
  } as DatabaseProperty;
}

function view(viewId: Uuid, overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: viewId,
    name: "Table",
    type: "table",
    positionKey: "a",
    state: "active",
    properties: [],
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: null,
    options: { density: "comfortable", freezeTitle: true },
    ...overrides,
  } as DatabaseView;
}

function projects(databaseView: DatabaseView, count: number): StructuredProjectionSource {
  const definition: DatabaseDefinition = {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: ids.projects,
    properties: [
      property(ids.title, "Nom", "title"),
      property(ids.relation, "Achats", "relation", {
        cardinality: "many",
        targetSourceId: ids.purchases,
      }),
      property(ids.total, "Total", "rollup", {
        relationPropertyId: ids.relation,
        targetPropertyId: ids.amount,
        aggregate: "sum",
      }),
      property(ids.average, "Moyenne", "rollup", {
        relationPropertyId: ids.relation,
        targetPropertyId: ids.amount,
        aggregate: "average",
      }),
      property(ids.double, "Double", "formula", { expression: 'prop("Total") * 2' }),
    ],
    views: [databaseView],
    taskRoles: null,
  };
  return {
    databaseId: ids.projects,
    definitionRevisionId: id(5),
    definition,
    // Project i links purchases 1..i, so its total grows with i while every
    // project past the first has more than one relation.
    entries: Array.from({ length: count }, (_, index) => ({
      entryId: id(1000 + index),
      revisionId: id(5000 + index),
      title: `Projet ${String(index).padStart(3, "0")}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, count - index)).toISOString(),
      values: {},
      relationTargets: {
        [ids.relation]: Array.from({ length: index }, (_, target) => id(2000 + target)),
      },
    })),
  };
}

function purchases(count: number): StructuredProjectionSource {
  return {
    databaseId: ids.purchases,
    definitionRevisionId: id(6),
    definition: {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId: ids.purchases,
      properties: [
        property(ids.purchaseTitle, "Achat", "title"),
        property(ids.amount, "Montant", "number"),
      ],
      views: [view(ids.purchasesView)],
      taskRoles: null,
    },
    entries: Array.from({ length: count }, (_, index) => ({
      entryId: id(2000 + index),
      revisionId: id(6000 + index),
      title: `Achat ${index}`,
      values: { [ids.amount]: { kind: "number" as const, decimal: "10" } },
      relationTargets: {},
    })),
  };
}

async function service(databaseView: DatabaseView, count = 150): Promise<DatabaseQueryService> {
  const sources = [projects(databaseView, count), purchases(count)];
  const created = new DatabaseQueryService({
    loadAll: async () => sources,
    loadAffected: async () => ({ sources, removedDatabaseIds: [] }),
  });
  await created.rebuild();
  return created;
}

describe("rollups and formulas in the server projection", () => {
  it("keeps the configured canonical schema of an empty secondary source", async () => {
    const host = id(800);
    const targetSourceId = id(801);
    const origin = projects(view(ids.view), 1);
    const configured: StructuredProjectionSource = {
      ...origin,
      definition: {
        ...origin.definition,
        properties: origin.definition.properties.map((p) =>
          p.type === "relation" ? { ...p, config: { ...p.config, targetSourceId } } : p,
        ),
      },
    };
    const primary = { ...purchases(1), databaseId: host, sourceId: id(802) };
    const secondary: StructuredProjectionSource = {
      ...purchases(0),
      databaseId: host,
      sourceId: targetSourceId,
      definition: {
        ...purchases(0).definition,
        properties: [property(id(803), "Secondaire", "number")],
        views: [view(id(804))],
      },
    };
    const sources = [configured, primary, secondary];
    const created = new DatabaseQueryService({
      loadAll: async () => sources,
      loadAffected: async () => ({ sources, removedDatabaseIds: [] }),
    });
    await created.rebuild();
    const page = created.query(ids.projects, { viewId: ids.view });
    expect(page.rollupRelations).toEqual({ [ids.relation]: [targetSourceId] });
    expect(page.rollupProperties).toContainEqual({
      id: id(803),
      name: "Secondaire",
      type: "number",
      sourceId: targetSourceId,
    });
    expect(created.query(host, { viewId: id(804) }).rows).toEqual([]);
    expect(created.query(host, { viewId: ids.purchasesView }).rows).toHaveLength(1);
  });

  it("isolates two source schemas, rows and indexes on one host across updates", async () => {
    const host = id(810);
    const primary = { ...purchases(2), databaseId: host, sourceId: id(811) };
    const other: StructuredProjectionSource = {
      ...projects(view(ids.view), 1),
      databaseId: host,
      sourceId: id(812),
    };
    let sources = [primary, other];
    const created = new DatabaseQueryService({
      loadAll: async () => sources,
      loadAffected: async () => ({ sources, removedDatabaseIds: [] }),
    });
    await created.rebuild();
    expect(created.query(host, { viewId: ids.purchasesView }).rows.map((r) => r.title)).toEqual([
      "Achat 0",
      "Achat 1",
    ]);
    expect(created.query(host, { viewId: ids.view }).rows.map((r) => r.title)).toEqual([
      "Projet 000",
    ]);
    sources = [{ ...primary, entries: [] }, other];
    await created.applyCommittedChanges([host], 1);
    expect(created.query(host, { viewId: ids.purchasesView }).rows).toEqual([]);
    expect(created.query(host, { viewId: ids.view }).rows).toHaveLength(1);
    expect(created.status().indexedCount).toBe(1);
  });

  it("retains target values when one entry belongs to two sources", async () => {
    const target = purchases(1);
    const sibling: StructuredProjectionSource = {
      ...target,
      sourceId: id(820),
      definition: {
        ...target.definition,
        properties: [property(id(821), "Autre montant", "number")],
        views: [view(id(822))],
      },
      entries: target.entries.map((entry) => ({
        ...entry,
        values: { [id(821)]: { kind: "number" as const, decimal: "999" } },
      })),
    };
    const sources = [projects(view(ids.view), 2), target, sibling];
    const created = new DatabaseQueryService({
      loadAll: async () => sources,
      loadAffected: async () => ({ sources: [], removedDatabaseIds: [] }),
    });
    await created.rebuild();
    const page = created.query(ids.projects, { viewId: ids.view });
    expect(page.rows.find((row) => row.title === "Projet 001")?.rollupValues?.[ids.total]).toBe(10);
  });

  it("does not infer a target from legacy links", async () => {
    const origin = projects(view(ids.view), 3);
    const sources = [
      {
        ...origin,
        definition: {
          ...origin.definition,
          properties: origin.definition.properties.map((p) =>
            p.type === "relation" ? { ...p, config: { cardinality: "many" as const } } : p,
          ),
        },
      },
      purchases(3),
    ];
    const created = new DatabaseQueryService({
      loadAll: async () => sources,
      loadAffected: async () => ({ sources: [], removedDatabaseIds: [] }),
    });
    await created.rebuild();
    expect(created.query(ids.projects, { viewId: ids.view }).rollupRelations).toEqual({
      [ids.relation]: [],
    });
  });
  it("sorts on the computed rollup before the page is cut", async () => {
    const sorted = view(ids.view, {
      sorts: [{ propertyId: ids.total, direction: "descending", missing: "last" }],
    });
    const page = (await service(sorted)).query(ids.projects, { viewId: ids.view, limit: 3 });
    // Creation order would have returned the last projects created first.
    expect(page.rows.map((row) => row.title)).toEqual(["Projet 149", "Projet 148", "Projet 147"]);
    expect(page.rows[0]?.rollupValues?.[ids.total]).toBe(1490);
    expect(page.nextCursor).not.toBeNull();
  });

  it("filters on a rollup and on a formula over the whole source", async () => {
    const filtered = view(ids.view, {
      filter: {
        mode: "all",
        criteria: [
          {
            id: id(30),
            propertyId: ids.total,
            operator: "greater-than",
            operand: { kind: "number", decimal: "1470" },
          },
          {
            id: id(31),
            propertyId: ids.double,
            operator: "less-than",
            operand: { kind: "number", decimal: "2980" },
          },
        ],
      },
    });
    const page = (await service(filtered)).query(ids.projects, { viewId: ids.view, limit: 100 });
    expect(page.rows.map((row) => row.title)).toEqual(["Projet 148"]);
    expect(page.nextCursor).toBeNull();
  });

  it("sends an empty average as empty and names the sources a relation reaches", async () => {
    const page = (await service(view(ids.view), 3)).query(ids.projects, { viewId: ids.view });
    const empty = page.rows.find((row) => row.title === "Projet 000");
    expect(empty?.rollupValues).toEqual({ [ids.total]: 0, [ids.average]: null });
    const linked = page.rows.find((row) => row.title === "Projet 002");
    expect(linked?.rollupValues).toEqual({ [ids.total]: 20, [ids.average]: 10 });
    expect(page.rollupRelations).toEqual({ [ids.relation]: [ids.purchases] });
    expect(page.rollupProperties).toContainEqual({
      id: ids.amount,
      name: "Montant",
      type: "number",
      sourceId: ids.purchases,
    });
  });

  it("filters empty computed values without consulting stored-value indexes", async () => {
    const filtered = view(ids.view, {
      filter: {
        mode: "all",
        criteria: [{ id: id(32), propertyId: ids.average, operator: "is-empty" }],
      },
    });
    const page = (await service(filtered, 4)).query(ids.projects, { viewId: ids.view });
    expect(page.rows.map((row) => row.title)).toEqual(["Projet 000"]);
  });
});
