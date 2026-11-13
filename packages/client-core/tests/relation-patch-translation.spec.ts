import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { patchAsEntryValues } from "../src/outbox/apply-to-projection.ts";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}` as Uuid;
const entryId = id(1);
const databaseId = id(2);
const propertyId = id(3);
const keptProperty = id(4);
const added = id(5);
const removed = id(6);
const foreignSource = id(7);

function store(rows: readonly Record<string, unknown>[]) {
  return {
    databases: { get: async () => undefined },
    relationships: { where: () => ({ equals: () => ({ toArray: async () => rows }) }) },
    databaseEntryPairs: {
      get: async () => ({
        availability: "present",
        values: { values: { [keptProperty]: { kind: "text", value: "kept" } } },
        sealedValues: {},
      }),
    },
  };
}

const codec = {
  openDatabaseEntry: async (row: { values: Record<string, unknown> }) => ({
    values: row.values,
  }),
} as never;

const rows = [
  {
    relationType: "database:property",
    sourceItemId: entryId,
    targetItemId: removed,
    metadata: { databaseId, propertyId },
  },
  {
    relationType: "database:property",
    sourceItemId: entryId,
    targetItemId: id(8),
    metadata: { databaseId, propertyId: keptProperty },
  },
  {
    // Another property's edge on the same entry: untouched by this patch.
    relationType: "database:property",
    sourceItemId: entryId,
    targetItemId: id(9),
    metadata: { databaseId: foreignSource, propertyId: id(11) },
  },
];

describe("relation patch translation", () => {
  it("adds one target while leaving other properties and foreign sources alone", async () => {
    const command = {
      type: "database.entry.relation.patch",
      databaseId,
      entryId,
      propertyId,
      targetItemId: added,
      present: true,
      baseRevisionId: id(10),
    } as const;
    const normalized = await patchAsEntryValues(store(rows) as never, command, codec);
    expect(normalized?.relationTargets).toEqual({
      [propertyId]: [removed, added],
      [keptProperty]: [id(8)],
      // Another property's targets are carried through untouched.
      [id(11)]: [id(9)],
    });
    expect(normalized?.values).toEqual({ [keptProperty]: { kind: "text", value: "kept" } });
    expect(normalized?.baseRevisionId).toBe(id(10));
  });

  it("removes one target and treats a replay as a no-op", async () => {
    const base = {
      type: "database.entry.relation.patch" as const,
      databaseId,
      entryId,
      propertyId,
      baseRevisionId: id(10),
    };
    const remove = await patchAsEntryValues(
      store(rows) as never,
      { ...base, targetItemId: removed, present: false },
      codec,
    );
    expect(remove?.relationTargets).toEqual({
      [propertyId]: [],
      [keptProperty]: [id(8)],
      [id(11)]: [id(9)],
    });
    const replay = await patchAsEntryValues(
      store(rows) as never,
      { ...base, targetItemId: removed, present: true },
      codec,
    );
    expect(replay).toBeNull();
  });
});
