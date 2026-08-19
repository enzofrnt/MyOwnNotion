/**
 * Refusing to migrate without a net (T036, FR-021 to FR-026).
 *
 * Migration is the most dangerous thing this product does to an owner's data, so
 * the tests here are all about the refusal rather than the happy path. The one
 * worth reading twice is the first: an installation that has never recorded a
 * version must not be treated as a version change, or the upgrade that
 * introduces this guard is the upgrade the guard refuses.
 */

import { describe, expect, it, vi } from "vitest";
import {
  decideUpdate,
  howToReturn,
  migrationsMayRun,
  type UpdateDecision,
} from "../src/backup/update-guard.ts";

const BACKUP_ID = "01a10000-0000-7000-8000-00000000ba01" as never;

describe("deciding whether migrations may run", () => {
  it("records the version on a first run rather than demanding a backup", async () => {
    const backupForUpdate = vi.fn(async () => BACKUP_ID);
    const decision = await decideUpdate({
      runningVersion: "0.2.0",
      recordedVersion: null,
      backupForUpdate,
    });
    expect(decision.kind).toBe("first-record");
    // Demanding a backup here would demand one of a version nobody can name, on
    // the very upgrade that introduces the guard.
    expect(backupForUpdate).not.toHaveBeenCalled();
    expect(migrationsMayRun(decision)).toBe(true);
  });

  it("does nothing when the version has not changed", async () => {
    const backupForUpdate = vi.fn(async () => BACKUP_ID);
    const decision = await decideUpdate({
      runningVersion: "0.2.0",
      recordedVersion: "0.2.0",
      backupForUpdate,
    });
    expect(decision.kind).toBe("unchanged");
    // A restart is not an update. Backing up on every container restart would
    // fill a destination and teach an owner to ignore the backup list.
    expect(backupForUpdate).not.toHaveBeenCalled();
  });

  it("takes a backup of the version being left and proceeds", async () => {
    const backupForUpdate = vi.fn(async () => BACKUP_ID);
    const decision = await decideUpdate({
      runningVersion: "0.3.0",
      recordedVersion: "0.2.0",
      backupForUpdate,
    });
    expect(backupForUpdate).toHaveBeenCalledWith("0.2.0", "0.3.0");
    expect(decision).toEqual({
      kind: "proceed",
      from: "0.2.0",
      to: "0.3.0",
      backupId: BACKUP_ID,
    });
    expect(migrationsMayRun(decision)).toBe(true);
  });

  it("refuses when the backup could not be produced or verified", async () => {
    const decision = await decideUpdate({
      runningVersion: "0.3.0",
      recordedVersion: "0.2.0",
      backupForUpdate: async () => null,
    });
    expect(decision.kind).toBe("refused");
    if (decision.kind === "refused") {
      // Both versions, so an operator knows which image to put back.
      expect(decision.reason).toContain("0.2.0");
      expect(decision.reason).toContain("0.3.0");
      // And the sentence an owner most needs at that moment.
      expect(decision.reason).toMatch(/untouched/i);
    }
    // The whole point: continuing on the old schema under a new binary is the
    // shape of failure that looks fine for weeks and then does not.
    expect(migrationsMayRun(decision)).toBe(false);
  });

  it("treats a failed production and a failed verification the same way", async () => {
    // Both leave nothing to return to, and offering an owner that distinction
    // mid-failure asks them to reason about a difference that changes nothing
    // they can do.
    const decision = await decideUpdate({
      runningVersion: "0.3.0",
      recordedVersion: "0.2.0",
      backupForUpdate: async () => null,
    });
    expect(decision.kind).toBe("refused");
  });
});

describe("telling an owner how to return", () => {
  it("names the version and the backup taken from it", () => {
    const message = howToReturn({ previousVersion: "0.2.0", previousBackupId: BACKUP_ID });
    expect(message).toContain("0.2.0");
    expect(message).toContain(BACKUP_ID);
    expect(message).toMatch(/verified before this update started/i);
  });

  it("says plainly when there is no backup for the previous version", () => {
    const message = howToReturn({ previousVersion: "0.2.0", previousBackupId: null });
    expect(message).toMatch(/by hand/i);
  });

  it("says plainly when there is no previous version at all", () => {
    // "Consult the documentation" at this moment is an instruction to go and be
    // anxious somewhere else.
    const message = howToReturn({ previousVersion: null, previousBackupId: null });
    expect(message).toMatch(/nothing to return to automatically/i);
  });
});

describe("reading a decision", () => {
  it("permits migration for every decision except a refusal", () => {
    const decisions: UpdateDecision[] = [
      { kind: "unchanged" },
      { kind: "first-record", applicationVersion: "0.1.0" },
      { kind: "proceed", from: "0.1.0", to: "0.2.0", backupId: BACKUP_ID },
    ];
    for (const decision of decisions) {
      expect(migrationsMayRun(decision)).toBe(true);
    }
  });
});
