import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  loadLocalRollupContext,
  withRollupMetadata,
} from "../src/features/databases/local-rollup.ts";
import type { LocalContentService } from "../src/services/local-content.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;
const owner = id(1);
const first = id(2);
const second = id(3);
const number = (n: number): DatabaseProperty => ({
  id: id(n),
  name: `Nombre ${n}`,
  type: "number",
  config: {},
  positionKey: "a",
  state: "active",
});

describe("canonical rollup sources", () => {
  it("keeps separate schemas for two empty sources belonging to the same container", async () => {
    const rows = [
      { itemId: owner, sourceId: first, definition: { properties: [number(10)] } },
      { itemId: owner, sourceId: second, definition: { properties: [number(11)] } },
    ];
    const service = {
      listDatabases: async () => rows,
      getItems: async () => [{ id: owner, lifecycle: "active" }],
      getDatabase: async (key: Uuid) => rows.find((row) => row.sourceId === key) ?? rows[0],
      listDatabaseEntries: async () => [],
    } as unknown as LocalContentService;
    const context = await loadLocalRollupContext(service);
    expect(context.options.map(({ id: propertyId, sourceId }) => [propertyId, sourceId])).toEqual([
      [id(10), first],
      [id(11), second],
    ]);
  });

  it("does not expose schemas from a trashed or locally unavailable source owner", async () => {
    const source = { itemId: owner, sourceId: first, definition: { properties: [number(10)] } };
    for (const lifecycle of ["trashed", "purged", undefined]) {
      const service = {
        listDatabases: async () => [source],
        getItems: async () => (lifecycle === undefined ? [] : [{ id: owner, lifecycle }]),
        getDatabase: async () => source,
        listDatabaseEntries: async () => {
          throw new Error("must not read unavailable source");
        },
      } as unknown as LocalContentService;
      const context = await loadLocalRollupContext(service);
      expect(context.options).toEqual([]);
      expect(context.sourceIds?.has(first)).toBe(false);
    }
  });

  it("retains the configured source schema but not invented values for an offloaded entry", async () => {
    const source = { itemId: owner, sourceId: second, definition: { properties: [number(11)] } };
    const entryId = id(99);
    const service = {
      listDatabases: async () => [source],
      getItems: async (ids: readonly Uuid[]) =>
        ids.includes(owner)
          ? [{ id: owner, lifecycle: "active" }]
          : [{ id: entryId, name: "Achat", lifecycle: "active" }],
      getDatabase: async () => source,
      listDatabaseEntries: async () => [
        { entryItemId: entryId, sourceId: second, availability: "offloaded" },
      ],
      getDatabaseEntryRelations: async () => new Map(),
    } as unknown as LocalContentService;
    const context = await loadLocalRollupContext(service);
    expect(context.options).toHaveLength(1);
    expect(context.sourceIds?.has(second)).toBe(true);
    expect(context.entriesBySource?.get(second)?.has(entryId)).toBe(false);
    expect(context.entrySources?.get(entryId)?.has(second)).toBe(true);
  });

  it("uses the configured source even when the relation has no links", () => {
    const relation: DatabaseProperty = {
      id: id(20),
      name: "Achats",
      type: "relation",
      state: "active",
      positionKey: "b",
      config: { cardinality: "many", targetSourceId: second },
    };
    const result = withRollupMetadata(
      {} as never,
      { properties: [relation], entries: [] },
      {
        options: [],
        entries: new Map(),
        propertiesById: new Map(),
        entrySource: new Map(),
      },
    );
    expect(result.rollupRelations).toEqual({ [relation.id]: [second] });
  });
});
