/**
 * Rotation persistence (T083, US5, FR-017, FR-018).
 *
 * Two policies, never one. `wrapping-key` and `data-key` rotate independently
 * because they answer different emergencies: a leaked deployment key is
 * remedied by rewrapping one row per workspace, while a leaked data key means
 * re-encrypting content. A single policy would force the cheap remedy to wait
 * for the expensive one, and the schema enforces the separation with a unique
 * index per kind.
 *
 * The checkpoint table is what makes a rotation resumable, and it is
 * append-only: each row records where the operation had reached, in sequence.
 * Updating one row in place would lose the history that says whether a
 * restart resumed or silently began again — which is exactly the question an
 * operator asks after an interruption.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import {
  rotationCheckpoints,
  rotationOperations,
  rotationPolicies,
} from "../../schema/security/index.ts";

export type RotationKind = "wrapping-key" | "data-key";
export type RotationMode = "scheduled" | "emergency";
export type RotationPhase =
  | "planned"
  | "prepared"
  | "rewrapping"
  | "rewriting"
  | "committing"
  | "complete"
  | "failed";

export interface RotationPolicyRecord {
  readonly id: string;
  readonly kind: RotationKind;
  readonly mode: RotationMode;
  readonly state: string;
  readonly dueAt: Date;
  readonly writeBlockAt: Date;
  readonly lastCompletedAt: Date | null;
  readonly currentGeneration: number;
}

export interface RotationOperationRecord {
  readonly id: string;
  readonly policyId: string;
  readonly kind: RotationKind;
  readonly mode: RotationMode;
  readonly fromVersionOrGeneration: number;
  readonly toVersionOrGeneration: number;
  readonly phase: RotationPhase;
  readonly cursor: string;
  readonly processedCount: number;
  readonly totalCount: number;
}

export class RotationRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RotationRepositoryError";
    this.code = code;
  }
}

type Executor = Database | Transaction;

export async function findRotationPolicy(
  executor: Executor,
  input: { installationId: string; kind: RotationKind },
): Promise<RotationPolicyRecord | null> {
  const rows = await executor
    .select()
    .from(rotationPolicies)
    .where(
      and(
        eq(rotationPolicies.installationId, input.installationId),
        eq(rotationPolicies.kind, input.kind),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        kind: row.kind as RotationKind,
        mode: row.mode as RotationMode,
        state: row.state,
        dueAt: row.dueAt,
        writeBlockAt: row.writeBlockAt,
        lastCompletedAt: row.lastCompletedAt ?? null,
        currentGeneration: row.currentGeneration,
      };
}

/**
 * Starts an operation, refusing a second one for the same policy.
 *
 * Two concurrent rotations of one key would interleave their cursors and
 * leave a state neither could resume from. The refusal is by row lookup rather
 * than by a unique index because the constraint is "no *unfinished* operation",
 * which no index expresses.
 */
export async function startRotationOperation(
  tx: Transaction,
  input: {
    id: string;
    installationId: string;
    policyId: string;
    kind: RotationKind;
    mode: RotationMode;
    fromVersionOrGeneration: number;
    toVersionOrGeneration: number;
    totalCount: number;
    auditReason?: string;
  },
): Promise<RotationOperationRecord> {
  const running = await findRunningRotation(tx, {
    installationId: input.installationId,
    kind: input.kind,
  });
  if (running !== null) {
    throw new RotationRepositoryError(
      "rotation_in_progress",
      `a ${input.kind} rotation is already running`,
    );
  }
  const [row] = await tx
    .insert(rotationOperations)
    .values({
      id: input.id,
      installationId: input.installationId,
      policyId: input.policyId,
      kind: input.kind,
      mode: input.mode,
      fromVersionOrGeneration: input.fromVersionOrGeneration,
      toVersionOrGeneration: input.toVersionOrGeneration,
      phase: "planned",
      cursor: "",
      processedCount: 0,
      totalCount: input.totalCount,
      ...(input.auditReason === undefined ? {} : { auditReason: input.auditReason }),
    })
    .returning();
  return toOperation(row as typeof rotationOperations.$inferSelect);
}

function toOperation(row: typeof rotationOperations.$inferSelect): RotationOperationRecord {
  return {
    id: row.id,
    policyId: row.policyId,
    kind: row.kind as RotationKind,
    mode: row.mode as RotationMode,
    fromVersionOrGeneration: row.fromVersionOrGeneration,
    toVersionOrGeneration: row.toVersionOrGeneration,
    phase: row.phase as RotationPhase,
    cursor: row.cursor,
    processedCount: row.processedCount,
    totalCount: row.totalCount,
  };
}

/** The unfinished operation for a kind, if there is one. */
export async function findRunningRotation(
  executor: Executor,
  input: { installationId: string; kind: RotationKind },
): Promise<RotationOperationRecord | null> {
  const rows = await executor
    .select()
    .from(rotationOperations)
    .where(
      and(
        eq(rotationOperations.installationId, input.installationId),
        eq(rotationOperations.kind, input.kind),
      ),
    )
    .orderBy(desc(rotationOperations.createdAt));
  const running = rows.find((row) => row.phase !== "complete" && row.phase !== "failed");
  return running === undefined ? null : toOperation(running);
}

/**
 * Appends a checkpoint and advances the operation's cursor.
 *
 * Both in one call, and both must be in the caller's transaction: a checkpoint
 * without the cursor move would replay work on restart, and a cursor move
 * without the checkpoint would skip it. The second is the dangerous one.
 */
export async function recordRotationCheckpoint(
  tx: Transaction,
  input: {
    id: string;
    operationId: string;
    sequence: number;
    cursor: string;
    processedCount: number;
    totalCount: number;
    checkpointDigest: string;
    idempotencyKey: string;
    phase: RotationPhase;
    now: Date;
  },
): Promise<void> {
  await tx.insert(rotationCheckpoints).values({
    id: input.id,
    operationId: input.operationId,
    sequence: input.sequence,
    cursor: input.cursor,
    processedCount: input.processedCount,
    totalCount: input.totalCount,
    checkpointDigest: input.checkpointDigest,
    idempotencyKey: input.idempotencyKey,
    committedAt: input.now,
  });
  await tx
    .update(rotationOperations)
    .set({
      cursor: input.cursor,
      processedCount: input.processedCount,
      phase: input.phase,
    })
    .where(eq(rotationOperations.id, input.operationId));
}

/** The furthest checkpoint an operation reached, for a resume. */
export async function findLatestCheckpoint(
  executor: Executor,
  operationId: string,
): Promise<{ sequence: number; cursor: string; processedCount: number } | null> {
  const rows = await executor
    .select()
    .from(rotationCheckpoints)
    .where(eq(rotationCheckpoints.operationId, operationId))
    .orderBy(desc(rotationCheckpoints.sequence))
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : { sequence: row.sequence, cursor: row.cursor, processedCount: row.processedCount };
}

export async function finishRotationOperation(
  tx: Transaction,
  input: { operationId: string; phase: "complete" | "failed"; now: Date },
): Promise<void> {
  await tx
    .update(rotationOperations)
    // The finishing instant goes in `updatedAt`: there is no separate finished
    // column, and adding one would mean a migration for something the phase
    // already says.
    .set({ phase: input.phase, updatedAt: input.now })
    .where(eq(rotationOperations.id, input.operationId));
}
