/**
 * When the nightly backup happens, including the days a clock moves (T016, FR-005).
 *
 * A daily interval of twenty-four hours is the obvious implementation, and it is
 * wrong twice a year: "twenty-four hours after 04:00" is 03:00 or 05:00 on the
 * day a clock changes, and the backup drifts away from the hour the owner was
 * promised. These tests are the reason the schedule computes from the calendar
 * rather than adding to the last run.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupSchedule, backupIsDue, dayIn, hourIn } from "../src/backup/schedule.ts";

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

describe("the schedule loop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function scheduleWith(overrides: {
    readonly runBackup?: () => Promise<void>;
    readonly lastScheduledRunAt?: () => Promise<Date | null>;
    readonly logger?: { error: (details: unknown, message: string) => void };
    readonly now?: () => Date;
  }): BackupSchedule & { runs: number[] } {
    const state = { runs: [] as number[] };
    const schedule = new BackupSchedule({
      runBackup:
        overrides.runBackup ??
        (async () => {
          state.runs.push(Date.now());
        }),
      lastScheduledRunAt: overrides.lastScheduledRunAt ?? (async () => null),
      logger: overrides.logger ?? { error: () => undefined },
      hour: 4,
      timeZone: "UTC",
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    });
    return Object.assign(schedule, state);
  }

  it("runs when due and stays quiet when not", async () => {
    const due = scheduleWith({ now: () => at("2026-08-18T04:00:00Z") });
    await due.evaluate();
    expect(due.runs).toHaveLength(1);

    const early = scheduleWith({ now: () => at("2026-08-18T03:59:00Z") });
    await early.evaluate();
    expect(early.runs).toHaveLength(0);
  });

  it("never starts a second backup while one is in flight", async () => {
    // Two ticks firing while the first archive is still being written would
    // stage two archives of the same moment into the same place.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const schedule = new BackupSchedule({
      runBackup: async () => {
        calls += 1;
        await gate;
      },
      lastScheduledRunAt: async () => null,
      logger: { error: () => undefined },
      now: () => at("2026-08-18T04:00:00Z"),
    });
    const first = schedule.evaluate();
    await schedule.evaluate();
    release();
    await first;
    expect(calls).toBe(1);
  });

  it("keeps the schedule alive when an evaluation fails", async () => {
    vi.useFakeTimers();
    const logged: string[] = [];
    const schedule = new BackupSchedule({
      runBackup: async () => undefined,
      lastScheduledRunAt: async () => {
        throw new Error("the ledger is unreadable");
      },
      logger: { error: (_details, message) => logged.push(message) },
      now: () => at("2026-08-18T04:00:00Z"),
      tickMs: 1_000,
    });
    schedule.start();
    await vi.advanceTimersByTimeAsync(2_500);
    schedule.stop();
    // The immediate evaluation plus the ticks at one and two seconds all
    // failed, and every failure was caught by the guard rather than escaping:
    // one bad night must not become permanent silence.
    expect(logged).toEqual([
      "scheduled backup failed",
      "scheduled backup failed",
      "scheduled backup failed",
    ]);
  });

  it("stops cleanly and releases the timer", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const schedule = new BackupSchedule({
      runBackup: async () => {
        calls += 1;
      },
      lastScheduledRunAt: async () => null,
      logger: { error: () => undefined },
      now: () => at("2026-08-18T04:00:00Z"),
      tickMs: 1_000,
    });
    schedule.start();
    await vi.advanceTimersByTimeAsync(0);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    // The immediate evaluation happened; nothing after `stop` did. A timer that
    // kept the event loop alive would also stop the container from ever exiting.
    expect(calls).toBe(1);
  });
});
