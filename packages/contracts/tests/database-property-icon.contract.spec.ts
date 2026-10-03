import { DatabaseDefinitionSchema, DatabasePropertySchema } from "@myownnotion/contracts";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { baseProperties, definition } from "../../domain/tests/databases/fixtures.ts";

FormatRegistry.Set("uuid", (value) => /^[0-9a-f-]{36}$/i.test(value));

describe("source property icon contract", () => {
  it("accepts every property family with an optional icon or explicit removal", () => {
    for (const property of baseProperties()) {
      expect(Value.Check(DatabasePropertySchema, property)).toBe(true);
      expect(Value.Check(DatabasePropertySchema, { ...property, icon: "lightbulb" })).toBe(true);
      expect(Value.Check(DatabasePropertySchema, { ...property, icon: null })).toBe(true);
      expect(Value.Check(DatabasePropertySchema, { ...property, icon: "future-symbol" })).toBe(
        true,
      );
    }
  });
  it("rejects malformed, unbounded and non-string icons at the HTTP boundary", () => {
    const property = baseProperties()[0];
    for (const icon of ["", "A", "<svg>", "a".repeat(41), 42, {}])
      expect(Value.Check(DatabasePropertySchema, { ...property, icon })).toBe(false);
  });
  it("keeps icon metadata in the complete definition request and response", () => {
    const source = definition();
    const candidate = {
      ...source,
      properties: source.properties.map((p) => ({ ...p, icon: "star" })),
    };
    const json = JSON.parse(JSON.stringify(candidate));
    expect(Value.Check(DatabaseDefinitionSchema, json)).toBe(true);
    expect(json).toEqual(candidate);
  });
});
