import { describe, expect, it } from "vitest";
import {
  type DatabaseProperty,
  rollupValueOf,
  type Uuid,
  validateDatabaseDefinition,
} from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

function candidate(targetSourceId: unknown) {
  const original = definition();
  return {
    ...original,
    properties: original.properties.map((property) =>
      property.type === "relation"
        ? { ...property, config: { ...property.config, targetSourceId } }
        : property,
    ),
  };
}

describe("relation target source", () => {
  it("refuses a rollup target property or retained link outside the configured source", () => {
    const relation = definition().properties.find((property) => property.type === "relation");
    const target = definition().properties.find((property) => property.type === "number");
    if (relation?.type !== "relation" || target === undefined) throw new Error("fixture");
    const rollup: Extract<DatabaseProperty, { type: "rollup" }> = {
      id: IDS.filter,
      name: "Total",
      type: "rollup",
      positionKey: "a",
      state: "active",
      config: { relationPropertyId: relation.id, targetPropertyId: target.id, aggregate: "sum" },
    };
    const configured = {
      ...relation,
      config: { ...relation.config, targetSourceId: IDS.database },
    };
    const entry = { title: "Projet", values: {}, relationTargets: { [relation.id]: [IDS.entryA] } };
    const context = {
      entries: new Map([
        [
          IDS.entryA,
          {
            title: "Achat",
            values: { [target.id]: { kind: "number" as const, decimal: "10" } },
            relationTargets: {},
          },
        ],
      ]),
      propertiesById: new Map<Uuid, DatabaseProperty>([
        [relation.id, configured],
        [target.id, target],
      ]),
      propertySources: new Map([[target.id, IDS.database]]),
      entrySources: new Map([[IDS.entryA, new Set([IDS.database])]]),
      sourceIds: new Set([IDS.database]),
    };
    expect(rollupValueOf(rollup, entry, context)).toBe(10);
    expect(
      rollupValueOf(rollup, entry, {
        ...context,
        propertySources: new Map([[target.id, IDS.entryB]]),
      }),
    ).toBeUndefined();
    expect(
      rollupValueOf(rollup, entry, {
        ...context,
        entrySources: new Map([[IDS.entryA, new Set([IDS.entryB])]]),
      }),
    ).toBeUndefined();
    expect(rollupValueOf(rollup, entry, { ...context, sourceIds: new Set() })).toBeUndefined();
    // A membership-specific map wins over the generic entry with another source's values.
    expect(
      rollupValueOf(rollup, entry, {
        ...context,
        entriesBySource: new Map([
          [
            IDS.database,
            new Map([
              [
                IDS.entryA,
                {
                  title: "Achat",
                  values: { [target.id]: { kind: "number" as const, decimal: "20" } },
                  relationTargets: {},
                },
              ],
            ]),
          ],
        ]),
      }),
    ).toBe(20);
    const count = { ...rollup, config: { ...rollup.config, aggregate: "count" as const } };
    expect(rollupValueOf(count, entry, context)).toBe(1);
    expect(rollupValueOf(count, entry, { ...context, sourceIds: new Set() })).toBeUndefined();
    expect(
      rollupValueOf(count, entry, { ...context, entries: new Map(), missing: "unavailable" }),
    ).toBeUndefined();
    expect(rollupValueOf(count, entry, { ...context, entries: new Map(), missing: "skip" })).toBe(
      0,
    );
    expect(
      rollupValueOf(count, entry, {
        ...context,
        entries: new Map(),
        missing: "unavailable",
        inactiveEntryIds: new Set([IDS.entryA]),
      }),
    ).toBe(0);
  });
  it("preserves the explicit source identity through a definition round trip", () => {
    const input = candidate(IDS.database);
    const parsed = validateDatabaseDefinition(JSON.parse(JSON.stringify(input)));
    expect(parsed).toMatchObject({ ok: true, value: input });
  });

  it("continues to read unconfigured historical relations without choosing a source", () => {
    const parsed = validateDatabaseDefinition(definition());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(
        parsed.value.properties.find((property) => property.type === "relation")?.config,
      ).not.toHaveProperty("targetSourceId");
    }
  });

  it.each([null, "not-a-source", 42, ""])("rejects a malformed configured source: %s", (value) => {
    expect(validateDatabaseDefinition(candidate(value) as never).ok).toBe(false);
  });
});
