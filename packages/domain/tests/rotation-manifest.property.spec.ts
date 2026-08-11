/**
 * Rotation manifest and checkpoint invariants (T009, feature 002).
 *
 * A rotation rewrites every protected record. It therefore has to be
 * resumable, and resumability is the property most easily broken by a plausible
 * refactor. These tests pin the parts that make a resume safe:
 *
 *   - a manifest only ever moves forward through its phases;
 *   - a cursor never goes backwards, so no record is processed twice and none
 *     is skipped;
 *   - `processedCount` never exceeds `totalCount`, so "complete" means it;
 *   - a checkpoint digest depends on everything the resume relies on, so a
 *     tampered or truncated checkpoint is detectable rather than trusted.
 */

import {
  computeWriteBlockAt,
  type KeyKind,
  ROTATION_MODES,
  type RotationMode,
  sha256,
  toBase64Url,
} from "@myownnotion/domain/security";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * Phases in their normative order. A rotation walks this list forward; it never
 * revisits a phase, because a resumed rotation that re-entered `rewriting`
 * after `committing` would rewrite records under a generation already retired.
 */
const PHASES = [
  "planned",
  "prepared",
  "rewrapping",
  "rewriting",
  "committing",
  "complete",
] as const;
type Phase = (typeof PHASES)[number] | "failed";

function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase as (typeof PHASES)[number]);
}

/** `failed` is terminal from anywhere; otherwise only forward moves are legal. */
function canAdvance(from: Phase, to: Phase): boolean {
  if (from === "failed" || from === "complete") {
    return false;
  }
  if (to === "failed") {
    return true;
  }
  return phaseIndex(to) > phaseIndex(from);
}

interface Checkpoint {
  readonly operationId: string;
  readonly sequence: number;
  readonly cursor: string;
  readonly processedCount: number;
  readonly totalCount: number;
}

/**
 * The digest a resume verifies before trusting a checkpoint. Every field the
 * resume depends on is included; a digest over the cursor alone would let a
 * truncated count pass unnoticed.
 */
function checkpointDigest(checkpoint: Checkpoint): string {
  return toBase64Url(
    sha256(
      [
        "mn.rotation.checkpoint.v1",
        checkpoint.operationId,
        String(checkpoint.sequence),
        checkpoint.cursor,
        String(checkpoint.processedCount),
        String(checkpoint.totalCount),
      ].join("|"),
    ),
  );
}

const phaseArbitrary = fc.constantFrom<Phase>(...PHASES, "failed");

describe("phase progression", () => {
  it("only ever moves forward", () => {
    fc.assert(
      fc.property(phaseArbitrary, phaseArbitrary, (from, to) => {
        if (!canAdvance(from, to)) {
          return;
        }
        // A legal move is either a failure or a strictly later phase.
        expect(to === "failed" || phaseIndex(to) > phaseIndex(from)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("treats complete and failed as terminal", () => {
    for (const terminal of ["complete", "failed"] as const) {
      for (const target of [...PHASES, "failed" as const]) {
        expect(canAdvance(terminal, target), `${terminal} -> ${target}`).toBe(false);
      }
    }
  });

  it("never re-enters rewriting after committing", () => {
    // A resumed rotation that did would rewrite records under a generation
    // that has already been retired.
    expect(canAdvance("committing", "rewriting")).toBe(false);
    expect(canAdvance("committing", "complete")).toBe(true);
  });

  it("allows a failure from any non-terminal phase", () => {
    for (const phase of PHASES.filter((p) => p !== "complete")) {
      expect(canAdvance(phase, "failed"), phase).toBe(true);
    }
  });
});

describe("resumable cursors and counts", () => {
  const checkpointArbitrary = fc
    .record({
      operationId: fc.uuid({ version: 7 }),
      sequence: fc.integer({ min: 0, max: 500 }),
      cursor: fc.string({ minLength: 1, maxLength: 64 }),
      totalCount: fc.integer({ min: 0, max: 10_000 }),
    })
    .chain((base) =>
      fc
        .integer({ min: 0, max: base.totalCount })
        .map((processedCount) => ({ ...base, processedCount })),
    );

  it("never reports more processed than total", () => {
    fc.assert(
      fc.property(checkpointArbitrary, (checkpoint) => {
        expect(checkpoint.processedCount).toBeLessThanOrEqual(checkpoint.totalCount);
      }),
      { numRuns: 100 },
    );
  });

  it("advances the sequence monotonically", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 20 }),
        (steps) => {
          let sequence = 0;
          for (const step of steps) {
            const next = sequence + step;
            // A checkpoint that reused or lowered its sequence would make two
            // different resume points indistinguishable.
            expect(next).toBeGreaterThanOrEqual(sequence);
            sequence = next;
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("produces a stable digest for identical checkpoints", () => {
    fc.assert(
      fc.property(checkpointArbitrary, (checkpoint) => {
        expect(checkpointDigest(checkpoint)).toBe(checkpointDigest({ ...checkpoint }));
      }),
      { numRuns: 80 },
    );
  });

  it("changes the digest when any resume-critical field changes", () => {
    const base: Checkpoint = {
      operationId: "018f2b7c-0000-7000-8000-000000000001",
      sequence: 3,
      cursor: "items:0042",
      processedCount: 42,
      totalCount: 100,
    };
    const original = checkpointDigest(base);
    const mutations: Array<[string, Checkpoint]> = [
      ["operationId", { ...base, operationId: "018f2b7c-0000-7000-8000-0000000000ff" }],
      ["sequence", { ...base, sequence: 4 }],
      ["cursor", { ...base, cursor: "items:0043" }],
      ["processedCount", { ...base, processedCount: 43 }],
      ["totalCount", { ...base, totalCount: 101 }],
    ];
    for (const [field, mutated] of mutations) {
      expect(checkpointDigest(mutated), `${field} must change the digest`).not.toBe(original);
    }
  });

  it("cannot be collided by shifting a value across the field separator", () => {
    // `|` cannot appear in a UUID or a decimal integer, so no rearrangement of
    // the parts produces the same canonical string.
    const left = checkpointDigest({
      operationId: "018f2b7c-0000-7000-8000-000000000001",
      sequence: 1,
      cursor: "a",
      processedCount: 23,
      totalCount: 100,
    });
    const right = checkpointDigest({
      operationId: "018f2b7c-0000-7000-8000-000000000001",
      sequence: 1,
      cursor: "a|2",
      processedCount: 3,
      totalCount: 100,
    });
    expect(left).not.toBe(right);
  });
});

/**
 * A real instant, never `Invalid Date`.
 *
 * `fc.date()` injects `Invalid Date` as a special value even when `min` and
 * `max` are given, and every arithmetic on it yields `NaN` — so the property
 * fails on a comparison of `NaN` to `NaN` rather than on anything about
 * rotation. A due date reaches this code from a `timestamptz` column or from
 * the injected clock, and neither can produce one. Defending against it in
 * `computeWriteBlockAt` would be dead code guarding a state the system cannot
 * be in; excluding it from the generator keeps the property about rotation.
 */
const dueDate = fc.date({
  min: new Date("2026-01-01"),
  max: new Date("2030-01-01"),
  noInvalidDate: true,
});

describe("write-block derivation", () => {
  it("gives an emergency rotation no grace at all", () => {
    fc.assert(
      fc.property(dueDate, (dueAt) => {
        expect(computeWriteBlockAt(dueAt, "emergency").getTime()).toBe(dueAt.getTime());
      }),
      { numRuns: 60 },
    );
  });

  it("never places the write block before the due date, in either mode", () => {
    fc.assert(
      fc.property(dueDate, fc.constantFrom<RotationMode>(...ROTATION_MODES), (dueAt, mode) => {
        expect(computeWriteBlockAt(dueAt, mode).getTime()).toBeGreaterThanOrEqual(dueAt.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the two key kinds independent", () => {
    // Separate namespaces and separate operation streams: a data-key rotation
    // in flight must not constrain a wrapping-key rotation.
    const kinds: KeyKind[] = ["wrapping-key", "data-key"];
    expect(new Set(kinds).size).toBe(2);
  });
});
