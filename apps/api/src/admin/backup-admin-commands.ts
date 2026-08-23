/** Routing for backup, restore and version commands (FR-027 to FR-029). */

import type { ContentStore } from "@myownnotion/blob-store";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { BackupService } from "../backup/backup-service.ts";
import type { BackupDestination } from "../backup/destinations/destination.ts";
import type { RestoreScope } from "../backup/restore-service.ts";
import type { PageOperationCrypto } from "../page-state/page-operation-crypto.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { CommandResult } from "./command-output.ts";
import { CommandUsageError, type ParsedCommand, requireOption } from "./command-parser.ts";
import {
  type BackupCommandDeps,
  runBackupCommand,
  verifyBackupCommand,
} from "./commands/backup-commands.ts";
import { restoreApplyCommand } from "./commands/restore-apply.ts";
import { restoreTestCommand } from "./commands/restore-test.ts";
import { versionInspectCommand } from "./commands/version-inspect.ts";

export interface BackupAdminContext {
  readonly db: Database;
  readonly databaseUrl: string;
  readonly workspaceId: Uuid;
  readonly service: BackupService;
  readonly destination: BackupDestination;
  readonly contentStore: ContentStore;
  readonly protectedContent: ProtectedContent;
  readonly pageOperationCrypto?: PageOperationCrypto;
  readonly deploymentKey?: () => Buffer;
  readonly open: (ciphertext: Buffer) => Promise<Buffer>;
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  readonly runningVersion: string;
  readonly pendingMigrations: readonly string[];
  readonly terminalAvailable: boolean;
  readonly confirmRestore: (scope: RestoreScope) => Promise<boolean>;
}

function selector(command: ParsedCommand, requireId = false): { id?: string; latest?: boolean } {
  const id = command.options["id"];
  const latest = command.options["latest"] === true;
  if (id !== undefined && typeof id !== "string") {
    throw new CommandUsageError("--id requires a value");
  }
  if (id !== undefined && latest) {
    throw new CommandUsageError("choose either --id or --latest, not both");
  }
  if (id === undefined && !latest) {
    if (requireId) {
      throw new CommandUsageError("--id is required");
    }
    throw new CommandUsageError("choose --id or --latest");
  }
  return id === undefined ? { latest: true } : { id };
}

export const BACKUP_ADMIN_COMMANDS = [
  "backup run",
  "backup verify",
  "restore test",
  "restore apply",
  "version inspect",
] as const;

export async function runBackupAdminCommand(
  command: ParsedCommand,
  context: BackupAdminContext,
): Promise<CommandResult> {
  const path = command.path.join(" ");
  const backupDeps: BackupCommandDeps = {
    db: context.db,
    workspaceId: context.workspaceId,
    service: context.service,
    destination: context.destination,
  };
  const restoreDeps = {
    db: context.db,
    workspaceId: context.workspaceId,
    destination: context.destination,
    open: context.open,
    installation: {
      schemaVersion: context.schemaVersion,
      recordFormatVersion: context.recordFormatVersion,
    },
  };

  switch (path) {
    case "backup run":
      return await runBackupCommand(backupDeps);
    case "backup verify":
      return await verifyBackupCommand(backupDeps, selector(command));
    case "restore test":
      return await restoreTestCommand(
        {
          ...restoreDeps,
          databaseUrl: context.databaseUrl,
          ...(context.deploymentKey === undefined ? {} : { deploymentKey: context.deploymentKey }),
        },
        selector(command),
      );
    case "restore apply":
      return await restoreApplyCommand(
        {
          ...restoreDeps,
          contentStore: context.contentStore,
          protectedContent: context.protectedContent,
          ...(context.pageOperationCrypto === undefined
            ? {}
            : { pageOperationCrypto: context.pageOperationCrypto }),
          safetyBackup: async () => {
            const result = await runBackupCommand(backupDeps, "manual");
            const backupId = result.data?.["backupId"];
            return result.code === 0 && typeof backupId === "string" ? backupId : null;
          },
        },
        {
          id: requireOption(command, "id"),
          dryRun: command.options["dry-run"] === true,
          yes: command.options["yes"] === true,
          terminalAvailable: context.terminalAvailable,
          askForConfirmation: context.confirmRestore,
        },
      );
    case "version inspect":
      return await versionInspectCommand({
        db: context.db,
        workspaceId: context.workspaceId,
        runningVersion: context.runningVersion,
        pendingMigrations: context.pendingMigrations,
      });
    default:
      throw new CommandUsageError(
        `unknown command: ${path}. Supported: ${BACKUP_ADMIN_COMMANDS.join(", ")}`,
      );
  }
}
