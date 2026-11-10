import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import { type DatabaseProperty, dateDisplayConfigOf, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { uuidV7Timestamp } from "../src/features/databases/database-time.ts";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";
import { formatDatabaseDate } from "../src/features/databases/date-format.ts";

const instant = 1_700_000_000_000;
const hex = instant.toString(16).padStart(12, "0");
const revisionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000` as Uuid;

describe("read-only database timestamps", () => {
  it("reads a UUIDv7 revision and refuses other versions", () => {
    expect(uuidV7Timestamp(revisionId)).toBe(new Date(instant).toISOString());
    expect(uuidV7Timestamp("018bcfe5-6800-4000-8000-000000000000")).toBeNull();
    expect(uuidV7Timestamp("not-a-uuid")).toBeNull();
  });

  it("formats the creation time from the query row", () => {
    const property: DatabaseProperty = {
      id: "018f4000-0000-7000-8000-000000000003" as Uuid,
      name: "Date de création",
      type: "created-time",
      positionKey: "b",
      state: "active",
      config: {},
    };
    const row = {
      entryId: "018f4000-0000-7000-8000-000000000004" as Uuid,
      revisionId,
      createdAt: new Date(instant).toISOString(),
      title: "Ligne",
      values: {},
      relationTargets: {},
      groupId: null,
    } as DatabaseQueryPageDto["rows"][number];
    expect(displayDatabaseValue(row, property)).toBe(
      formatDatabaseDate(
        { kind: "instant", instant: new Date(instant).toISOString() },
        dateDisplayConfigOf(property),
      ),
    );
  });

  it("formats the last edit time instead of an empty cell", () => {
    const property: DatabaseProperty = {
      id: "018f4000-0000-7000-8000-000000000001" as Uuid,
      name: "Dernière modification",
      type: "last-edited-time",
      positionKey: "a",
      state: "active",
      config: {},
    };
    const row = {
      entryId: "018f4000-0000-7000-8000-000000000002" as Uuid,
      revisionId,
      title: "Ligne",
      values: {},
      relationTargets: {},
      groupId: null,
    } as DatabaseQueryPageDto["rows"][number];
    expect(displayDatabaseValue(row, property)).toBe(
      formatDatabaseDate(
        { kind: "instant", instant: new Date(instant).toISOString() },
        dateDisplayConfigOf(property),
      ),
    );
    expect(displayDatabaseValue(row, property)).not.toBe("—");
  });
});
