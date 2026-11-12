import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { inverseRelationPatch } from "../src/features/databases/inverse-relation-edit.ts";

const id = (suffix: string): Uuid => `01a1a75e-1cae-7000-8000-0000000000${suffix}` as Uuid;

function relation(overrides: Partial<Extract<DatabaseProperty, { type: "relation" }>["config"]>) {
  return {
    id: id("01"),
    name: "Projets liés",
    type: "relation",
    positionKey: "a",
    state: "active",
    config: {
      cardinality: "many",
      targetSourceId: id("02"),
      reciprocalPropertyId: id("03"),
      inverseEdges: true,
      ...overrides,
    },
  } as Extract<DatabaseProperty, { type: "relation" }>;
}

describe("inverse relation edit", () => {
  it("writes the partner property with the current entry as target", () => {
    expect(inverseRelationPatch(relation({}), id("10"), id("11"), true, id("12"))).toEqual({
      databaseId: id("02"),
      entryId: id("11"),
      propertyId: id("03"),
      targetItemId: id("10"),
      present: true,
      baseRevisionId: id("12"),
    });
  });

  it("stays inert without a partner, a current entry or a revision", () => {
    expect(inverseRelationPatch(relation({}), undefined, id("11"), true, id("12"))).toBeNull();
    expect(inverseRelationPatch(relation({}), id("10"), id("11"), true, undefined)).toBeNull();
    expect(
      inverseRelationPatch(
        relation({ reciprocalPropertyId: undefined }),
        id("10"),
        id("11"),
        true,
        id("12"),
      ),
    ).toBeNull();
    const canonical = {
      ...relation({}),
      config: { ...relation({}).config, inverseEdges: undefined },
    };
    expect(inverseRelationPatch(canonical as never, id("10"), id("11"), true, id("12"))).toBeNull();
  });
});
