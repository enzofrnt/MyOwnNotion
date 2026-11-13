import { describe, expect, it } from "vitest";
import {
  computeRollupValue,
  createDerivedValues,
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabaseQueryEntry,
  type DatabaseView,
  evaluateDatabaseView,
  type RollupEntry,
  rollupConfigIssue,
  rollupFunctionsForType,
  type Uuid,
} from "../../src/index.ts";

const relationId = "018f6000-0000-7000-8000-000000000301" as Uuid;
const targetId = "018f6000-0000-7000-8000-000000000302" as Uuid;
const rollupId = "018f6000-0000-7000-8000-000000000303" as Uuid;

const target: DatabaseProperty = {
  id: targetId,
  name: "Montant",
  type: "number",
  positionKey: "b",
  state: "active",
  config: {},
};

function entry(id: string, decimal: string, extras: Partial<RollupEntry> = {}): RollupEntry {
  return {
    title: id,
    values: { [targetId]: { kind: "number", decimal } },
    relationTargets: {},
    ...extras,
  };
}

const entries = new Map<Uuid, RollupEntry>([
  ["018f6000-0000-7000-8000-000000000311" as Uuid, entry("A", "10")],
  ["018f6000-0000-7000-8000-000000000312" as Uuid, entry("B", "20")],
]);

function rollup(aggregate: Extract<DatabaseProperty, { type: "rollup" }>["config"]["aggregate"]) {
  return {
    id: rollupId,
    name: "Total",
    type: "rollup" as const,
    positionKey: "c",
    state: "active" as const,
    config: { relationPropertyId: relationId, targetPropertyId: targetId, aggregate },
  };
}

const source: RollupEntry = {
  title: "Source",
  values: {},
  relationTargets: {
    [relationId]: [
      "018f6000-0000-7000-8000-000000000311" as Uuid,
      "018f6000-0000-7000-8000-000000000312" as Uuid,
    ],
  },
};

describe("rollup computation", () => {
  it("counts and aggregates numbers", () => {
    expect(computeRollupValue(rollup("count"), source, target, entries)).toBe(2);
    expect(computeRollupValue(rollup("sum"), source, target, entries)).toBe(30);
    expect(computeRollupValue(rollup("average"), source, target, entries)).toBe(15);
    expect(computeRollupValue(rollup("min"), source, target, entries)).toBe(10);
    expect(computeRollupValue(rollup("max"), source, target, entries)).toBe(20);
    expect(computeRollupValue(rollup("show_original"), source, target, entries)).toEqual([10, 20]);
  });

  it("handles empty relations", () => {
    const empty = { ...source, relationTargets: {} };
    expect(computeRollupValue(rollup("count"), empty, target, entries)).toBe(0);
    expect(computeRollupValue(rollup("sum"), empty, target, entries)).toBe(0);
    expect(computeRollupValue(rollup("average"), empty, target, entries)).toBeNull();
  });

  it("deduplicates unique text values", () => {
    const text: DatabaseProperty = {
      id: "018f6000-0000-7000-8000-000000000304" as Uuid,
      name: "Texte",
      type: "text",
      positionKey: "d",
      state: "active",
      config: {},
    };
    const uniqueEntries = new Map<Uuid, RollupEntry>([
      [
        "018f6000-0000-7000-8000-000000000321" as Uuid,
        { title: "A", values: { [text.id]: { kind: "text", value: "x" } }, relationTargets: {} },
      ],
      [
        "018f6000-0000-7000-8000-000000000322" as Uuid,
        { title: "B", values: { [text.id]: { kind: "text", value: "x" } }, relationTargets: {} },
      ],
    ]);
    const uniqueSource = {
      ...source,
      relationTargets: {
        [relationId]: [
          "018f6000-0000-7000-8000-000000000321" as Uuid,
          "018f6000-0000-7000-8000-000000000322" as Uuid,
        ],
      },
    };
    expect(computeRollupValue(rollup("unique"), uniqueSource, text, uniqueEntries)).toBe(1);
    expect(computeRollupValue(rollup("show_unique"), uniqueSource, text, uniqueEntries)).toEqual([
      "x",
    ]);
  });

  it("never passes an empty result off as the number of relations", () => {
    const blank = new Map<Uuid, RollupEntry>([
      [
        "018f6000-0000-7000-8000-000000000311" as Uuid,
        { title: "A", values: {}, relationTargets: {} },
      ],
      [
        "018f6000-0000-7000-8000-000000000312" as Uuid,
        { title: "B", values: {}, relationTargets: {} },
      ],
    ]);
    expect(computeRollupValue(rollup("average"), source, target, blank)).toBeNull();
    expect(computeRollupValue(rollup("max"), source, target, blank)).toBeNull();
    expect(computeRollupValue(rollup("empty"), source, target, blank)).toBe(2);
    expect(computeRollupValue(rollup("percent_empty"), source, target, blank)).toBe(100);
    expect(computeRollupValue(rollup("show_original"), source, target, blank)).toBeNull();
  });

  it("refuses a calculation the target type does not support", () => {
    expect(rollupFunctionsForType("text")).not.toContain("sum");
    expect(rollupFunctionsForType("number")).toContain("sum");
    expect(rollupFunctionsForType("date")).toContain("earliest_date");
    expect(rollupFunctionsForType("checkbox")).toContain("percent_checked");
    const text = { ...target, type: "text", config: {} } as DatabaseProperty;
    expect(computeRollupValue(rollup("sum"), source, text, entries)).toBeUndefined();
    const relation: DatabaseProperty = {
      id: relationId,
      name: "Achats",
      type: "relation",
      positionKey: "a",
      state: "active",
      config: { cardinality: "many" },
    };
    expect(rollupConfigIssue(rollup("sum"), relation, text)).toBe("function-incompatible");
    expect(rollupConfigIssue(rollup("sum"), relation, target)).toBeNull();
    expect(rollupConfigIssue(rollup("sum"), relation, undefined)).toBe("target-missing");
    expect(rollupConfigIssue(rollup("sum"), undefined, target)).toBe("relation-missing");
  });

  it("skips removed targets but refuses a partial local corpus", () => {
    const partial = new Map<Uuid, RollupEntry>([
      ["018f6000-0000-7000-8000-000000000311" as Uuid, entry("A", "10")],
    ]);
    expect(computeRollupValue(rollup("sum"), source, target, partial)).toBe(10);
    expect(
      computeRollupValue(rollup("sum"), source, target, partial, { missing: "unavailable" }),
    ).toBeUndefined();
    expect(
      computeRollupValue(rollup("sum"), source, target, partial, {
        missing: "unavailable",
        inactiveEntryIds: new Set(["018f6000-0000-7000-8000-000000000312" as Uuid]),
      }),
    ).toBe(10);
  });

  it("aggregates dates and checkboxes", () => {
    const date: DatabaseProperty = {
      id: "018f6000-0000-7000-8000-000000000305" as Uuid,
      name: "Date",
      type: "date",
      positionKey: "e",
      state: "active",
      config: { mode: "date" },
    };
    const done: DatabaseProperty = {
      id: "018f6000-0000-7000-8000-000000000306" as Uuid,
      name: "Fait",
      type: "checkbox",
      positionKey: "f",
      state: "active",
      config: {},
    };
    const dated = new Map<Uuid, RollupEntry>([
      [
        "018f6000-0000-7000-8000-000000000311" as Uuid,
        {
          title: "A",
          values: {
            [date.id]: { kind: "date", date: "2026-01-01" },
            [done.id]: { kind: "checkbox", checked: true },
          },
          relationTargets: {},
        },
      ],
      [
        "018f6000-0000-7000-8000-000000000312" as Uuid,
        {
          title: "B",
          values: { [date.id]: { kind: "date", date: "2026-01-10" } },
          relationTargets: {},
        },
      ],
    ]);
    expect(computeRollupValue(rollup("earliest_date"), source, date, dated)).toBe("2026-01-01");
    expect(computeRollupValue(rollup("latest_date"), source, date, dated)).toBe("2026-01-10");
    expect(computeRollupValue(rollup("date_range"), source, date, dated)).toBe(9);
    expect(computeRollupValue(rollup("checked"), source, done, dated)).toBe(1);
    expect(computeRollupValue(rollup("unchecked"), source, done, dated)).toBe(1);
    expect(computeRollupValue(rollup("percent_checked"), source, done, dated)).toBe(50);
  });
});

describe("rollups in views", () => {
  const viewId = "018f6000-0000-7000-8000-000000000401" as Uuid;
  const relation: DatabaseProperty = {
    id: relationId,
    name: "Achats",
    type: "relation",
    positionKey: "a",
    state: "active",
    config: { cardinality: "many" },
  };
  const formula: DatabaseProperty = {
    id: "018f6000-0000-7000-8000-000000000307" as Uuid,
    name: "Double",
    type: "formula",
    positionKey: "g",
    state: "active",
    config: { expression: 'prop("Total") * 2' },
  };
  function definition(view: Partial<DatabaseView>): DatabaseDefinition {
    return {
      properties: [
        {
          id: "018f6000-0000-7000-8000-000000000300" as Uuid,
          name: "Nom",
          type: "title",
          positionKey: "0",
          state: "active",
          config: {},
        },
        relation,
        rollup("sum"),
        formula,
      ],
      views: [
        {
          id: viewId,
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          visibleProperties: [],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: {},
          ...view,
        } as unknown as DatabaseView,
      ],
    } as unknown as DatabaseDefinition;
  }
  const a = "018f6000-0000-7000-8000-000000000311" as Uuid;
  const b = "018f6000-0000-7000-8000-000000000312" as Uuid;
  const rows: DatabaseQueryEntry[] = [
    {
      entryId: "018f6000-0000-7000-8000-000000000501" as Uuid,
      title: "Deux liens",
      values: {},
      relationTargets: { [relationId]: [a, b] },
    },
    {
      entryId: "018f6000-0000-7000-8000-000000000502" as Uuid,
      title: "Un lien",
      values: {},
      relationTargets: { [relationId]: [b] },
    },
    {
      entryId: "018f6000-0000-7000-8000-000000000503" as Uuid,
      title: "Aucun",
      values: {},
      relationTargets: {},
    },
  ];
  const context = { entries, propertiesById: new Map([[targetId, target]]) };

  it("gives a formula the computed rollup, not the number of relations", () => {
    const derived = createDerivedValues(definition({}), { rollups: context });
    const row = rows[0] as DatabaseQueryEntry;
    expect(derived.rollups(row)[rollupId]).toBe(30);
    expect(derived.formula(formula as never, row)).toEqual({ ok: true, value: 60 });
  });

  it("sorts and filters on the computed value before any page limit", () => {
    const sorted = definition({
      sorts: [{ propertyId: rollupId, direction: "descending", missing: "last" }],
    });
    const derived = createDerivedValues(sorted, { rollups: context });
    const first = evaluateDatabaseView(sorted, viewId, [...rows].reverse(), {
      maxRows: 1,
      derived: derived.comparable,
    });
    expect(first.ok && first.value.rows.map((row) => row.title)).toEqual(["Deux liens"]);

    const filtered = definition({
      filter: {
        mode: "all",
        criteria: [
          {
            id: "018f6000-0000-7000-8000-000000000601" as Uuid,
            propertyId: rollupId,
            operator: "greater-than",
            operand: { kind: "number", decimal: "20" },
          },
        ],
      },
    });
    const result = evaluateDatabaseView(filtered, viewId, rows, {
      derived: createDerivedValues(filtered, { rollups: context }).comparable,
    });
    expect(result.ok && result.value.rows.map((row) => row.title)).toEqual(["Deux liens"]);

    const byFormula = definition({
      filter: {
        mode: "all",
        criteria: [
          {
            id: "018f6000-0000-7000-8000-000000000602" as Uuid,
            propertyId: formula.id,
            operator: "equals",
            operand: { kind: "number", decimal: "40" },
          },
        ],
      },
    });
    const formulaResult = evaluateDatabaseView(byFormula, viewId, rows, {
      derived: createDerivedValues(byFormula, { rollups: context }).comparable,
    });
    expect(formulaResult.ok && formulaResult.value.rows.map((row) => row.title)).toEqual([
      "Un lien",
    ]);
  });
});

describe("place filters", () => {
  const placeId = "018f6000-0000-7000-8000-000000000701" as Uuid;
  const viewId = "018f6000-0000-7000-8000-000000000702" as Uuid;
  const model = (operator: "contains" | "equals", value: string): DatabaseDefinition =>
    ({
      properties: [
        { id: placeId, name: "Lieu", type: "place", positionKey: "a", state: "active", config: {} },
      ],
      views: [
        {
          id: viewId,
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          filter: {
            mode: "all",
            criteria: [
              {
                id: "018f6000-0000-7000-8000-000000000703" as Uuid,
                propertyId: placeId,
                operator,
                operand: { kind: "text", value },
              },
            ],
          },
          sorts: [{ propertyId: placeId, direction: "ascending", missing: "last" }],
          group: null,
        },
      ],
    }) as unknown as DatabaseDefinition;
  const place = (entry: string, name: string, address: string | null): DatabaseQueryEntry => ({
    entryId: `018f6000-0000-7000-8000-0000000008${entry}` as Uuid,
    title: name,
    values: {
      [placeId]: { kind: "place", placeId: entry, name, address, latitude: 0, longitude: 0 },
    },
    relationTargets: {},
  });
  const rows = [
    place("01", "Musée du Louvre", "99 Rue de Rivoli, 75001 Paris"),
    place("02", "Café de Flore", "172 Bd Saint-Germain, 75006 Paris"),
    place("03", "Vieux-Port", "Marseille"),
    place("04", "Paris", null),
  ];
  const titles = (definition: DatabaseDefinition): readonly string[] | false => {
    const result = evaluateDatabaseView(definition, viewId, rows);
    return result.ok && result.value.rows.map((row) => row.title);
  };

  it("matches the name or the address, ignoring case and accents, sorted by name", () => {
    expect(titles(model("contains", "paris"))).toEqual([
      "Café de Flore",
      "Musée du Louvre",
      "Paris",
    ]);
    expect(titles(model("contains", "MUSEE"))).toEqual(["Musée du Louvre"]);
    expect(titles(model("equals", "vieux-port"))).toEqual(["Vieux-Port"]);
  });
});
