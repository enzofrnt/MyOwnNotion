import { describe, expect, it } from "vitest";
import {
  computeRollupValue,
  type DatabaseProperty,
  type RollupEntry,
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
    expect(computeRollupValue(rollup("show_original"), source, target, entries)).toBe("10, 20");
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
    expect(computeRollupValue(rollup("show_unique"), uniqueSource, text, uniqueEntries)).toBe("x");
  });
});
