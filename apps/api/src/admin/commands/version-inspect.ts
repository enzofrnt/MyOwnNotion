/** Read-only application, installation and migration status (T041, FR-027). */

import { backupsWithVerification, type Database, findInstallation } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { type CommandResult, EXIT_CODES } from "../command-output.ts";

export async function versionInspectCommand(input: {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly runningVersion: string;
  readonly pendingMigrations: readonly string[];
}): Promise<CommandResult> {
  const installation = await findInstallation(input.db);
  const recordedVersion = installation?.applicationVersion ?? null;
  const backups = await backupsWithVerification(input.db, input.workspaceId);
  const previousBackup =
    installation?.previousBackupId == null
      ? undefined
      : backups.find((backup) => backup.id === installation.previousBackupId);
  const verifiedBackupExists =
    recordedVersion !== null &&
    backups.some(
      (backup) => backup.applicationVersion === recordedVersion && backup.verifiedAtDestination,
    );

  return {
    code: EXIT_CODES.ok,
    message: "version and migration status",
    data: {
      runningApplicationVersion: input.runningVersion,
      recordedApplicationVersion: recordedVersion,
      schemaVersion: installation?.schemaVersion ?? null,
      migrationPending: input.pendingMigrations.length > 0,
      pendingMigrations: input.pendingMigrations,
      verifiedBackupForRecordedVersion: verifiedBackupExists,
      previousApplicationVersion: installation?.previousApplicationVersion ?? null,
      // Published API images use this exact immutable `sha-…` tag. Keeping the
      // explicit image field makes rollback output actionable rather than
      // asking an operator to infer that an application version is a tag.
      previousImageTag: installation?.previousApplicationVersion ?? null,
      previousBackupId: installation?.previousBackupId ?? null,
      previousSchemaVersion: previousBackup?.schemaVersion ?? null,
      previousRecordFormatVersion: previousBackup?.recordFormatVersion ?? null,
    },
  };
}
