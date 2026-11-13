import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, dateConfigOf } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { formatDatabaseDate } from "../src/features/databases/date-format.ts";

const civil = (dateFormat: typeof DEFAULT_DATE_FORMAT) => ({
  mode: "date" as const,
  dateFormat,
  timeFormat: DEFAULT_TIME_FORMAT,
});
const instant = (
  timeFormat: "hidden" | "12h" | "24h",
  dateFormat: typeof DEFAULT_DATE_FORMAT = "full",
) => ({
  mode: "instant" as const,
  dateFormat,
  timeFormat,
});

describe("database date display", () => {
  it("formats civil dates in Notion date formats without timezone drift", () => {
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("full"))).toContain("6");
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("full"))).toContain(
      "2026",
    );
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("short"))).toMatch(/6/u);
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("month-day-year"))).toBe(
      "11/6/2026",
    );
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("day-month-year"))).toBe(
      "6/11/2026",
    );
    expect(formatDatabaseDate({ kind: "date", date: "2026-11-06" }, civil("year-month-day"))).toBe(
      "2026/11/6",
    );
  });

  it("formats a date range with the selected format", () => {
    expect(
      formatDatabaseDate(
        { kind: "date", date: "2026-11-06", endDate: "2026-11-08" },
        civil("day-month-year"),
      ),
    ).toBe("6/11/2026 → 8/11/2026");
  });

  it("hides or formats the clock for instants", () => {
    const value = { kind: "instant" as const, instant: "2026-11-06T14:05:00.000Z" };
    expect(formatDatabaseDate(value, instant("hidden"))).not.toContain(":");
    expect(formatDatabaseDate(value, instant("12h"))).toContain(":");
    expect(formatDatabaseDate(value, instant("24h"))).toContain(":");
    expect(formatDatabaseDate(value, instant("24h"))).not.toContain("AM");
  });

  it("reads defaults for legacy date properties", () => {
    const config = dateConfigOf({
      id: "00000000-0000-7000-8000-000000000000",
      name: "Date",
      positionKey: "a",
      state: "active",
      type: "date",
      config: { mode: "date" },
    } as never);
    expect(config.dateFormat).toBe(DEFAULT_DATE_FORMAT);
    expect(config.timeFormat).toBe(DEFAULT_TIME_FORMAT);
  });
});
