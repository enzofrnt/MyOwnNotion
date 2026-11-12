import { DatabaseDefinitionSchema, DatabasePropertySchema } from "@myownnotion/contracts";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { definition, IDS } from "../../domain/tests/databases/fixtures.ts";

FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/i.test(value));

describe("relation source wire contract", () => {
  it("reads historical relations and round-trips an explicit canonical source", () => {
    const legacy = definition();
    expect(Value.Check(DatabaseDefinitionSchema, legacy)).toBe(true);
    const current = {
      ...legacy,
      properties: legacy.properties.map((property) =>
        property.type === "relation"
          ? { ...property, config: { ...property.config, targetSourceId: IDS.database } }
          : property,
      ),
    };
    const wire = JSON.parse(JSON.stringify(current));
    expect(Value.Check(DatabaseDefinitionSchema, wire)).toBe(true);
    expect(wire).toEqual(current);
  });

  it("round-trips the reciprocal property and rejects a malformed one", () => {
    const legacy = definition();
    const relation = legacy.properties.find((candidate) => candidate.type === "relation");
    if (relation?.type !== "relation") throw new Error("Missing fixture relation");
    const paired = {
      ...relation,
      config: {
        cardinality: "many",
        targetSourceId: IDS.database,
        reciprocalPropertyId: IDS.relationB,
      },
    };
    expect(Value.Check(DatabasePropertySchema, JSON.parse(JSON.stringify(paired)))).toBe(true);
    for (const reciprocalPropertyId of [null, "wrong", "", 42, {}])
      expect(
        Value.Check(DatabasePropertySchema, {
          ...paired,
          config: { ...paired.config, reciprocalPropertyId },
        }),
      ).toBe(false);
  });

  it.each([null, "wrong", "", 42, {}, []])(
    "rejects a malformed source at the HTTP boundary: %j",
    (targetSourceId) => {
      const property = definition().properties.find((candidate) => candidate.type === "relation");
      if (property?.type !== "relation") throw new Error("Missing fixture relation");
      expect(
        Value.Check(DatabasePropertySchema, {
          ...property,
          config: { ...property.config, targetSourceId },
        }),
      ).toBe(false);
    },
  );
});
