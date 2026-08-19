/**
 * Which backups may be deleted (T010, FR-010, FR-011).
 *
 * The assertions worth having are all about the floor, not the calendar. A
 * retention pass that only counts days will, on the week transfers have been
 * failing, delete the last backup that was ever verified — at the exact moment
 * its absence costs everything.
 */

import { describe, expect, it } from "vitest";
import {
  backupIsStale,
  backupsToDelete,
  DEFAULT_RETENTION_DAYS,
  type RetainableBackup,
} from "../src/index.ts";

const NOW = new Date("2026-08-18T04:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function backup(id: string, days: number, verified: boolean): RetainableBackup {
  return { id, createdAt: daysAgo(days), verifiedAtDestination: verified };
}

const policy = { retainDays: DEFAULT_RETENTION_DAYS, now: NOW };

describe("deleting old backups", () => {
  it("deletes one that is past retention when a newer verified backup remains", () => {
    const deletable = backupsToDelete(
      [backup("old", 200, true), backup("recent", 1, true)],
      policy,
    );
    expect(deletable).toEqual(["old"]);
  });

  it("keeps a backup that is past retention when nothing newer is verified", () => {
    // The case the rule exists for. Transfers have been failing for a week, so
    // the only verified copy is the old one — and a calendar would delete it.
    const deletable = backupsToDelete(
      [backup("old", 200, true), backup("recent", 1, false)],
      policy,
    );
    expect(deletable).toEqual([]);
  });

  it("deletes nothing when no backup has ever been verified at the destination", () => {
    // Deleting here would remove the only copies that exist, on the authority of
    // a calendar and nothing else.
    const deletable = backupsToDelete([backup("a", 300, false), backup("b", 200, false)], policy);
    expect(deletable).toEqual([]);
  });

  it("never deletes the newest verified backup, however old it is", () => {
    const deletable = backupsToDelete([backup("ancient", 900, true)], policy);
    expect(deletable).toEqual([]);
  });

  it("keeps a backup that is old but still within retention", () => {
    const deletable = backupsToDelete(
      [backup("inside", DEFAULT_RETENTION_DAYS - 1, true), backup("newest", 0, true)],
      policy,
    );
    expect(deletable).toEqual([]);
  });

  it("never proposes a set of deletions that would leave nothing verified", () => {
    // Two old verified backups: each is individually "safe because the other
    // exists", and deleting both is not. Deciding them together is what makes
    // that impossible to express.
    const deletable = backupsToDelete(
      [backup("older", 400, true), backup("old", 300, true)],
      policy,
    );
    const survivors = ["older", "old"].filter((id) => !deletable.includes(id));
    expect(survivors.length).toBeGreaterThan(0);
    expect(deletable).toEqual(["older"]);
  });

  it("honours a configured retention window", () => {
    const deletable = backupsToDelete([backup("old", 10, true), backup("new", 1, true)], {
      retainDays: 7,
      now: NOW,
    });
    expect(deletable).toEqual(["old"]);
  });
});

describe("warning about staleness", () => {
  it("says nothing while a verified backup is recent", () => {
    expect(backupIsStale(daysAgo(0), NOW)).toBe(false);
  });

  it("tolerates a schedule that runs a little late", () => {
    // Twenty-five hours is a daily backup that started an hour behind. Warning
    // here would produce a warning most mornings, and a warning an owner sees
    // daily is one they stop reading.
    const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    expect(backupIsStale(twentyFiveHoursAgo, NOW)).toBe(false);
  });

  it("warns once a day has genuinely been missed", () => {
    const twentySevenHoursAgo = new Date(NOW.getTime() - 27 * 60 * 60 * 1000);
    expect(backupIsStale(twentySevenHoursAgo, NOW)).toBe(true);
  });

  it("warns when nothing has ever been verified at the destination", () => {
    // A backup that never left the machine protects against nothing this
    // feature exists to protect against.
    expect(backupIsStale(null, NOW)).toBe(true);
  });
});
