/**
 * How rotation reads to an owner (T088, US5, FR-025 – FR-027, SC-008).
 *
 * One sentence in this panel decides how an owner behaves in the worst case,
 * so it is tested on its own rather than only through a browser journey:
 *
 * **A write block must say that reading still works.**
 *
 * An owner who reads "your workspace is blocked" concludes they have lost
 * their notes and starts doing damage — restoring backups, reinstalling,
 * deleting volumes. An owner who reads "you can still read everything; saving
 * resumes when the key is rotated" has an inconvenience with a fix. The
 * difference is entirely in the wording, which is why the wording is asserted.
 */

import { describe, expect, it } from "vitest";
import {
  daysUntilWriteBlock,
  describeKind,
  describeProgress,
  describeStatus,
} from "../src/features/security/key-rotation-panel.tsx";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-01T12:00:00.000Z");

function policy(overrides: Record<string, unknown> = {}) {
  return {
    kind: "data-key" as const,
    state: "pre-due" as const,
    dueAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    writeBlockAt: new Date(NOW.getTime() + 37 * DAY).toISOString(),
    lastCompletedAt: null,
    currentVersionOrGeneration: 1,
    nextAction: "none",
    ...overrides,
  } as Parameters<typeof describeStatus>[0];
}

describe("the blocked state", () => {
  it("says reading still works", () => {
    const status = describeStatus(policy({ state: "write-block" }), NOW);
    // The sentence this whole file exists for.
    expect(status.message).toMatch(/reste lisible/i);
    expect(status.tone).toBe("urgent");
  });

  it("says what restores saving", () => {
    // Naming the failure without naming the fix leaves an owner stuck at the
    // worst moment.
    expect(describeStatus(policy({ state: "write-block" }), NOW).message).toMatch(/rotat/i);
  });

  it("pairs every urgent state with what still works", () => {
    // Not "the word `lost` never appears" — the failed state says *nothing was
    // lost*, which is the reassurance itself. What must hold is that no urgent
    // message names a problem without also naming what survives it, because a
    // bare alarm is what sends an owner to delete a volume.
    for (const state of ["write-block", "failed", "emergency"] as const) {
      const { message } = describeStatus(policy({ state }), NOW);
      const reassures = /reste(?:nt)? lisible|rien n.a été perdu|enregistrement/i.test(message);
      expect(reassures, `${state}: ${message}`).toBe(true);
    }
  });
});

describe("a failed rotation", () => {
  it("says nothing was lost and it needs running again", () => {
    const status = describeStatus(policy({ state: "failed" }), NOW);
    // A failed rotation is recoverable by construction: both key generations
    // stay readable. An owner told only "failed" would assume otherwise.
    expect(status.message).toMatch(/rien n.a été perdu/i);
    expect(status.message).toMatch(/relancez/i);
  });
});

describe("the countdown", () => {
  it("counts to the write block, not the due date", () => {
    const status = describeStatus(
      policy({
        state: "overdue-within-grace",
        writeBlockAt: new Date(NOW.getTime() + 3 * DAY).toISOString(),
      }),
      NOW,
    );
    // The due date is when work should start; the write block is when the
    // workspace stops accepting changes. Only the second is a deadline.
    expect(status.message).toMatch(/3 jours/);
  });

  it("says one day in the singular", () => {
    const status = describeStatus(
      policy({
        state: "overdue-within-grace",
        writeBlockAt: new Date(NOW.getTime() + 1 * DAY + 60_000).toISOString(),
      }),
      NOW,
    );
    expect(status.message).toMatch(/1 jour\b/);
  });

  it("rounds down rather than up", () => {
    // "1 day left" that is really eleven hours is a promise the installation
    // cannot keep.
    expect(daysUntilWriteBlock(new Date(NOW.getTime() + 1.9 * DAY).toISOString(), NOW)).toBe(1);
  });

  it("reports nothing rather than guessing from a malformed date", () => {
    expect(daysUntilWriteBlock("not-a-date", NOW)).toBeNull();
    const status = describeStatus(
      policy({ state: "overdue-within-grace", writeBlockAt: "not-a-date" }),
      NOW,
    );
    // Still a warning, just without a number it cannot compute.
    expect(status.tone).toBe("warning");
    expect(status.message).toMatch(/en retard/i);
  });
});

describe("progress on a running rotation", () => {
  it("reports counts rather than a bare percentage", () => {
    const described = describeProgress({
      operationId: "op",
      kind: "data-key",
      phase: "rewriting",
      processedCount: 4812,
      totalCount: 7700,
    });
    // A progress bar with no numbers is indistinguishable from a hang, and an
    // owner who concludes it has hung will restart the container mid-sweep.
    expect(described).toMatch(/4\s812/u);
    expect(described).toMatch(/7\s700/u);
  });

  it("says it is starting rather than showing a confident zero", () => {
    expect(
      describeProgress({
        operationId: "op",
        kind: "data-key",
        phase: "planned",
        processedCount: 0,
        totalCount: 0,
      }),
    ).toBe("Démarrage.");
  });

  it("counts workspaces for the installation key and notes for the note key", () => {
    const wrapping = describeProgress({
      operationId: "op",
      kind: "wrapping-key",
      phase: "rewrapping",
      processedCount: 1,
      totalCount: 1,
    });
    expect(wrapping).toMatch(/espaces de travail/);
  });
});

describe("what each key is, in the owner's terms", () => {
  it("says the installation key does not touch the notes", () => {
    expect(describeKind("wrapping-key")).toMatch(/ne modifie pas vos notes/i);
  });

  it("warns that rotating the note key rewrites everything", () => {
    // The two rotations differ in cost by orders of magnitude, and that is
    // what someone deciding when to run one needs to know.
    expect(describeKind("data-key")).toMatch(/réécrit chaque/i);
  });

  it("uses neither schema term on screen", () => {
    for (const kind of ["wrapping-key", "data-key"] as const) {
      expect(describeKind(kind)).not.toMatch(
        /wrapping key|data key|clé d.enveloppe|clé de données/i,
      );
    }
  });
});

describe("a healthy installation", () => {
  it("says there is nothing to do", () => {
    expect(describeStatus(policy({ state: "pre-due" }), NOW).tone).toBe("ok");
    expect(describeStatus(policy({ state: "complete" }), NOW).message).toMatch(
      /aucune action nécessaire/i,
    );
  });

  it("reassures during a running rotation", () => {
    const status = describeStatus(policy({ state: "in-progress" }), NOW);
    expect(status.tone).toBe("ok");
    expect(status.message).toMatch(/restent lisibles/i);
  });
});
