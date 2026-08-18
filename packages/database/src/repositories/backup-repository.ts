/**
 * Recording backups, their verifications, and restoration attempts (T015).
 *
 * The read worth explaining is `backupsWithVerification`. Retention and the
 * staleness warning both ask the same question — "is there a backup that was
 * verified *at the destination*, and when" — and both would get it wrong if they
 * asked about the backup rather than about its verifications. A backup that was
 * produced, never transferred, and therefore never verified there is not a
 * failure; it is also not protection against losing the machine, which is the
 * only thing either caller cares about.
 */

import type { Uuid } from "@myownnotion/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import { backups, backupVerifications, restorationAttempts } from "../schema/index.ts";

type Executor = Database | Transaction;

export interface RecordBackupInput {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly cursor: string;
  readonly applicationVersion: string;
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  readonly byteLength: number;
  readonly digest: string;
  readonly reason: "scheduled" | "manual" | "pre-update";
  readonly destination?: string | undefined;
  readonly remoteName?: string | undefined;
  readonly supersededByVersion?: string | undefined;
  readonly createdAt?: Date | undefined;
}

export async function recordBackup(executor: Executor, input: RecordBackupInput): Promise<void> {
  await executor.insert(backups).values({
    id: input.id,
    workspaceId: input.workspaceId,
    cursor: input.cursor,
    applicationVersion: input.applicationVersion,
    schemaVersion: input.schemaVersion,
    recordFormatVersion: input.recordFormatVersion,
    byteLength: input.byteLength,
    digest: input.digest,
    reason: input.reason,
    // Both or neither: the table's own constraint says so, and a destination
    // without a name is a backup nothing can re-verify or delete.
    destination: input.destination ?? null,
    remoteName: input.remoteName ?? null,
    supersededByVersion: input.supersededByVersion ?? null,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

export interface RecordVerificationInput {
  readonly id: Uuid;
  readonly backupId: Uuid;
  readonly stage: "after-creation" | "after-transfer";
  readonly outcome: "passed" | "failed";
  readonly detail?: string | undefined;
  readonly checkedAt?: Date | undefined;
}

/**
 * Appends a verification. Never updates one.
 *
 * A backup can be checked again later — after a destination outage, or because
 * the owner asked — and the second answer does not replace the first. Overwriting
 * would erase the fact that a backup once passed and later failed, which is
 * exactly the history somebody investigating a bad restore needs.
 */
export async function recordVerification(
  executor: Executor,
  input: RecordVerificationInput,
): Promise<void> {
  await executor.insert(backupVerifications).values({
    id: input.id,
    backupId: input.backupId,
    stage: input.stage,
    outcome: input.outcome,
    detail: input.detail ?? null,
    ...(input.checkedAt === undefined ? {} : { checkedAt: input.checkedAt }),
  });
}

export interface BackupWithVerification {
  readonly id: Uuid;
  readonly createdAt: Date;
  readonly cursor: string;
  readonly applicationVersion: string;
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  readonly byteLength: number;
  readonly digest: string;
  readonly destination: string | null;
  readonly remoteName: string | null;
  readonly reason: string;
  /** True only when an `after-transfer` verification passed. */
  readonly verifiedAtDestination: boolean;
}

/**
 * Every backup, newest first, each carrying whether it is verified where it
 * counts.
 *
 * `verifiedAtDestination` is deliberately narrow: it asks only about the
 * after-transfer stage. A backup verified after creation and never transferred
 * has been proven to be a good file on a disk that may be the one that fails.
 */
export async function backupsWithVerification(
  executor: Executor,
  workspaceId: Uuid,
): Promise<BackupWithVerification[]> {
  const rows = await executor
    .select({
      id: backups.id,
      createdAt: backups.createdAt,
      cursor: backups.cursor,
      applicationVersion: backups.applicationVersion,
      schemaVersion: backups.schemaVersion,
      recordFormatVersion: backups.recordFormatVersion,
      byteLength: backups.byteLength,
      digest: backups.digest,
      destination: backups.destination,
      remoteName: backups.remoteName,
      reason: backups.reason,
      verifiedAtDestination: sql<boolean>`EXISTS (
        SELECT 1 FROM ${backupVerifications} v
        WHERE v.backup_id = ${backups.id}
          AND v.stage = 'after-transfer'
          AND v.outcome = 'passed'
      )`,
    })
    .from(backups)
    .where(eq(backups.workspaceId, workspaceId))
    .orderBy(desc(backups.createdAt));

  return rows.map((row) => ({
    ...row,
    id: row.id as Uuid,
    verifiedAtDestination: row.verifiedAtDestination === true,
  }));
}

/**
 * When the last backup verified at the destination happened, or null.
 *
 * The single value the staleness warning is built on. Null means "never", which
 * the warning treats as stale — a workspace that has never had a verified remote
 * copy is exactly the one whose owner most needs telling.
 */
export async function lastVerifiedAtDestination(
  executor: Executor,
  workspaceId: Uuid,
): Promise<Date | null> {
  const rows = await executor
    .select({ checkedAt: backupVerifications.checkedAt })
    .from(backupVerifications)
    .innerJoin(backups, eq(backups.id, backupVerifications.backupId))
    .where(
      and(
        eq(backups.workspaceId, workspaceId),
        eq(backupVerifications.stage, "after-transfer"),
        eq(backupVerifications.outcome, "passed"),
      ),
    )
    .orderBy(desc(backupVerifications.checkedAt))
    .limit(1);
  return rows[0]?.checkedAt ?? null;
}

export async function deleteBackup(executor: Executor, backupId: Uuid): Promise<void> {
  // Verifications cascade with it. A verification for a backup that no longer
  // exists is a row nothing can interpret.
  await executor.delete(backups).where(eq(backups.id, backupId));
}

export interface StartRestorationInput {
  readonly id: Uuid;
  readonly backupId: Uuid;
  readonly kind: "test" | "destructive";
  readonly startedAt?: Date | undefined;
}

/**
 * Opens a restoration attempt, deliberately unfinished.
 *
 * The row is written *before* anything is restored, so an interrupted
 * restoration leaves a trace. Recording only on completion would make a crash
 * indistinguishable from a restoration that never started — and the whole point
 * of FR-017 is that the second state must be recognisable.
 */
export async function startRestoration(
  executor: Executor,
  input: StartRestorationInput,
): Promise<void> {
  await executor.insert(restorationAttempts).values({
    id: input.id,
    backupId: input.backupId,
    kind: input.kind,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
  });
}

export async function finishRestoration(
  executor: Executor,
  input: {
    readonly id: Uuid;
    readonly outcome: "succeeded" | "failed";
    readonly detail?: string | undefined;
    readonly restoredItemCount?: number | undefined;
    readonly finishedAt?: Date | undefined;
  },
): Promise<void> {
  await executor
    .update(restorationAttempts)
    .set({
      finishedAt: input.finishedAt ?? new Date(),
      outcome: input.outcome,
      detail: input.detail ?? null,
      restoredItemCount: input.restoredItemCount ?? null,
    })
    .where(eq(restorationAttempts.id, input.id));
}

/**
 * A restoration that started and never ended.
 *
 * Read at startup. Its presence is what stops the installation presenting itself
 * as healthy (FR-017) — inferring health from the absence of an error would
 * report a half-restored workspace as a working one.
 */
export async function unfinishedRestoration(
  executor: Executor,
): Promise<{ id: Uuid; backupId: Uuid; startedAt: Date; kind: string } | null> {
  const rows = await executor
    .select({
      id: restorationAttempts.id,
      backupId: restorationAttempts.backupId,
      startedAt: restorationAttempts.startedAt,
      kind: restorationAttempts.kind,
    })
    .from(restorationAttempts)
    .where(sql`${restorationAttempts.finishedAt} IS NULL`)
    .orderBy(desc(restorationAttempts.startedAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : { ...row, id: row.id as Uuid, backupId: row.backupId as Uuid };
}

/** The last rehearsal, for "when did you last test this" (FR-019, FR-020). */
export async function lastTestRestoration(
  executor: Executor,
): Promise<{ startedAt: Date; outcome: string | null; restoredItemCount: number | null } | null> {
  const rows = await executor
    .select({
      startedAt: restorationAttempts.startedAt,
      outcome: restorationAttempts.outcome,
      restoredItemCount: restorationAttempts.restoredItemCount,
    })
    .from(restorationAttempts)
    .where(eq(restorationAttempts.kind, "test"))
    .orderBy(desc(restorationAttempts.startedAt))
    .limit(1);
  return rows[0] ?? null;
}
