/**
 * Data-key generation rotation invariants (T084, US5, FR-017, FR-018).
 *
 * This rotation re-encrypts the workspace, progressively, over what may be a
 * very long time. That leaves one irreversible mistake available: revoking the
 * old generation while records are still sealed under it. Those records become
 * permanently unreadable, and the rotation destroys exactly what it was meant
 * to protect.
 *
 * So the tests are built around the states that keep the old generation usable
 * while the sweep runs, and around the guard that refuses to revoke early.
 */

import {
  advanceDataKeyRotation,
  allowedGenerationTransitions,
  canTransitionGeneration,
  DataKeyRotationError,
  type DataKeyRotationProgress,
  generationPermitsRead,
  generationPermitsWrite,
  mayRevokeGeneration,
  planDataKeyRotation,
  rotationCompletion,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const anyGeneration = fc.constantFrom("current", "decrypt-only", "revoked" as const);

function plan(totalCount = 10): DataKeyRotationProgress {
  return planDataKeyRotation({
    operationId: "op-1",
    fromGeneration: 1,
    toGeneration: 2,
    totalCount,
  });
}

describe("the old generation stays readable while the sweep runs", () => {
  it("permits reads in every state but revoked", () => {
    // `decrypt-only` exists for exactly this: half the workspace is still
    // sealed under the old generation while the rewrite proceeds.
    expect(generationPermitsRead("current")).toBe(true);
    expect(generationPermitsRead("decrypt-only")).toBe(true);
    expect(generationPermitsRead("revoked")).toBe(false);
  });

  it("permits writes only under the current generation", () => {
    // New writes move to the new generation immediately. Waiting for the
    // rewrite would mean months of writes under a generation the operator is
    // trying to retire.
    expect(generationPermitsWrite("current")).toBe(true);
    expect(generationPermitsWrite("decrypt-only")).toBe(false);
    expect(generationPermitsWrite("revoked")).toBe(false);
  });

  it("never permits a write where it does not permit a read", () => {
    // The two rules must not disagree: a generation that can be written but
    // not read would produce records nothing can open.
    fc.assert(
      fc.property(anyGeneration, (state) => {
        if (generationPermitsWrite(state)) {
          expect(generationPermitsRead(state)).toBe(true);
        }
      }),
    );
  });
});

describe("a generation only moves one way", () => {
  it("goes current, then decrypt-only, then revoked", () => {
    expect(allowedGenerationTransitions("current")).toEqual(["decrypt-only"]);
    expect(allowedGenerationTransitions("decrypt-only")).toEqual(["revoked"]);
    expect(allowedGenerationTransitions("revoked")).toEqual([]);
  });

  it("never returns to current", () => {
    // Returning would resume new writes under a generation the operator
    // already decided to move away from.
    fc.assert(
      fc.property(anyGeneration, (from) => {
        if (from !== "current") {
          expect(canTransitionGeneration(from, "current")).toBe(false);
        }
      }),
    );
  });

  it("cannot skip decrypt-only", () => {
    // The dangerous shortcut: going straight to revoked while records are
    // still sealed under it.
    expect(canTransitionGeneration("current", "revoked")).toBe(false);
  });
});

describe("revoking early is refused", () => {
  it("permits revocation only when nothing remains under the old generation", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (remaining) => {
        expect(
          mayRevokeGeneration({ progress: plan(), remainingUnderOldGeneration: remaining }),
        ).toBe(false);
      }),
    );
    expect(mayRevokeGeneration({ progress: plan(), remainingUnderOldGeneration: 0 })).toBe(true);
  });

  it("asks the store rather than trusting the count", () => {
    // A progress count that reached its total is not proof: the workspace
    // stays writable during the rotation, so the total can grow underneath.
    // Only "nothing remains" is a definite answer.
    const finished = advanceDataKeyRotation(plan(1), { cursor: "a", rewritten: 1 });
    expect(rotationCompletion(finished)).toBe(1);
    expect(mayRevokeGeneration({ progress: finished, remainingUnderOldGeneration: 3 })).toBe(false);
  });
});

describe("progress moves forward", () => {
  it("refuses a cursor that goes backwards", () => {
    // Harmless in isolation, but it hides something producing stale positions
    // — and on a long rotation that can mean the sweep never terminates.
    const started = advanceDataKeyRotation(plan(), { cursor: "b", rewritten: 1 });
    expect(() => advanceDataKeyRotation(started, { cursor: "a", rewritten: 1 })).toThrow(
      DataKeyRotationError,
    );
  });

  it("accumulates what each batch rewrote", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 10 }),
        (batches) => {
          let progress = plan(1_000);
          batches.forEach((rewritten, index) => {
            progress = advanceDataKeyRotation(progress, {
              // Padded so ordering is lexicographic, as a real cursor would be.
              cursor: String(index + 1).padStart(6, "0"),
              rewritten,
            });
          });
          expect(progress.rewrittenCount).toBe(batches.reduce((sum, n) => sum + n, 0));
        },
      ),
    );
  });

  it("lets the total grow rather than reporting more than 100 per cent", () => {
    // The workspace stays writable, so records can be written under the old
    // generation before the sweep reaches them.
    let progress = plan(1);
    progress = advanceDataKeyRotation(progress, { cursor: "a", rewritten: 5 });
    expect(progress.totalCount).toBeGreaterThanOrEqual(progress.rewrittenCount);
    expect(rotationCompletion(progress)).toBeLessThanOrEqual(1);
  });
});

describe("planning", () => {
  it("refuses a generation that does not advance", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 1 }), (toGeneration) => {
        expect(() =>
          planDataKeyRotation({
            operationId: "op",
            fromGeneration: 1,
            toGeneration,
            totalCount: 1,
          }),
        ).toThrow(DataKeyRotationError);
      }),
    );
  });

  it("reports an empty workspace as already complete", () => {
    // Not as a division by zero, and not as zero per cent — there is nothing
    // to rewrite, so the rotation has nothing left to do.
    expect(rotationCompletion(plan(0))).toBe(1);
  });
});
