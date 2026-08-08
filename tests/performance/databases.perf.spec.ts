import {
  groupDatabaseRecords,
  projectDatabaseRecords,
  validateDatabaseBlockAttributes,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildDatabaseFixture } from "../fixtures/databases.ts";

describe("structured database performance", () => {
  it("validates, filters, sorts, and groups 1,000 records with 20 properties within one second", () => {
    const database = buildDatabaseFixture(1_000, 20);
    const numberProperty = database.properties.find((property) => property.type === "number");
    const selectProperty = database.properties.find((property) => property.type === "select");
    if (numberProperty === undefined || selectProperty === undefined) {
      throw new Error("Performance fixture is missing sortable properties");
    }
    const durations: number[] = [];
    let projectedCount = 0;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const started = performance.now();
      const validated = validateDatabaseBlockAttributes(database);
      if (!validated.ok) throw new Error("Performance fixture did not validate");
      const projectedDatabase = {
        ...validated.value,
        view: {
          ...validated.value.view,
          query: "Text 9",
          sortPropertyId: numberProperty.propertyId,
          sortDirection: iteration % 2 === 0 ? ("asc" as const) : ("desc" as const),
          boardGroupPropertyId: selectProperty.propertyId,
        },
      };
      const records = projectDatabaseRecords(projectedDatabase);
      const groups = groupDatabaseRecords(projectedDatabase, records);
      projectedCount = groups.reduce((count, group) => count + group.records.length, 0);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(
      `[perf] 1,000-record/20-property validation/filter/sort/group p95=${p95.toFixed(1)}ms`,
    );
    expect(projectedCount).toBeGreaterThan(0);
    expect(p95).toBeLessThan(1_000);
  });
});
