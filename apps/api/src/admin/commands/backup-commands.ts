/**
 * Producing and checking backups from the host (T017, FR-027 to FR-029).
 *
 * These commands are the path an operator uses when something is already wrong,
 * so what they return matters more than what they print. They reuse the exit
 * codes feature 002 established rather than numbering their own failures: a
 * second vocabulary inside one CLI is how somebody learns that exit codes cannot
 * be trusted.
 *
 * The distinction that earns its keep is **integrityFailure against
 * unexpected**. An operator scripting a nightly backup needs to know whether
 * there is an artefact to investigate or nothing at all, and one generic failure
 * would send them looking for a file that may not exist.
 */

import { randomUUID } from "node:crypto";
import {
  backupsWithVerification,
  type Database,
  deleteBackup,
  recordBackup,
  recordVerification,
} from "@myownnotion/database";
import { backupsToDelete, DEFAULT_RETENTION_DAYS, type Uuid } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import type { BackupService } from "../../backup/backup-service.ts";
import type { BackupDestination } from "../../backup/destinations/destination.ts";
import { type CommandResult, EXIT_CODES } from "../command-output.ts";

export interface BackupCommandDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly service: Pick<BackupService, "run" | "inspectStored">;
  readonly destination: BackupDestination;
  readonly retainDays?: number;
  readonly now?: () => Date;
}

/**
 * Runs a backup and records everything that happened to it.
 *
 * The record is written whatever the outcome, including a failed verification.
 * A backup that exists and is not to be trusted must be *visible* — an
 * unrecorded failure is a file at a destination that nothing will ever
 * re-verify, delete, or count against retention.
 */
export async function runBackupCommand(
  deps: BackupCommandDeps,
  reason: "scheduled" | "manual" | "pre-update" = "manual",
  supersededByVersion?: string,
): Promise<CommandResult> {
  return await deps.db.transaction(async (tx) => {
    // The transaction-scoped advisory lock is shared by API schedules, host
    // commands and migration jobs. It is released automatically on every exit,
    // including a crashed command, and refuses a concurrent run before either
    // process creates a staging file.
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`myownnotion.backup:${deps.workspaceId}`}, 0)) AS acquired`,
    );
    const acquired = (lockResult as unknown as { rows: Array<{ acquired: boolean }> }).rows[0]
      ?.acquired;
    if (acquired !== true) {
      return {
        code: EXIT_CODES.refused,
        message: "another backup is already running; try again after it finishes",
      };
    }

    const outcome = await deps.service.run(reason);
    await recordBackup(tx, {
      id: outcome.backupId as Uuid,
      workspaceId: deps.workspaceId,
      cursor: outcome.cursor,
      applicationVersion: outcome.applicationVersion,
      schemaVersion: outcome.schemaVersion,
      recordFormatVersion: outcome.recordFormatVersion,
      byteLength: outcome.byteLength,
      digest: outcome.digest,
      reason: outcome.reason,
      ...(supersededByVersion === undefined ? {} : { supersededByVersion }),
      // A completed transfer remains addressable even when read-back fails: an
      // operator can verify it again and retention can eventually remove it.
      // A failed `put` records a local-only backup instead, because the
      // destination promises to remove its partial object.
      ...(outcome.transferred
        ? { destination: deps.destination.name, remoteName: outcome.name }
        : {}),
    });
    await recordVerification(tx, {
      id: randomUUID() as Uuid,
      backupId: outcome.backupId as Uuid,
      stage: "after-creation",
      outcome: outcome.verifiedAfterCreation ? "passed" : "failed",
      ...(outcome.verifiedAfterCreation ? {} : { detail: outcome.detail }),
    });
    if (outcome.verifiedAfterCreation) {
      await recordVerification(tx, {
        id: randomUUID() as Uuid,
        backupId: outcome.backupId as Uuid,
        stage: "after-transfer",
        outcome: outcome.verifiedAfterTransfer ? "passed" : "failed",
        ...(outcome.verifiedAfterTransfer ? {} : { detail: outcome.detail }),
      });
    }

    if (!outcome.verifiedAfterCreation || !outcome.verifiedAfterTransfer) {
      return {
        code: EXIT_CODES.integrityFailure,
        message: "the backup was produced and could not be verified",
        data: {
          backupId: outcome.backupId,
          verifiedAfterCreation: outcome.verifiedAfterCreation,
          verifiedAfterTransfer: outcome.verifiedAfterTransfer,
        },
      };
    }

    return {
      code: EXIT_CODES.ok,
      message: "backup produced, transferred and verified",
      data: {
        backupId: outcome.backupId,
        byteLength: outcome.byteLength,
        cursor: outcome.cursor,
      },
    };
  });
}

/**
 * Re-checks a stored backup, appending a verification.
 *
 * Never updates the previous one. A backup that passed and later failed keeps
 * both facts, which is exactly the history somebody investigating a bad restore
 * needs.
 */
export async function verifyBackupCommand(
  deps: BackupCommandDeps,
  selector: { readonly id?: string; readonly latest?: boolean },
): Promise<CommandResult> {
  const all = await backupsWithVerification(deps.db, deps.workspaceId);
  const target =
    selector.id !== undefined
      ? all.find((backup) => backup.id === selector.id)
      : selector.latest === true
        ? all[0]
        : undefined;

  if (target === undefined) {
    return {
      code: EXIT_CODES.usage,
      message: "no such backup",
    };
  }
  if (target.remoteName === null) {
    return {
      code: EXIT_CODES.usage,
      message:
        "this backup was never transferred, so there is nothing to verify at the destination",
      data: { backupId: target.id },
    };
  }

  const stored = await deps.service.inspectStored(target.remoteName);
  const passed =
    stored !== null && stored.byteLength === target.byteLength && stored.digest === target.digest;

  await recordVerification(deps.db, {
    id: randomUUID() as Uuid,
    backupId: target.id,
    stage: "after-transfer",
    outcome: passed ? "passed" : "failed",
    ...(passed
      ? {}
      : {
          detail:
            stored === null
              ? "the destination no longer holds this backup"
              : "the stored object does not match the size and digest it was sent as",
        }),
  });

  return passed
    ? {
        code: EXIT_CODES.ok,
        message: "backup verified at the destination",
        data: { backupId: target.id },
      }
    : {
        code: EXIT_CODES.integrityFailure,
        message: "the backup at the destination does not match what was sent",
        data: { backupId: target.id },
      };
}

/**
 * Deletes what retention allows, and nothing more.
 *
 * The decision is the domain's; this only carries it out. Reimplementing "old
 * enough" here would give the rule two homes, and the one that got it wrong
 * would be the one that runs.
 */
export async function pruneBackupsCommand(deps: BackupCommandDeps): Promise<CommandResult> {
  const all = await backupsWithVerification(deps.db, deps.workspaceId);
  const deletable = backupsToDelete(
    all.map((backup) => ({
      id: backup.id,
      createdAt: backup.createdAt,
      verifiedAtDestination: backup.verifiedAtDestination,
    })),
    {
      retainDays: deps.retainDays ?? DEFAULT_RETENTION_DAYS,
      now: (deps.now ?? (() => new Date()))(),
    },
  );

  const removed: string[] = [];
  for (const id of deletable) {
    const backup = all.find((candidate) => candidate.id === id);
    if (backup === undefined) {
      continue;
    }
    if (backup.remoteName != null) {
      await deps.destination.delete(backup.remoteName);
    }
    await deleteBackup(deps.db, backup.id);
    removed.push(id);
  }

  return {
    code: EXIT_CODES.ok,
    message:
      removed.length === 0 ? "nothing was old enough to delete safely" : "old backups deleted",
    data: { deleted: removed.length },
  };
}
