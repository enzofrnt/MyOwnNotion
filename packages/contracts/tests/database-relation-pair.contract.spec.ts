import { DatabaseDefinitionSchema, DatabasePropertySchema } from "@myownnotion/contracts";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { definition, IDS } from "../../domain/tests/databases/fixtures.ts";

FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/i.test(value));

function fixtureRelation(): Extract<
  ReturnType<typeof definition>["properties"][number],
  { type: "relation" }
> {
  const property = definition().properties.find((candidate) => candidate.type === "relation");
  if (property?.type !== "relation") throw new Error("Missing fixture relation");
  return property;
}

function reciprocal(id: string, reciprocalPropertyId: unknown): Record<string, unknown> {
  return {
    ...fixtureRelation(),
    id,
    config: {
      cardinality: "many",
      targetSourceId: IDS.database,
      reciprocalPropertyId,
    },
  };
}

describe("two-way relation pair wire contract", () => {
  it("round-trips both sides of a mutual pair through JSON", () => {
    const base = definition();
    const properties = base.properties.filter((property) => property.type !== "relation");
    const pairA = reciprocal(IDS.relation, IDS.relationB);
    const pairB = reciprocal(IDS.relationB, IDS.relation);
    const input = { ...base, properties: [...properties, pairA, pairB] };
    const wire = JSON.parse(JSON.stringify(input));
    expect(Value.Check(DatabaseDefinitionSchema, wire)).toBe(true);
    expect(wire).toEqual(input);
  });

  it("keeps the legacy relation without a reciprocal field", () => {
    const relation = fixtureRelation();
    expect(relation.config).not.toHaveProperty("reciprocalPropertyId");
    expect(Value.Check(DatabasePropertySchema, relation)).toBe(true);
    expect(Value.Check(DatabaseDefinitionSchema, definition())).toBe(true);
  });

  it.each([null, "not-a-uuid", "", 42, {}, [], "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"])(
    "rejects a malformed reciprocal at the HTTP boundary: %j",
    (reciprocalPropertyId) => {
      expect(
        Value.Check(DatabasePropertySchema, reciprocal(IDS.relation, reciprocalPropertyId)),
      ).toBe(false);
    },
  );

  it("keeps the relation config strict about unknown fields", () => {
    const property = {
      ...reciprocal(IDS.relation, IDS.relationB),
      config: {
        cardinality: "many",
        targetSourceId: IDS.database,
        reciprocalPropertyId: IDS.relationB,
        unexpected: true,
      },
    };
    expect(Value.Check(DatabasePropertySchema, property)).toBe(false);
  });
});
