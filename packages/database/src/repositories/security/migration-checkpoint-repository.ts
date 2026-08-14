/**
 * Migration checkpoints (T095, US6, FR-028, FR-029).
 *
 * A migration of any real workspace will be interrupted. These rows are what
 * make that survivable, and they are **append-only**: each records where the
 * migration had reached, in sequence, and none is ever updated.
 *
 * Updating one in place would be smaller and would lose the thing that
 * matters. After an interruption the question is not "where is it now" — the
 * migration row answers that — but "did this restart resume, or did it quietly
 * begin again?" Only a history answers that, and only a history shows a
 * migration that has been restarting in a loop for an hour.
 *
 * Two unique indexes carry the real guarantees:
 *
 *   - **on `(migration, sequence)`**, so two processes cannot both write
 *     checkpoint 7 with different contents;
 *   - **on `(migration, idempotency key)`**, so a retried batch — the ordinary
 *     case when a commit succeeds and the acknowledgement is lost — records
 *     itself once rather than twice.
 *
 * A duplicate is therefore not an error to report upward. It is the retry
 * working as intended, and this module treats it that way.
 */

import type { MigrationState } from "@myownnotion/domain";
import { and, desc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { migrationCheckpoints } from "../../schema/security/index.ts";

type Executor = Database | Transaction;

export interface MigrationCheckpointRecord {
  readonly id: string;
  readonly migrationId: string;
  readonly sequence: number;
  readonly state: MigrationState;
  readonly sourceCursor: string;
  readonly destinationCursor: string;
  readonly recordCount: number;
  readonly blobCount: number;
  readonly identityDigest: string;
  readonly checkpointDigest: string;
  /** Set when a fault interrupted this checkpoint, for resume diagnostics. */
  readonly faultPoint: string | null;
}

type Row = typeof migrationCheckpoints.$inferSelect;

function toRecord(row: Row): MigrationCheckpointRecord {
  return {
    id: row.id,
    migrationId: row.migrationId,
    sequence: row.sequence,
    state: row.state as MigrationState,
    sourceCursor: row.sourceCursor,
    destinationCursor: row.destinationCursor,
    recordCount: row.recordCount,
    blobCount: row.blobCount,
    identityDigest: row.identityDigest,
    checkpointDigest: row.checkpointDigest,
    faultPoint: row.faultPoint,
  };
}

/**
 * Appends a checkpoint, or returns the one already recorded under the same
 * idempotency key.
 *
 * The conflict is resolved rather than raised. A batch that committed and then
 * lost its acknowledgement will be retried, and the retry must be a no-op
 * instead of a failure — otherwise the resume path breaks on precisely the
 * interruption it exists to handle.
 */
export async function appendMigrationCheckpoint(
  tx: Transaction,
  input: {
    id: string;
    migrationId: string;
    sequence: number;
    state: MigrationState;
    sourceCursor: string;
    destinationCursor: string;
    batchCount: number;
    recordCount: number;
    blobCount: number;
    identityDigest: string;
    checkpointDigest: string;
    idempotencyKey: string;
    faultPoint?: string;
    now: Date;
  },
): Promise<MigrationCheckpointRecord> {
  const inserted = await tx
    .insert(migrationCheckpoints)
    .values({
      id: input.id,
      migrationId: input.migrationId,
      sequence: input.sequence,
      state: input.state,
      sourceCursor: input.sourceCursor,
      destinationCursor: input.destinationCursor,
      batchCount: input.batchCount,
      recordCount: input.recordCount,
      blobCount: input.blobCount,
      identityDigest: input.identityDigest,
      checkpointDigest: input.checkpointDigest,
      idempotencyKey: input.idempotencyKey,
      ...(input.faultPoint === undefined ? {} : { faultPoint: input.faultPoint }),
      committedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();

  const row = inserted[0];
  if (row !== undefined) {
    return toRecord(row);
  }
  const existing = await findCheckpointByKey(tx, {
    migrationId: input.migrationId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing !== null) {
    return existing;
  }
  // The insert conflicted on the sequence index rather than the idempotency
  // one: another process wrote a *different* checkpoint at this position. That
  // is not a retry, and returning the row it wrote would let this caller
  // believe its own batch was recorded.
  const atSequence = await findCheckpointAtSequence(tx, {
    migrationId: input.migrationId,
    sequence: input.sequence,
  });
  throw new MigrationCheckpointConflictError(
    input.sequence,
    atSequence?.checkpointDigest ?? "unknown",
  );
}

export class MigrationCheckpointConflictError extends Error {
  readonly code = "conflict";

  constructor(
    readonly sequence: number,
    readonly existingDigest: string,
  ) {
    super(`another process already recorded checkpoint ${sequence} for this migration`);
    this.name = "MigrationCheckpointConflictError";
  }
}

export async function findCheckpointByKey(
  executor: Executor,
  input: { migrationId: string; idempotencyKey: string },
): Promise<MigrationCheckpointRecord | null> {
  const rows = await executor
    .select()
    .from(migrationCheckpoints)
    .where(
      and(
        eq(migrationCheckpoints.migrationId, input.migrationId),
        eq(migrationCheckpoints.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findCheckpointAtSequence(
  executor: Executor,
  input: { migrationId: string; sequence: number },
): Promise<MigrationCheckpointRecord | null> {
  const rows = await executor
    .select()
    .from(migrationCheckpoints)
    .where(
      and(
        eq(migrationCheckpoints.migrationId, input.migrationId),
        eq(migrationCheckpoints.sequence, input.sequence),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/**
 * The furthest checkpoint recorded, for a resume.
 *
 * By sequence, not by time. Two checkpoints committed in the same instant are
 * ordered by sequence and ambiguous by timestamp, and a resume that picked the
 * wrong one of an ambiguous pair would re-sweep or skip a batch.
 */
export async function findLatestMigrationCheckpoint(
  executor: Executor,
  migrationId: string,
): Promise<MigrationCheckpointRecord | null> {
  const rows = await executor
    .select()
    .from(migrationCheckpoints)
    .where(eq(migrationCheckpoints.migrationId, migrationId))
    .orderBy(desc(migrationCheckpoints.sequence))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/**
 * The furthest checkpoint that was **not** interrupted.
 *
 * This is what a resume actually wants, and it is a different question from
 * "the latest checkpoint". A checkpoint carrying a fault point records that
 * something failed part-way through it; resuming from there would treat work
 * that never finished as done.
 */
export async function findLastSafeCheckpoint(
  executor: Executor,
  migrationId: string,
): Promise<MigrationCheckpointRecord | null> {
  const rows = await executor
    .select()
    .from(migrationCheckpoints)
    .where(eq(migrationCheckpoints.migrationId, migrationId))
    .orderBy(desc(migrationCheckpoints.sequence));
  const safe = rows.find((row) => row.faultPoint === null);
  return safe === undefined ? null : toRecord(safe);
}

/** The whole history, oldest first. Read by diagnostics, never by the sweep. */
export async function listMigrationCheckpoints(
  executor: Executor,
  migrationId: string,
): Promise<readonly MigrationCheckpointRecord[]> {
  const rows = await executor
    .select()
    .from(migrationCheckpoints)
    .where(eq(migrationCheckpoints.migrationId, migrationId))
    .orderBy(migrationCheckpoints.sequence);
  return rows.map(toRecord);
}
