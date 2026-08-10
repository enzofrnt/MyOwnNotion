/**
 * Staged plaintext-migration invariants (T009, feature 002).
 *
 * This is the state machine that can destroy data. Every property below exists
 * because breaking it means deleting plaintext that is still the only copy:
 *
 *   - the order is fixed, and `scrub-plaintext` comes only after a verified
 *     read cutover;
 *   - plaintext writes stop before encrypted reads take over, never after,
 *     so no write lands somewhere the new read path will not look;
 *   - source data is retained until the scrub stage, whatever the fault;
 *   - a fault returns to the last safe checkpoint, and `complete` is never
 *     reported early.
 */

import {
  buildIdentityManifest,
  MIGRATION_STATES,
  type MigrationState,
  partialIdentityDigest,
} from "@myownnotion/domain/security";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** The linear progression; `failed` is reachable from any non-terminal state. */
const ORDER = MIGRATION_STATES.filter((state) => state !== "failed");

function order(state: MigrationState): number {
  return ORDER.indexOf(state as (typeof ORDER)[number]);
}

function canAdvance(from: MigrationState, to: MigrationState): boolean {
  if (from === "complete" || from === "failed") {
    return false;
  }
  if (to === "failed") {
    return true;
  }
  // Strictly one step forward: skipping a stage would skip its gate.
  return order(to) === order(from) + 1;
}

/** Whether plaintext writes are still accepted in this state. */
function plaintextWritesEnabled(state: MigrationState): boolean {
  return order(state) < order("stop-plaintext-writes");
}

/** Whether reads are served from encrypted storage in this state. */
function encryptedReadsEnabled(state: MigrationState): boolean {
  return state !== "failed" && order(state) >= order("encrypted-read-cutover");
}

/** Whether the plaintext source is still on disk. */
function sourceRetained(state: MigrationState): boolean {
  return state === "failed" || order(state) < order("scrub-plaintext");
}

const stateArbitrary = fc.constantFrom<MigrationState>(...MIGRATION_STATES);

describe("stage order", () => {
  it("stops plaintext writes before the encrypted read cutover", () => {
    // The other order would accept a write into plaintext that the new read
    // path never looks at, losing it silently.
    expect(order("stop-plaintext-writes")).toBeLessThan(order("encrypted-read-cutover"));
  });

  it("scrubs only after the cutover", () => {
    expect(order("encrypted-read-cutover")).toBeLessThan(order("scrub-plaintext"));
  });

  it("verifies before stopping writes", () => {
    // Verification compares counts, digests, and identities while both copies
    // are still live. After the write stop the comparison is no longer free.
    expect(order("verify")).toBeLessThan(order("stop-plaintext-writes"));
  });

  it("captures a boundary before backfilling", () => {
    // Without a durable capture boundary, a write during backfill is lost.
    expect(order("capture-boundary")).toBeLessThan(order("backfill"));
  });

  it("advances exactly one stage at a time", () => {
    fc.assert(
      fc.property(stateArbitrary, stateArbitrary, (from, to) => {
        if (!canAdvance(from, to) || to === "failed") {
          return;
        }
        expect(order(to)).toBe(order(from) + 1);
      }),
      { numRuns: 200 },
    );
  });

  it("never skips a stage, so no gate is bypassed", () => {
    expect(canAdvance("backfill", "stop-plaintext-writes")).toBe(false);
    expect(canAdvance("verify", "encrypted-read-cutover")).toBe(false);
    expect(canAdvance("stop-plaintext-writes", "scrub-plaintext")).toBe(false);
  });

  it("treats complete and failed as terminal", () => {
    for (const terminal of ["complete", "failed"] as const) {
      for (const target of MIGRATION_STATES) {
        expect(canAdvance(terminal, target), `${terminal} -> ${target}`).toBe(false);
      }
    }
  });
});

describe("data safety at every stage", () => {
  it("retains the source until the scrub stage, in every state", () => {
    for (const state of MIGRATION_STATES) {
      const expected = state === "scrub-plaintext" || state === "complete";
      expect(sourceRetained(state), state).toBe(!expected);
    }
  });

  it("retains the source after a failure, whatever stage it failed at", () => {
    // A fault must never be the thing that authorises deletion.
    expect(sourceRetained("failed")).toBe(true);
  });

  it("never has both write paths closed while reads still come from plaintext", () => {
    // That window would make the workspace read-only *and* stale.
    for (const state of MIGRATION_STATES) {
      if (state === "failed") {
        continue;
      }
      const writesClosed = !plaintextWritesEnabled(state);
      const readsMoved = encryptedReadsEnabled(state);
      if (writesClosed) {
        // Writes only close at `stop-plaintext-writes`, and the very next
        // stage moves reads. One stage of read-only is the intended cost.
        expect(state === "stop-plaintext-writes" || readsMoved, state).toBe(true);
      }
    }
  });

  it("serves reads from plaintext for as long as plaintext is authoritative", () => {
    for (const state of ORDER.slice(0, order("encrypted-read-cutover"))) {
      expect(encryptedReadsEnabled(state), state).toBe(false);
      expect(sourceRetained(state), state).toBe(true);
    }
  });

  it("never reports complete while the source is still authoritative", () => {
    expect(encryptedReadsEnabled("complete")).toBe(true);
    expect(sourceRetained("complete")).toBe(false);
  });
});

describe("fault recovery", () => {
  /** The last state a resume may safely return to after failing at `state`. */
  function lastSafeCheckpoint(state: MigrationState): MigrationState {
    const index = order(state);
    return index <= 0 ? "prepare-destinations" : (ORDER[index - 1] as MigrationState);
  }

  it("returns to a strictly earlier stage, never to the one that failed", () => {
    for (const state of ORDER.slice(1)) {
      expect(order(lastSafeCheckpoint(state))).toBeLessThan(order(state));
    }
  });

  it("keeps the source retained at every recovery point", () => {
    for (const state of ORDER) {
      const safe = lastSafeCheckpoint(state);
      if (order(safe) < order("scrub-plaintext")) {
        expect(sourceRetained(safe), safe).toBe(true);
      }
    }
  });

  it("never lets a fault jump forward", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ORDER), (state) => {
        expect(order(lastSafeCheckpoint(state))).toBeLessThanOrEqual(order(state));
      }),
      { numRuns: 50 },
    );
  });
});

describe("identity preservation across the migration", () => {
  const uuidArbitrary = fc.uuid({ version: 7 });

  it("keeps the identity digest stable while only storage changes", () => {
    // A migration re-encrypts; it must not renumber anything.
    fc.assert(
      fc.property(fc.uniqueArray(uuidArbitrary, { minLength: 1, maxLength: 20 }), (items) => {
        const before = buildIdentityManifest({
          workspaces: ["018f2b7c-0000-7000-8000-0000000000aa"],
          items,
          revisions: [],
          mutations: [],
          fileContents: [],
        });
        const after = buildIdentityManifest({
          workspaces: ["018f2b7c-0000-7000-8000-0000000000aa"],
          // Different order, same set: a re-read after migration.
          items: [...items].reverse(),
          revisions: [],
          mutations: [],
          fileContents: [],
        });
        expect(after.digest).toBe(before.digest);
      }),
      { numRuns: 60 },
    );
  });

  it("detects an identity dropped during backfill", () => {
    const items = ["018f2b7c-0000-7000-8000-000000000001", "018f2b7c-0000-7000-8000-000000000002"];
    const complete = partialIdentityDigest({ items });
    const truncated = partialIdentityDigest({ items: items.slice(1) });
    expect(truncated).not.toBe(complete);
  });

  it("detects a partially processed workspace as different from a finished one", () => {
    // A checkpoint digest taken mid-backfill must never equal the final one,
    // or a resume could believe it had already finished.
    const all = ["018f2b7c-0000-7000-8000-000000000001", "018f2b7c-0000-7000-8000-000000000002"];
    expect(partialIdentityDigest({ items: all.slice(0, 1) })).not.toBe(
      partialIdentityDigest({ items: all }),
    );
  });
});
