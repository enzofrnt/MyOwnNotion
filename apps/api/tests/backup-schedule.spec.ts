/**
 * When the nightly backup happens, including the days a clock moves (T016, FR-005).
 *
 * A daily interval of twenty-four hours is the obvious implementation, and it is
 * wrong twice a year: "twenty-four hours after 04:00" is 03:00 or 05:00 on the
 * day a clock changes, and the backup drifts away from the hour the owner was
 * promised. These tests are the reason the schedule computes from the calendar
 * rather than adding to the last run.
 */

import { describe, expect, it } from "vitest";
import { backupIsDue, dayIn, hourIn } from "../src/backup/schedule.ts";

const PARIS = "Europe/Paris";

function at(iso: string): Date {
  return new Date(iso);
}

describe("deciding whether a backup is due", () => {
  it("is not due before the hour", () => {
    expect(
      backupIsDue({ now: at("2026-08-18T01:00:00Z"), lastRunAt: null, hour: 4, timeZone: PARIS }),
    ).toBe(false);
  });

  it("is due at the hour when nothing has run", () => {
    // 04:00 in Paris is 02:00Z in summer.
    expect(
      backupIsDue({ now: at("2026-08-18T02:00:00Z"), lastRunAt: null, hour: 4, timeZone: PARIS }),
    ).toBe(true);
  });

  it("is not due again the same day", () => {
    // A restart at 04:05 must not produce a second archive of the same moment.
    expect(
      backupIsDue({
        now: at("2026-08-18T02:05:00Z"),
        lastRunAt: at("2026-08-18T02:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(false);
  });

  it("is due the next day", () => {
    expect(
      backupIsDue({
        now: at("2026-08-19T02:00:00Z"),
        lastRunAt: at("2026-08-18T02:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(true);
  });

  it("still runs today after a machine was down all morning", () => {
    // 23:00 Paris, nothing ran today. Waiting for tomorrow would silently skip a
    // day, which is the failure the 26-hour warning exists to notice — better not
    // to cause it.
    expect(
      backupIsDue({
        now: at("2026-08-18T21:00:00Z"),
        lastRunAt: at("2026-08-17T02:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(true);
  });
});

describe("the days a clock moves", () => {
  it("runs once on the spring-forward day, when it is 23 hours long", () => {
    // Paris moves 02:00 → 03:00 on 2026-03-29. The day is 23 hours long; a
    // 24-hour interval would push the next run into the following day.
    const before = backupIsDue({
      now: at("2026-03-29T02:00:00Z"), // 04:00 Paris (CEST)
      lastRunAt: at("2026-03-28T03:00:00Z"), // 04:00 Paris (CET)
      hour: 4,
      timeZone: PARIS,
    });
    expect(before).toBe(true);
  });

  it("does not run twice on the autumn day, when it is 25 hours long", () => {
    // Paris moves 03:00 → 02:00 on 2026-10-25. A 24-hour interval fires twice on
    // that day; a calendar day fires once.
    const again = backupIsDue({
      now: at("2026-10-25T05:00:00Z"), // still 2026-10-25 in Paris
      lastRunAt: at("2026-10-25T02:00:00Z"), // 04:00 Paris (CEST), same day
      hour: 4,
      timeZone: PARIS,
    });
    expect(again).toBe(false);
  });

  it("reads the hour through the zone rather than by arithmetic", () => {
    // The offset is not a constant, which is the entire reason this module
    // exists rather than a subtraction.
    expect(hourIn(PARIS, at("2026-01-15T03:00:00Z"))).toBe(4);
    expect(hourIn(PARIS, at("2026-07-15T02:00:00Z"))).toBe(4);
  });

  it("names the calendar day in the configured zone", () => {
    // 23:30 UTC is already tomorrow in Paris, and a schedule that used UTC days
    // would run twice on one Paris day and never on another.
    expect(dayIn(PARIS, at("2026-08-18T23:30:00Z"))).toBe("2026-08-19");
  });
});
