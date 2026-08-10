/**
 * Singleton installation and rotation-policy invariants (T010, feature 002).
 *
 * The properties that must hold for every state and every clock instant:
 *
 *   - an installation reports `0/0` in every uninitialized state and `1/1` in
 *     every initialized state, with no third possibility;
 *   - a mismatched pair — an owner with no workspace, or the reverse — is
 *     always rejected, whichever state claims to be in force;
 *   - reads of valid existing ciphertext stay available in *every* rotation
 *     policy state, including `write-block`;
 *   - only `write-block` refuses new protected writes, and a failed rotation
 *     never postpones its own deadline.
 */
import {
  assertInstallationCounts,
  assertRotationMayStart,
  canStartRotation,
  checkInstallationCounts,
  completeRotation,
  computeWriteBlockAt,
  evaluateRotationPolicy,
  failRotation,
  INITIALIZED_COUNTS,
  INITIALIZED_INSTALLATION_STATES,
  INSTALLATION_STATES,
  InstallationInvariantError,
  isInitializedState,
  isUninitializedState,
  KEY_POLICY_STATES,
  type KeyRotationPolicy,
  protectedOperationsAvailable,
  RotationConflictError,
  readsAllowedInState,
  SCHEDULED_ROTATION_GRACE_DAYS,
  sessionsPermitted,
  UNINITIALIZED_COUNTS,
  UNINITIALIZED_INSTALLATION_STATES,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const CLOCK_ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const DAY = 86_400_000;

function daysAfterOrigin(days: number): Date {
  return new Date(CLOCK_ORIGIN.getTime() + days * DAY);
}

describe("installation state and committed counts", () => {
  it("partitions every state into exactly one of uninitialized or initialized", () => {
    for (const state of INSTALLATION_STATES) {
      expect(isInitializedState(state) !== isUninitializedState(state), state).toBe(true);
    }
    expect(UNINITIALIZED_INSTALLATION_STATES.length + INITIALIZED_INSTALLATION_STATES.length).toBe(
      INSTALLATION_STATES.length,
    );
  });

  it("requires 0/0 before the atomic promotion", () => {
    for (const state of UNINITIALIZED_INSTALLATION_STATES) {
      expect(checkInstallationCounts(state, UNINITIALIZED_COUNTS), state).toEqual([]);
    }
  });

  it("requires 1/1 in every initialized state, degraded included", () => {
    // `degraded` still has an owner: an unavailable key does not un-own the
    // installation, it only fails protected operations closed.
    for (const state of INITIALIZED_INSTALLATION_STATES) {
      expect(checkInstallationCounts(state, INITIALIZED_COUNTS), state).toEqual([]);
    }
  });

  it("rejects every mismatched pair, in every state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INSTALLATION_STATES),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (state, ownerCount, workspaceCount) => {
          const expected = isInitializedState(state) ? 1 : 0;
          const valid = ownerCount === expected && workspaceCount === expected;
          expect(
            checkInstallationCounts(state, { ownerCount, workspaceCount }).length === 0,
            `${state} ${ownerCount}/${workspaceCount}`,
          ).toBe(valid);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("names a partial installation as a broken atomic promotion", () => {
    const problems = checkInstallationCounts("ready", { ownerCount: 1, workspaceCount: 0 });
    expect(problems.join(" ")).toContain("atomic");
  });

  it("never admits a second owner or workspace", () => {
    for (const state of INSTALLATION_STATES) {
      expect(checkInstallationCounts(state, { ownerCount: 2, workspaceCount: 2 })).not.toEqual([]);
    }
  });

  it("throws with the offending state and counts attached", () => {
    try {
      assertInstallationCounts("ready", { ownerCount: 0, workspaceCount: 0 });
      throw new Error("expected an invariant failure");
    } catch (error) {
      expect(error).toBeInstanceOf(InstallationInvariantError);
      expect((error as InstallationInvariantError).state).toBe("ready");
      expect((error as InstallationInvariantError).counts.ownerCount).toBe(0);
    }
  });
});

describe("state-gated capabilities", () => {
  it("permits protected operations only when ready or migrating", () => {
    for (const state of INSTALLATION_STATES) {
      expect(protectedOperationsAvailable(state), state).toBe(
        state === "ready" || state === "migration-in-progress",
      );
    }
  });

  it("never permits a session before the owner exists", () => {
    for (const state of UNINITIALIZED_INSTALLATION_STATES) {
      expect(sessionsPermitted(state), state).toBe(false);
    }
  });

  it("refuses sessions while degraded", () => {
    expect(sessionsPermitted("degraded")).toBe(false);
    expect(sessionsPermitted("ready")).toBe(true);
  });
});

describe("rotation policy", () => {
  function policy(overrides: Partial<KeyRotationPolicy> = {}): KeyRotationPolicy {
    const dueAt = overrides.dueAt ?? daysAfterOrigin(30);
    const mode = overrides.mode ?? "scheduled";
    return {
      kind: "data-key",
      mode,
      currentGeneration: 1,
      dueAt,
      lastCompletedAt: CLOCK_ORIGIN,
      writeBlockAt: computeWriteBlockAt(dueAt, mode),
      operationId: null,
      lastFailureAt: null,
      ...overrides,
    };
  }

  it("gives a scheduled rotation seven calendar days of grace and emergency none", () => {
    const dueAt = daysAfterOrigin(30);
    expect(computeWriteBlockAt(dueAt, "scheduled").getTime()).toBe(
      dueAt.getTime() + SCHEDULED_ROTATION_GRACE_DAYS * DAY,
    );
    expect(computeWriteBlockAt(dueAt, "emergency").getTime()).toBe(dueAt.getTime());
  });

  it("keeps reads available in every policy state", () => {
    // The core judgement: a late rotation must never lock the owner out of
    // their own data.
    for (const state of KEY_POLICY_STATES) {
      expect(readsAllowedInState(state), state).toBe(true);
    }
  });

  it("walks pre-due to due to overdue-within-grace to write-block", () => {
    const subject = policy();
    const at = (days: number) => evaluateRotationPolicy(subject, daysAfterOrigin(days));

    expect(at(29).state).toBe("pre-due");
    expect(at(30).state).toBe("due");
    expect(at(31).state).toBe("overdue-within-grace");
    expect(at(36).state).toBe("overdue-within-grace");
    expect(at(37).state).toBe("write-block");
    expect(at(100).state).toBe("write-block");
  });

  it("refuses new writes only once the write block is reached", () => {
    const subject = policy();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), (day) => {
        const evaluation = evaluateRotationPolicy(subject, daysAfterOrigin(day));
        expect(evaluation.writesAllowed).toBe(day < 37);
        expect(evaluation.writesAllowed).toBe(evaluation.state !== "write-block");
      }),
      { numRuns: 60 },
    );
  });

  it("blocks an emergency rotation's writes the instant it becomes due", () => {
    const subject = policy({ mode: "emergency", dueAt: daysAfterOrigin(10) });
    expect(evaluateRotationPolicy(subject, daysAfterOrigin(9)).writesAllowed).toBe(true);
    expect(evaluateRotationPolicy(subject, daysAfterOrigin(10)).state).toBe("write-block");
    expect(evaluateRotationPolicy(subject, daysAfterOrigin(10)).writesAllowed).toBe(false);
  });

  it("reports an in-flight operation ahead of any date-derived state", () => {
    const subject = policy({ operationId: "018f2b7c-0000-7000-8000-000000000001" });
    const evaluation = evaluateRotationPolicy(subject, daysAfterOrigin(35));
    expect(evaluation.state).toBe("in-progress");
    expect(evaluation.nextAction).toBe("resume-rotation");
  });

  it("does not lift an existing write block just because a rotation started", () => {
    const subject = policy({ operationId: "018f2b7c-0000-7000-8000-000000000001" });
    expect(evaluateRotationPolicy(subject, daysAfterOrigin(40)).writesAllowed).toBe(false);
  });

  it("reports a failed rotation and asks for a retry", () => {
    const subject = policy({ lastFailureAt: daysAfterOrigin(31) });
    const evaluation = evaluateRotationPolicy(subject, daysAfterOrigin(32));
    expect(evaluation.state).toBe("failed");
    expect(evaluation.nextAction).toBe("retry-rotation");
  });

  it("never lets a failed rotation postpone its own deadline", () => {
    const subject = policy();
    const failed = failRotation(subject, daysAfterOrigin(31));
    expect(failed.dueAt).toEqual(subject.dueAt);
    expect(failed.writeBlockAt).toEqual(subject.writeBlockAt);
    expect(failed.currentGeneration).toBe(subject.currentGeneration);
    // The block still lands on schedule despite the failure.
    expect(evaluateRotationPolicy(failed, daysAfterOrigin(37)).writesAllowed).toBe(false);
  });

  it("advances the generation and restarts the clock on completion", () => {
    const subject = policy();
    const completed = completeRotation(subject, daysAfterOrigin(31), daysAfterOrigin(61));
    expect(completed.currentGeneration).toBe(2);
    expect(completed.lastCompletedAt).toEqual(daysAfterOrigin(31));
    expect(completed.writeBlockAt).toEqual(daysAfterOrigin(61 + SCHEDULED_ROTATION_GRACE_DAYS));
    expect(completed.operationId).toBeNull();
    expect(completed.lastFailureAt).toBeNull();
    expect(evaluateRotationPolicy(completed, daysAfterOrigin(32)).state).toBe("pre-due");
  });

  it("clears a previous failure once a retry completes", () => {
    const failed = failRotation(policy(), daysAfterOrigin(31));
    const completed = completeRotation(failed, daysAfterOrigin(32), daysAfterOrigin(62));
    expect(evaluateRotationPolicy(completed, daysAfterOrigin(33)).state).toBe("pre-due");
  });

  it("allows at most one operation per policy", () => {
    const idle = policy();
    expect(canStartRotation(idle)).toBe(true);
    expect(() => assertRotationMayStart(idle)).not.toThrow();

    const running = policy({ operationId: "018f2b7c-0000-7000-8000-000000000001" });
    expect(canStartRotation(running)).toBe(false);
    expect(() => assertRotationMayStart(running)).toThrow(RotationConflictError);
  });

  it("keeps wrapping-key and data-key policies independent", () => {
    const dataKeyRunning = policy({
      kind: "data-key",
      operationId: "018f2b7c-0000-7000-8000-000000000001",
    });
    const wrappingKeyIdle = policy({ kind: "wrapping-key" });
    expect(canStartRotation(dataKeyRunning)).toBe(false);
    expect(canStartRotation(wrappingKeyIdle)).toBe(true);
  });

  it("always reports a state from the declared vocabulary", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom("scheduled" as const, "emergency" as const),
        (day, running, failedBefore, mode) => {
          const dueAt = daysAfterOrigin(30);
          const subject = policy({
            mode,
            dueAt,
            writeBlockAt: computeWriteBlockAt(dueAt, mode),
            operationId: running ? "018f2b7c-0000-7000-8000-000000000001" : null,
            lastFailureAt: failedBefore ? daysAfterOrigin(1) : null,
          });
          const evaluation = evaluateRotationPolicy(subject, daysAfterOrigin(day));
          expect(KEY_POLICY_STATES).toContain(evaluation.state);
        },
      ),
      { numRuns: 120 },
    );
  });
});
