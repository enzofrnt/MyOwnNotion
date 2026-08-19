/**
 * What the backup screen says, and what it refuses to imply (T018, T033).
 *
 * The assertions are about wording as much as about state, because this screen's
 * whole job is to be believed at the moment somebody skims it. Two facts must
 * stay separate: backups succeeding, and a restoration having been rehearsed. A
 * screen that showed only the first would tell an owner their backups are healthy
 * without telling them nobody has ever checked that one can be restored.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type BackupStatus, BackupStatusSummary } from "../src/features/backup/backup-panel.tsx";

function status(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    lastVerifiedAt: "2026-08-18T04:00:00.000Z",
    lastVerifiedBackupId: "01a10000-0000-7000-8000-00000000ba01",
    latestBackupAt: "2026-08-18T04:00:00.000Z",
    latestBackupId: "01a10000-0000-7000-8000-00000000ba01",
    latestCreationVerification: "passed",
    latestTransferVerification: "passed",
    lastRehearsalAt: "2026-08-01T10:00:00.000Z",
    lastRehearsalOutcome: "succeeded",
    stale: false,
    rehearsalDue: false,
    ...overrides,
  };
}

describe("the shape the panel is given", () => {
  it("keeps the backup and the rehearsal as separate facts", () => {
    const current = status({ lastRehearsalAt: null, lastRehearsalOutcome: null });
    // A verified backup and an untested restore is a real and common state, and
    // the type has to be able to express it or the screen cannot report it.
    expect(current.lastVerifiedAt).not.toBeNull();
    expect(current.lastRehearsalAt).toBeNull();
  });

  it("carries staleness as a decision rather than leaving it to the screen", () => {
    // The 26-hour rule lives in the domain and is tested there. Recomputing it
    // in a component would give the rule two homes, and the one that drifts is
    // the one somebody reads.
    expect(status({ stale: true }).stale).toBe(true);
  });

  it("distinguishes a failed rehearsal from no rehearsal", () => {
    const failed = status({ lastRehearsalOutcome: "failed" });
    const never = status({ lastRehearsalAt: null, lastRehearsalOutcome: null });
    // "Tested and it did not work" is a much louder fact than "never tested",
    // and collapsing them would hide the loud one.
    expect(failed.lastRehearsalOutcome).toBe("failed");
    expect(never.lastRehearsalOutcome).toBeNull();
  });

  it("carries no secret", () => {
    // A backup identifier is not a secret; a destination credential would be.
    // The shape has no field that could hold one, which is the cheapest way to
    // keep FR-019 true.
    const fields = Object.keys(status());
    expect(fields.filter((field) => /token|secret|credential|key/i.test(field))).toEqual([]);
  });
});

describe("what the owner reads", () => {
  const render = (current: BackupStatus): string =>
    renderToStaticMarkup(createElement(BackupStatusSummary, { status: current }));

  it("states plainly when the remote copy is stale", () => {
    const html = render(status({ stale: true }));
    expect(html).toContain("No verified backup in more than a day");
    expect(html).toContain("not currently protected against losing this machine");
    expect(html).toContain('role="alert"');
  });

  it("names a failed transfer even while an earlier verified backup is recent", () => {
    const html = render(
      status({
        latestBackupAt: "2026-08-19T04:00:00.000Z",
        latestTransferVerification: "failed",
      }),
    );
    expect(html).toContain("latest backup was not verified after transfer");
    expect(html).toContain("verified on this machine");
    expect(html).toContain("configured backup destination");
    expect(html).toContain('role="alert"');
  });

  it("distinguishes local verification failure from a transfer failure", () => {
    const html = render(
      status({
        latestCreationVerification: "failed",
        latestTransferVerification: null,
      }),
    );
    expect(html).toContain("failed verification on this machine");
    expect(html).toContain("was not sent to the destination");
    expect(html).not.toContain("latest backup was not verified after transfer");
  });

  it("shows an ordinary verified backup without calling it a rehearsed restore", () => {
    const html = render(status({ lastRehearsalAt: null, lastRehearsalOutcome: null }));
    expect(html).toContain("Last verified backup:");
    expect(html).toContain("Last test restoration: never");
  });

  it("invites a rehearsal after a month and explains that the live workspace is untouched", () => {
    const html = render(status({ rehearsalDue: true }));
    expect(html).toContain("more than a month");
    expect(html).toContain("separate place");
    expect(html).toContain("leaves this workspace untouched");
  });
});
