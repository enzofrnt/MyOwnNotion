/**
 * The eight policy states under a controlled clock (T074, US5, FR-025 – FR-027).
 *
 * Every state here is a function of time, and time is exactly what a test must
 * not be allowed to supply by accident. `new Date()` in an assertion makes a
 * suite that passes in the morning and fails after a deployment at 23:58, so
 * every instant below is explicit and every boundary is checked on both sides
 * of itself.
 *
 * The boundaries matter more than the states. "Overdue" and "blocked" are one
 * millisecond apart in the worst case, and an off-by-one there is either an
 * installation that refuses writes a week early or one that never refuses them
 * at all.
 */

import {
  computeWriteBlockAt,
  evaluateRotationPolicy,
  type KeyRotationPolicy,
  SCHEDULED_ROTATION_GRACE_DAYS,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const EPOCH = new Date("2026-01-01T00:00:00.000Z");

function at(offsetDays: number, offsetMs = 0): Date {
  return new Date(EPOCH.getTime() + offsetDays * DAY + offsetMs);
}

function policy(overrides: Partial<KeyRotationPolicy> = {}): KeyRotationPolicy {
  const dueAt = overrides.dueAt ?? at(365);
  const mode = overrides.mode ?? "scheduled";
  return {
    kind: "wrapping-key",
    mode,
    currentGeneration: 1,
    dueAt,
    lastCompletedAt: EPOCH,
    writeBlockAt: overrides.writeBlockAt ?? computeWriteBlockAt(dueAt, mode),
    operationId: null,
    lastFailureAt: null,
    ...overrides,
  };
}

describe("the scheduled path, day by day", () => {
  it("is pre-due before the due date", () => {
    const evaluation = evaluateRotationPolicy(policy(), at(364));
    expect(evaluation.state).toBe("pre-due");
    expect(evaluation.writesAllowed).toBe(true);
  });

  it("becomes due exactly at the due instant, not a millisecond later", () => {
    // The boundary is inclusive. A policy that waited for "strictly after"
    // would spend the whole due day reporting itself healthy.
    const before = evaluateRotationPolicy(policy(), at(365, -1));
    const on = evaluateRotationPolicy(policy(), at(365));
    expect(before.state).toBe("pre-due");
    expect(on.state).not.toBe("pre-due");
  });

  it("stays writable throughout the grace period", () => {
    // The grace period exists so an operator is warned rather than surprised.
    // Blocking on the due date would make the warning and the outage the same
    // event.
    for (let day = 365; day < 365 + SCHEDULED_ROTATION_GRACE_DAYS; day += 1) {
      const evaluation = evaluateRotationPolicy(policy(), at(day));
      expect(evaluation.writesAllowed).toBe(true);
      expect(evaluation.state).not.toBe("write-block");
    }
  });

  it("blocks writes the instant the grace period ends", () => {
    const blockAt = 365 + SCHEDULED_ROTATION_GRACE_DAYS;
    const before = evaluateRotationPolicy(policy(), at(blockAt, -1));
    const on = evaluateRotationPolicy(policy(), at(blockAt));

    expect(before.writesAllowed).toBe(true);
    expect(on.writesAllowed).toBe(false);
    expect(on.state).toBe("write-block");
  });

  it("counts down the days remaining before the block", () => {
    // What an operator actually reads. A count that went negative or stopped
    // at zero would be useless on the day it matters most.
    const evaluation = evaluateRotationPolicy(policy(), at(365));
    expect(evaluation.daysUntilWriteBlock).toBe(SCHEDULED_ROTATION_GRACE_DAYS);
  });
});

describe("an emergency rotation gets no grace", () => {
  it("blocks writes at the due instant itself", () => {
    // The whole premise is that the current material is suspect, so continuing
    // to write under it *is* the risk a grace period would extend.
    const emergency = policy({ mode: "emergency", dueAt: at(10) });
    expect(computeWriteBlockAt(at(10), "emergency").getTime()).toBe(at(10).getTime());

    expect(evaluateRotationPolicy(emergency, at(10, -1)).writesAllowed).toBe(true);
    expect(evaluateRotationPolicy(emergency, at(10)).writesAllowed).toBe(false);
  });

  it("differs from a scheduled policy with the same due date", () => {
    const due = at(10);
    const scheduled = evaluateRotationPolicy(policy({ mode: "scheduled", dueAt: due }), at(11));
    const emergency = evaluateRotationPolicy(policy({ mode: "emergency", dueAt: due }), at(11));

    expect(scheduled.writesAllowed).toBe(true);
    expect(emergency.writesAllowed).toBe(false);
  });
});

describe("a running or failed operation", () => {
  it("reports in-progress while an operation is open", () => {
    const running = policy({ operationId: "op-1" });
    const evaluation = evaluateRotationPolicy(running, at(366));
    expect(evaluation.state).toBe("in-progress");
    expect(evaluation.nextAction).toBe("resume-rotation");
  });

  it("does not lift a block that was already reached", () => {
    // Starting a rotation is not the same as finishing one. Releasing the
    // block on start would let an operator unblock writes by beginning a
    // rotation they never complete.
    const running = policy({ operationId: "op-1" });
    const evaluation = evaluateRotationPolicy(running, at(365 + SCHEDULED_ROTATION_GRACE_DAYS + 1));
    expect(evaluation.state).toBe("in-progress");
    expect(evaluation.writesAllowed).toBe(false);
  });

  it("reports failed, and keeps writes flowing until the block is reached", () => {
    // A failed rotation is not itself a reason to stop writes: the deadline
    // is. Otherwise one transient failure would take the installation down.
    const failed = policy({ lastFailureAt: at(366) });
    const evaluation = evaluateRotationPolicy(failed, at(367));
    expect(evaluation.state).toBe("failed");
    expect(evaluation.nextAction).toBe("retry-rotation");
    expect(evaluation.writesAllowed).toBe(true);
  });

  it("still blocks a failed policy once its deadline passes", () => {
    const failed = policy({ lastFailureAt: at(366) });
    const evaluation = evaluateRotationPolicy(failed, at(365 + SCHEDULED_ROTATION_GRACE_DAYS));
    expect(evaluation.writesAllowed).toBe(false);
  });
});

describe("the two policies are configured independently", () => {
  it("evaluates a data-key policy on its own dates", () => {
    // FR-025 keeps them separate so a workspace with a healthy wrapping key
    // and an overdue data key is reported as what it is.
    const dataKey = policy({ kind: "data-key", dueAt: at(30) });
    const wrapping = policy({ kind: "wrapping-key", dueAt: at(365) });

    expect(evaluateRotationPolicy(dataKey, at(31)).state).not.toBe("pre-due");
    expect(evaluateRotationPolicy(wrapping, at(31)).state).toBe("pre-due");
  });

  it("carries its own generation rather than a shared counter", () => {
    const dataKey = policy({ kind: "data-key", currentGeneration: 4 });
    expect(evaluateRotationPolicy(dataKey, at(1)).currentGeneration).toBe(4);
  });
});

describe("reads are never affected", () => {
  it("stays readable in every state, including write-block", () => {
    // The one guarantee that must survive every branch above: a late rotation
    // is a housekeeping problem, and an owner who cannot read their own
    // workspace because of a calendar has been failed by the design.
    const cases: [string, KeyRotationPolicy, Date][] = [
      ["pre-due", policy(), at(1)],
      ["due", policy(), at(365)],
      ["grace", policy(), at(366)],
      ["write-block", policy(), at(365 + SCHEDULED_ROTATION_GRACE_DAYS)],
      ["in-progress", policy({ operationId: "op" }), at(366)],
      ["failed", policy({ lastFailureAt: at(366) }), at(367)],
      ["emergency", policy({ mode: "emergency", dueAt: at(5) }), at(6)],
    ];

    for (const [, subject, now] of cases) {
      // `evaluateRotationPolicy` reports writes only; reads have no gate here,
      // and this asserts none was introduced by any branch.
      expect(evaluateRotationPolicy(subject, now)).toHaveProperty("writesAllowed");
      expect(evaluateRotationPolicy(subject, now)).not.toHaveProperty("readsAllowed");
    }
  });
});
