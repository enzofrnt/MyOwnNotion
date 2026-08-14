/**
 * The staged plaintext-to-encrypted migration (T095, US6, FR-028, FR-029).
 *
 * This is the state machine that can destroy data. Every other module in this
 * package can be wrong in ways that refuse a request; this one can be wrong in
 * a way that deletes the only copy of someone's notes.
 *
 * So the design is built around a single ordering claim:
 *
 *   prepare-destinations → capture-boundary → backfill → verify →
 *   stop-plaintext-writes → encrypted-read-cutover → scrub-plaintext → complete
 *
 * and three gates inside it, each of which exists because the obvious
 * shortcut past it loses data:
 *
 *   1. **Plaintext writes stop before encrypted reads take over, never
 *      after.** In the other order there is a window where a write lands in
 *      plaintext storage that the new read path no longer consults — the
 *      record is not lost, but it is invisible, which an owner cannot tell
 *      apart from lost.
 *   2. **The scrub comes only after a verified read cutover.** Deleting the
 *      source before the encrypted copy has actually served a read means
 *      discovering the copy is wrong at the moment the original is gone.
 *   3. **A fault never advances and never scrubs.** `failed` is reachable from
 *      anywhere, retains the source, and returns the operation to its last
 *      safe checkpoint. A migration that tried to "finish" through an error is
 *      the one that ends with an empty workspace.
 *
 * Everything here is pure. The durable half — rows, checkpoints, the actual
 * backfill — lives in the database package and the API, and calls these
 * predicates rather than reimplementing them. That split matters: this file is
 * where the ordering is *stated*, and a second statement of it somewhere else
 * is a second thing that can be wrong.
 */

import { MIGRATION_STATES, type MigrationState } from "./types.ts";

export class MigrationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationStateError";
  }
}

/**
 * The linear progression, without `failed`.
 *
 * `failed` is deliberately outside the order: it is reachable from every
 * non-terminal state and comparable to none of them. Giving it a position
 * would make "further along than failed" a meaningful question, and it is not.
 */
export const MIGRATION_ORDER: readonly MigrationState[] = MIGRATION_STATES.filter(
  (state) => state !== "failed",
);

/** Position in the progression, or `-1` for `failed`. */
export function stageIndex(state: MigrationState): number {
  return MIGRATION_ORDER.indexOf(state);
}

export function isTerminal(state: MigrationState): boolean {
  return state === "complete" || state === "failed";
}

/**
 * Whether one state may follow another.
 *
 * **Strictly one step.** Skipping a stage skips its gate, and every gate here
 * is the thing standing between a migration and deleted data. A jump from
 * `backfill` to `scrub-plaintext` is not a faster migration; it is a data loss
 * with extra steps.
 */
export function canAdvance(from: MigrationState, to: MigrationState): boolean {
  if (isTerminal(from)) {
    // Both terminals are final. Resuming out of `failed` starts a new
    // operation from the last safe checkpoint rather than reanimating this one,
    // so that the row remains the record that an attempt failed.
    return false;
  }
  if (to === "failed") {
    return true;
  }
  return stageIndex(to) === stageIndex(from) + 1;
}

export function assertAdvance(from: MigrationState, to: MigrationState): void {
  if (!canAdvance(from, to)) {
    throw new MigrationStateError(`a migration may not move from ${from} to ${to}`);
  }
}

/**
 * Whether plaintext writes are still accepted.
 *
 * True right up to `stop-plaintext-writes`, and false from it onward. The
 * boundary is the stage itself, not the one after: a stage named for stopping
 * writes that still accepted them would be a label rather than a control.
 */
export function plaintextWritesEnabled(state: MigrationState): boolean {
  if (state === "failed") {
    // A failed migration leaves the installation on plaintext, which is where
    // its data still is. Refusing writes here would turn a stalled migration
    // into an outage.
    return true;
  }
  return stageIndex(state) < stageIndex("stop-plaintext-writes");
}

/**
 * Whether reads are served from encrypted storage.
 *
 * `failed` is false: a fault returns reads to the source, which is retained
 * precisely so this is possible.
 */
export function encryptedReadsEnabled(state: MigrationState): boolean {
  if (state === "failed") {
    return false;
  }
  return stageIndex(state) >= stageIndex("encrypted-read-cutover");
}

/**
 * Whether the plaintext source is still on disk.
 *
 * The most important predicate in the module. It is true everywhere except
 * after the scrub, including in `failed` — a migration that dropped the source
 * on its way to failing would have destroyed the thing that makes failure
 * survivable.
 */
export function sourceRetained(state: MigrationState): boolean {
  if (state === "failed") {
    return true;
  }
  return stageIndex(state) < stageIndex("scrub-plaintext");
}

/**
 * Whether the migration may scrub the plaintext source.
 *
 * Asks for a positive answer to every question rather than inferring one from
 * the stage, because this is the irreversible step and the stage alone is a
 * claim the caller made. Counts must match, the digests must match, and the
 * read cutover must have happened.
 */
export function mayScrubPlaintext(input: {
  state: MigrationState;
  sourceCount: number;
  destinationCount: number;
  sourceDigest: string | null;
  destinationDigest: string | null;
}): boolean {
  if (input.state !== "scrub-plaintext") {
    return false;
  }
  if (input.sourceCount !== input.destinationCount) {
    return false;
  }
  if (input.sourceDigest === null || input.destinationDigest === null) {
    // A missing digest is not a matching digest. Treating absence as agreement
    // is how an unverified migration passes its own verification.
    return false;
  }
  return input.sourceDigest === input.destinationDigest;
}

/**
 * Whether the migration may be reported complete.
 *
 * Deliberately strict, and deliberately not "the state says complete". The
 * state is what the last transition wrote; this asks whether the work behind
 * it was actually done. A migration reported complete with the source still on
 * disk has not finished — and the next operator will believe otherwise.
 */
export function mayReportComplete(input: {
  state: MigrationState;
  sourceRetained: boolean;
  destinationCount: number;
  sourceCount: number;
}): boolean {
  return (
    input.state === "complete" &&
    !input.sourceRetained &&
    input.destinationCount === input.sourceCount
  );
}

/**
 * The capture boundary: the point after which new writes are the encrypted
 * path's problem rather than the backfill's.
 *
 * Recorded as an opaque, ordered cursor rather than a timestamp. Two records
 * written in the same millisecond are ordered by a cursor and ambiguous by a
 * clock, and an ambiguous boundary means a record that neither side believes
 * it owns.
 */
export interface CaptureBoundary {
  readonly cursor: string;
  readonly capturedAt: Date;
}

export interface MigrationCheckpoint {
  readonly sequence: number;
  readonly state: MigrationState;
  readonly sourceCursor: string;
  readonly recordCount: number;
  readonly blobCount: number;
}

/**
 * Whether a checkpoint may follow another.
 *
 * Sequence and cursor must both move forward. A checkpoint that repeated a
 * position would make a resume re-sweep ground it had covered — harmless in
 * itself, and a reliable sign that something is producing stale positions,
 * which on a long migration can mean it never terminates.
 */
export function checkpointAdvances(
  previous: MigrationCheckpoint | null,
  next: MigrationCheckpoint,
): boolean {
  if (previous === null) {
    return next.sequence >= 1;
  }
  if (next.sequence <= previous.sequence) {
    return false;
  }
  if (next.sourceCursor <= previous.sourceCursor) {
    return false;
  }
  // Counts are cumulative: a checkpoint reporting fewer records than the one
  // before it is describing a different migration, or a bug.
  return next.recordCount >= previous.recordCount && next.blobCount >= previous.blobCount;
}

/**
 * The state a fault returns to.
 *
 * Not the state the migration was in — the state of its last safe checkpoint.
 * The difference matters when a fault lands mid-stage: resuming at the stage
 * it had claimed to reach would skip the part of it that had not happened yet.
 */
export function resumeStateAfterFault(lastSafe: MigrationCheckpoint | null): MigrationState {
  return lastSafe?.state ?? "prepare-destinations";
}
