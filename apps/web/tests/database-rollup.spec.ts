import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty, RollupFunction, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";

const relationId = "018f4000-0000-7000-8000-000000000101" as Uuid;
const rollupId = "018f4000-0000-7000-8000-000000000102" as Uuid;
const formulaId = "018f4000-0000-7000-8000-000000000105" as Uuid;

function rollup(aggregate: RollupFunction): Extract<DatabaseProperty, { type: "rollup" }> {
  return {
    id: rollupId,
    name: "Total",
    type: "rollup",
    positionKey: "z",
    state: "active",
    config: {
      relationPropertyId: relationId,
      targetPropertyId: "018f4000-0000-7000-8000-000000000106" as Uuid,
      aggregate,
    },
  };
}
const formula: DatabaseProperty = {
  id: formulaId,
  name: "Double",
  type: "formula",
  positionKey: "zz",
  state: "active",
  config: { expression: 'prop("Total") * 2' },
};
const row = {
  entryId: "018f4000-0000-7000-8000-000000000103" as Uuid,
  revisionId: "018f4000-0000-7000-8000-000000000104" as Uuid,
  title: "Ligne",
  values: {},
  relationTargets: { [relationId]: [relationId, rollupId] },
  rollupValues: { [rollupId]: 30 },
  groupId: null,
} as DatabaseQueryPageDto["rows"][number];
const withValue = (value: unknown): typeof row =>
  ({ ...row, rollupValues: { [rollupId]: value } }) as typeof row;

describe("rollup display", () => {
  it("shows the computed value, never the number of relations", () => {
    expect(displayDatabaseValue(row, rollup("sum"))).toBe("30");
    expect(displayDatabaseValue(withValue(null), rollup("average"))).toBe("—");
  });

  it("shows an uncomputed rollup as unavailable instead of counting relations", () => {
    const missing = { ...row, rollupValues: undefined } as typeof row;
    expect(displayDatabaseValue(missing, rollup("sum"))).toBe("—");
    expect(displayDatabaseValue({ ...row, rollupValues: {} } as typeof row, rollup("sum"))).toBe(
      "—",
    );
    // An unavailable configured count must not be replaced by a raw edge count.
    expect(displayDatabaseValue(missing, rollup("count"))).toBe("—");
    expect(displayDatabaseValue(withValue(2), rollup("count"))).toBe("2");
  });

  it("formats percentages, dates and lists", () => {
    expect(displayDatabaseValue(withValue(50), rollup("percent_empty"))).toBe("50 %");
    expect(displayDatabaseValue(withValue("2026-01-10"), rollup("latest_date"))).toContain("2026");
    expect(displayDatabaseValue(withValue([10, "x", true]), rollup("show_original"))).toBe(
      "10, x, Oui",
    );
  });

  it("gives a formula the same computed rollup as the cell", () => {
    expect(displayDatabaseValue(row, formula, [rollup("sum"), formula])).toBe("60");
    const missing = { ...row, rollupValues: {} } as typeof row;
    expect(displayDatabaseValue(missing, formula, [rollup("sum"), formula])).toBe("—");
  });
});
