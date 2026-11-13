import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";

const property: DatabaseProperty = {
  id: "018f4000-0000-7000-8000-0000000000b1" as Uuid,
  name: "Identifiant",
  type: "unique-id",
  positionKey: "z",
  state: "active",
  config: {},
};

describe("unique id property", () => {
  it("renders the stable entry number and an empty mark without one", () => {
    const row = {
      entryId: "018f4000-0000-7000-8000-0000000000b2" as Uuid,
      revisionId: "018f4000-0000-7000-8000-0000000000b3" as Uuid,
      entryNumber: 7,
      title: "Ligne",
      values: {},
      relationTargets: {},
      groupId: null,
    } as DatabaseQueryPageDto["rows"][number];
    expect(displayDatabaseValue(row, property)).toBe("7");
    expect(displayDatabaseValue({ ...row, entryNumber: undefined } as typeof row, property)).toBe(
      "—",
    );
    const withPrefix = { ...property, config: { prefix: "TASK" } } as DatabaseProperty;
    expect(displayDatabaseValue(row, withPrefix)).toBe("TASK-7");
  });
});
