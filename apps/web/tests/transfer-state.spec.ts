/**
 * What a transfer indicator is allowed to claim (T051, FR-007, FR-009).
 *
 * The discipline is the same one feature 003 established for saving, and it is
 * the whole reason these states are worth naming: **the interface never claims
 * more than is true.** "Stored" appears only when the server has verified what
 * it holds, never when the last chunk was acknowledged. Those are different
 * facts, and only one of them means the file is safe.
 *
 * Tested through the wording function rather than the component, because what
 * matters is the sentence: a state machine that is right and a label that
 * overclaims is still an interface that lies.
 */

import { describe, expect, it } from "vitest";
import { describeTransfer } from "../src/features/files/transfer-state.tsx";

describe("what each state says", () => {
  it("reports progress with byte counts, not only a percentage", () => {
    const described = describeTransfer({ kind: "uploading", sent: 512, total: 2048 });
    expect(described.label).toContain("25%");
    // On a large file a stalled percentage and a slow one look identical; the
    // numbers are what distinguish them.
    expect(described.detail).not.toBeNull();
  });

  it("has a word for the gap between the last byte and the confirmation", () => {
    const described = describeTransfer({ kind: "verifying" });
    // Without `verifying` there is a moment when every byte has been sent and
    // the honest answer is "not yet" — and an interface with no word for that
    // moment fills it with an optimistic one.
    expect(described.label).not.toMatch(/stored|synchronis|complete/i);
    expect(described.detail).toMatch(/confirm/i);
  });

  it("says stored only for the verified state", () => {
    expect(describeTransfer({ kind: "synchronized", itemId: "x" }).label).toBe("Stored");
    for (const state of [
      { kind: "uploading", sent: 2048, total: 2048 } as const,
      { kind: "verifying" } as const,
    ]) {
      expect(describeTransfer(state).label).not.toBe("Stored");
    }
  });

  it("states the limit when one caused the refusal", () => {
    const described = describeTransfer({
      kind: "blocked",
      reason: "This file is larger than this installation accepts.",
      limitBytes: 2048,
    });
    // FR-009: the owner is told what the limit is, so they can act rather than
    // guess at what would fit.
    expect(described.detail).toContain("2.0 KiB");
  });

  it("still explains a refusal that carries no limit", () => {
    const described = describeTransfer({ kind: "blocked", reason: "The transfer stopped." });
    expect(described.label).toBe("Not stored");
    expect(described.detail).toBe("The transfer stopped.");
  });

  it("says nothing at all when there is nothing happening", () => {
    expect(describeTransfer({ kind: "idle" }).detail).toBeNull();
  });

  it("does not divide by zero on an empty file", () => {
    // A zero-byte file is a legitimate file, and an indicator that renders NaN
    // over it is one an owner stops believing.
    expect(describeTransfer({ kind: "uploading", sent: 0, total: 0 }).label).toContain("100%");
  });
});
