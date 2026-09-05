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
  it("protects an installation with no verified backup even before the next nightly hour", () => {
    expect(
      backupIsDue({ now: at("2026-08-18T01:00:00Z"), lastRunAt: null, hour: 4, timeZone: PARIS }),
    ).toBe(true);
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
  it("does not repeat a configured 02:00 backup during the autumn repeated hour", () => {
    expect(
      backupIsDue({
        now: at("2026-10-25T01:30:00Z"),
        lastRunAt: at("2026-10-25T00:00:00Z"),
        hour: 2,
        timeZone: PARIS,
      }),
    ).toBe(false);
  });

  it("catches up yesterday before today's scheduled hour without repeating an already verified backup", () => {
    expect(
      backupIsDue({
        now: at("2026-08-20T01:00:00Z"),
        lastRunAt: at("2026-08-18T02:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(true);
    expect(
      backupIsDue({
        now: at("2026-08-20T01:00:00Z"),
        lastRunAt: at("2026-08-19T02:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(false);
    expect(
      backupIsDue({
        now: at("2026-08-20T03:00:00Z"),
        lastRunAt: at("2026-08-20T01:00:00Z"),
        hour: 4,
        timeZone: PARIS,
      }),
    ).toBe(true);
  });
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
      lastRunAt: at("2026-10-25T03:00:00Z"), // 04:00 Paris (CET), same day
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
  it("retries a failed attempt on the next five-minute tick and then stays quiet after success", async () => {
    vi.useFakeTimers();
    const now = at("2026-09-05T04:00:00Z");
    let lastVerified: Date | null = null;
    let attempts = 0;
    const schedule = new BackupSchedule({
      now: () => now,
      runBackup: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        lastVerified = now;
      },
      lastVerifiedFullBackupAt: async () => lastVerified,
      logger: { error: () => undefined },
    });
    schedule.start();
    schedule.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    schedule.stop();
    expect(attempts).toBe(2);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function scheduleWith(overrides: {
    readonly runBackup?: () => Promise<void>;
    readonly lastVerifiedFullBackupAt?: () => Promise<Date | null>;
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
      lastVerifiedFullBackupAt: overrides.lastVerifiedFullBackupAt ?? (async () => null),
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

    const early = scheduleWith({
      now: () => at("2026-08-18T03:59:00Z"),
      lastVerifiedFullBackupAt: async () => at("2026-08-17T04:00:00Z"),
    });
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
      lastVerifiedFullBackupAt: async () => null,
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
      lastVerifiedFullBackupAt: async () => {
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

  it("retries remote transfers while the verified local backup is already current", async () => {
    const runBackup = vi.fn();
    const maintenance = vi.fn();
    const schedule = new BackupSchedule({
      runBackup,
      maintenance,
      lastVerifiedFullBackupAt: async () => at("2026-08-18T04:01:00Z"),
      logger: { error: () => undefined },
      now: () => at("2026-08-18T04:05:00Z"),
    });
    await schedule.evaluate();
    expect(runBackup).not.toHaveBeenCalled();
    expect(maintenance).toHaveBeenCalledOnce();
  });

  it("stops cleanly and releases the timer", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const schedule = new BackupSchedule({
      runBackup: async () => {
        calls += 1;
      },
      lastVerifiedFullBackupAt: async () => null,
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
