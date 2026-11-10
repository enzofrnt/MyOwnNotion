import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";

const relationId = "018f4000-0000-7000-8000-000000000101" as Uuid;
const rollupId = "018f4000-0000-7000-8000-000000000102" as Uuid;
const property: DatabaseProperty = {
  id: rollupId,
  name: "Total",
  type: "rollup",
  positionKey: "z",
  state: "active",
  config: { relationPropertyId: relationId, aggregate: "sum" },
};
const row = {
  entryId: "018f4000-0000-7000-8000-000000000103" as Uuid,
  revisionId: "018f4000-0000-7000-8000-000000000104" as Uuid,
  title: "Ligne",
  values: {},
  relationTargets: { [relationId]: [relationId] },
  rollupValues: { [rollupId]: 42.5 },
  groupId: null,
} as DatabaseQueryPageDto["rows"][number];

describe("rollup display", () => {
  it("uses the computed rollup value when the query provides it", () => {
    expect(displayDatabaseValue(row, property)).toBe("42.5");
  });

  it("falls back to the relation count without a computed value", () => {
    expect(displayDatabaseValue({ ...row, rollupValues: undefined } as typeof row, property)).toBe(
      "1",
    );
  });
});
