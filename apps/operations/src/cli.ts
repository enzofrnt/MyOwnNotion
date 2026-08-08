import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import { createDatabase, listContentAuditInventory, runMutation } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { auditContentStorage } from "./audit.ts";
import { BackupFailure, createEncryptedBackup } from "./backup.ts";
import {
  type BackupMaintenanceInput,
  checkBackupRepository,
  listCompleteBackups,
  pruneCompleteBackups,
} from "./backup-maintenance.ts";
import { acquireExclusiveFileLock } from "./locks.ts";
import { migrateFilesystemContent } from "./migrate-filesystem.ts";
import { applyVerifiedBackup, RestoreFailure, verifyBackupForRestore } from "./restore.ts";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";
import { runBackupScheduler } from "./scheduler.ts";
import { readOperationStatus } from "./status-store.ts";
import { createConfiguredBlobStore } from "./storage-config.ts";

export const OPERATIONS_COMMANDS = [
  "storage.audit",
  "storage.migrate-filesystem",
  "backup.create",
  "backup.list",
  "backup.check",
  "backup.prune",
  "backup.status",
  "backup.schedule",
  "restore.verify",
  "restore.apply",
] as const;

export type OperationsCommand = (typeof OPERATIONS_COMMANDS)[number];

export function isOperationsCommand(value: string): value is OperationsCommand {
  return (OPERATIONS_COMMANDS as readonly string[]).includes(value);
}

class SafeCliFailure extends Error {
  constructor(readonly failureCode: string) {
    super(failureCode);
    this.name = "SafeCliFailure";
  }
}

function safeCliFailureCode(error: unknown): string | null {
  if (
    error instanceof Error &&
    (error.name === "SafeCliFailure" ||
      error.name === "BackupFailure" ||
      error.name === "RestoreFailure") &&
    "failureCode" in error &&
    typeof error.failureCode === "string" &&
    /^[a-z][a-z0-9.-]{0,127}$/.test(error.failureCode)
  ) {
    return error.failureCode;
  }
  return null;
}

const INVALID_CONFIGURATION_FAILURES = new Set([
  "backup.database-url-invalid",
  "backup.password-file-required",
  "backup.repository-required",
  "backup.schema-unavailable",
  "backup.source-revision-invalid",
  "restore.confirmation-required",
  "restore.database-required",
  "restore.options-invalid",
  "restore.postgres-major-invalid",
  "restore.snapshot-invalid",
  "restore.snapshot-required",
]);

const RESTORE_PREFLIGHT_FAILURES = new Set([
  "backup.postgres-incompatible",
  "backup.schema-incompatible",
  "restore.database-not-empty",
  "restore.guard-exists",
  "restore.manifest-incomplete",
  "restore.snapshot-unavailable",
  "restore.storage-not-empty",
]);

const EXTERNAL_DEPENDENCY_FAILURES = new Set([
  "backup.complete-tag-failed",
  "backup.database-dump-failed",
  "backup.object-write-failed",
  "backup.repository-prune-failed",
  "backup.repository-query-failed",
  "backup.repository-write-failed",
  "backup.unexpected-failure",
  "database.unavailable",
  "restore.apply-failed",
  "restore.storage-unavailable",
  "restore.verification-failed",
  "storage.audit-failed",
  "storage.unavailable",
]);

function isInvalidConfigurationFailure(failureCode: string | null): boolean {
  return (
    failureCode !== null &&
    (INVALID_CONFIGURATION_FAILURES.has(failureCode) || failureCode.startsWith("backup.retention-"))
  );
}

/** Maps the closed result envelope to the documented operations CLI exit contract. */
export function classifyOperationExitCode(
  command: OperationsCommand,
  result: SafeOperationResult,
): 0 | 2 | 3 | 4 | 5 | 6 | 7 {
  if (result.status === "succeeded") return 0;
  if (result.failureCode === "operation.already-running") return 3;
  if (command === "restore.apply" && result.counts["guarded"] === 1) return 7;
  if (isInvalidConfigurationFailure(result.failureCode)) return 2;
  if (result.failureCode !== null && RESTORE_PREFLIGHT_FAILURES.has(result.failureCode)) return 4;
  if (result.failureCode !== null && EXTERNAL_DEPENDENCY_FAILURES.has(result.failureCode)) return 6;
  return 5;
}

function classifyCaughtFailureExitCode(failureCode: string | null): 2 | 4 | 6 {
  if (failureCode === null || isInvalidConfigurationFailure(failureCode)) return 2;
  if (RESTORE_PREFLIGHT_FAILURES.has(failureCode)) return 4;
  return 6;
}

function exactNoArguments(arguments_: readonly string[], command: string): void {
  if (arguments_.length !== 0) throw new TypeError(`${command} options are invalid`);
}

function operationPath(
  environment: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: string,
): string {
  return environment[variable]?.trim() || fallback;
}

function configuredPostgresMajor(
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const postgresMajor = Number(environment["MYOWNNOTION_POSTGRES_MAJOR"]?.trim() || "18");
  if (!Number.isSafeInteger(postgresMajor) || postgresMajor < 1) {
    throw new RestoreFailure("restore.postgres-major-invalid");
  }
  return postgresMajor;
}

function maintenanceInput(
  environment: Readonly<Record<string, string | undefined>>,
): BackupMaintenanceInput {
  return {
    environment,
    cacheRoot: operationPath(environment, "MYOWNNOTION_OPERATIONS_STAGING", ".backup-staging"),
    lockPath: operationPath(
      environment,
      "MYOWNNOTION_OPERATIONS_LOCK",
      ".operations/operations.lock",
    ),
    statusPath: operationPath(environment, "MYOWNNOTION_BACKUP_STATUS", ".operations/backup.json"),
  };
}

async function configuredBackup(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new TypeError("database_url is required");
  }
  let blobStore: Awaited<ReturnType<typeof createConfiguredBlobStore>>;
  try {
    blobStore = await createConfiguredBlobStore(environment);
  } catch {
    throw new SafeCliFailure("storage.unavailable");
  }
  return createEncryptedBackup({
    databaseUrl,
    blobStore,
    stagingRoot: operationPath(environment, "MYOWNNOTION_OPERATIONS_STAGING", ".backup-staging"),
    lockPath: operationPath(
      environment,
      "MYOWNNOTION_OPERATIONS_LOCK",
      ".operations/operations.lock",
    ),
    statusPath: operationPath(environment, "MYOWNNOTION_BACKUP_STATUS", ".operations/backup.json"),
    migrationsRoot: operationPath(
      environment,
      "MYOWNNOTION_MIGRATIONS_ROOT",
      "packages/database/migrations",
    ),
    sourceRevision: environment["MYOWNNOTION_VCS_REF"]?.trim() || "",
    toolVersions: {
      node: process.versions.node,
      restic: environment["MYOWNNOTION_RESTIC_VERSION"]?.trim() || "0.19.1",
      rclone: environment["MYOWNNOTION_RCLONE_VERSION"]?.trim() || "1.72.1",
    },
    environment,
  });
}

function checkReadData(arguments_: readonly string[]): boolean {
  if (arguments_.length === 0) return false;
  if (arguments_.length === 1 && arguments_[0] === "--read-data") return true;
  throw new TypeError("backup check options are invalid");
}

function pruneConfirmation(arguments_: readonly string[]): boolean {
  if (arguments_.length === 0) return false;
  if (arguments_.length === 1 && arguments_[0] === "--dry-run") return false;
  if (arguments_.length === 1 && arguments_[0] === "--confirm") return true;
  throw new TypeError("backup prune options are invalid");
}

function retentionValue(
  environment: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: number,
): number {
  const raw = environment[variable]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new BackupFailure("backup.retention-policy-invalid");
  return parsed;
}

export async function runBackupCommand(
  command: "backup.create" | "backup.list" | "backup.check" | "backup.prune" | "backup.status",
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  if (command === "backup.create") {
    exactNoArguments(arguments_, command);
    return configuredBackup(environment);
  }
  if (command === "backup.list") {
    exactNoArguments(arguments_, command);
    return listCompleteBackups(maintenanceInput(environment));
  }
  if (command === "backup.check") {
    return checkBackupRepository(maintenanceInput(environment), checkReadData(arguments_));
  }
  if (command === "backup.status") {
    exactNoArguments(arguments_, command);
    const previous = await readOperationStatus(maintenanceInput(environment).statusPath);
    const observedAt = new Date();
    if (previous === null) {
      return createSafeOperationResult({
        operationId: generateUuidV7(),
        command,
        status: "failed",
        startedAt: observedAt.toISOString(),
        finishedAt: observedAt.toISOString(),
        counts: {},
        failureCode: "backup.status-unavailable",
      });
    }
    return createSafeOperationResult({
      operationId: generateUuidV7(),
      command,
      status: previous.status,
      startedAt: observedAt.toISOString(),
      finishedAt: observedAt.toISOString(),
      ...(previous.snapshotId === undefined ? {} : { snapshotId: previous.snapshotId }),
      counts: previous.counts,
      failureCode: previous.failureCode,
    });
  }
  return pruneCompleteBackups(
    maintenanceInput(environment),
    {
      daily: retentionValue(environment, "MYOWNNOTION_BACKUP_KEEP_DAILY", 7),
      weekly: retentionValue(environment, "MYOWNNOTION_BACKUP_KEEP_WEEKLY", 4),
      monthly: retentionValue(environment, "MYOWNNOTION_BACKUP_KEEP_MONTHLY", 12),
    },
    pruneConfirmation(arguments_),
  );
}

async function runScheduleCommand(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  exactNoArguments(arguments_, "backup.schedule");
  const scheduleUtc = environment["MYOWNNOTION_BACKUP_SCHEDULE_UTC"]?.trim();
  if (scheduleUtc === undefined || scheduleUtc.length === 0) {
    throw new TypeError("backup schedule is required");
  }
  return runBackupScheduler({
    scheduleUtc,
    statePath: operationPath(
      environment,
      "MYOWNNOTION_BACKUP_SCHEDULE_STATE",
      ".operations/backup-schedule.json",
    ),
    createBackup: () => configuredBackup(environment),
  });
}

function restoreOptions(
  arguments_: readonly string[],
  apply: boolean,
): { snapshotId: string; confirmEmpty: boolean } {
  const snapshotIndex = arguments_.indexOf("--snapshot");
  if (snapshotIndex < 0 || snapshotIndex + 1 >= arguments_.length) {
    throw new RestoreFailure("restore.snapshot-required");
  }
  const snapshotId = arguments_[snapshotIndex + 1] ?? "";
  if (!/^[a-f0-9]{8,64}$/.test(snapshotId)) {
    throw new RestoreFailure("restore.snapshot-invalid");
  }
  const confirmEmpty = arguments_.includes("--confirm-empty");
  const accepted = new Set([snapshotIndex, snapshotIndex + 1]);
  if (confirmEmpty) accepted.add(arguments_.indexOf("--confirm-empty"));
  if (accepted.size !== arguments_.length || (!apply && confirmEmpty) || (apply && !confirmEmpty)) {
    throw new RestoreFailure(apply ? "restore.confirmation-required" : "restore.options-invalid");
  }
  return { snapshotId, confirmEmpty };
}

export async function runRestoreCommand(
  command: "restore.verify" | "restore.apply",
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  const options = restoreOptions(arguments_, command === "restore.apply");
  const common = {
    snapshotId: options.snapshotId,
    stagingRoot: operationPath(environment, "MYOWNNOTION_RESTORE_STAGING", ".restore-staging"),
    lockPath: operationPath(
      environment,
      "MYOWNNOTION_OPERATIONS_LOCK",
      ".operations/operations.lock",
    ),
    migrationsRoot: operationPath(
      environment,
      "MYOWNNOTION_MIGRATIONS_ROOT",
      "packages/database/migrations",
    ),
    postgresMajor: configuredPostgresMajor(environment),
    environment,
  };
  if (command === "restore.verify") return verifyBackupForRestore(common);
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new RestoreFailure("restore.database-required");
  }
  let targetBlobStore: Awaited<ReturnType<typeof createConfiguredBlobStore>>;
  try {
    targetBlobStore = await createConfiguredBlobStore(environment);
  } catch {
    throw new RestoreFailure("restore.storage-unavailable");
  }
  return applyVerifiedBackup({
    ...common,
    databaseUrl,
    targetBlobStore,
    guardPath: operationPath(
      environment,
      "MYOWNNOTION_RESTORE_GUARD",
      ".operations/.restore-in-progress",
    ),
    confirmEmpty: options.confirmEmpty,
  });
}

function resultFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("operation identity")) return "operation.result-operation-id-invalid";
  if (message.includes("snapshot identity")) return "operation.result-snapshot-id-invalid";
  if (message.includes("command")) return "operation.result-command-invalid";
  if (message.includes("timestamp")) return "operation.result-timestamp-invalid";
  if (message.includes("count")) return "operation.result-count-invalid";
  if (message.includes("finding")) return "operation.result-finding-invalid";
  if (message.includes("state")) return "operation.result-state-invalid";
  return "operation.result-invalid";
}

function auditLimit(arguments_: readonly string[]): number {
  if (arguments_.length === 0) return 100;
  if (arguments_.length !== 2 || arguments_[0] !== "--limit") {
    throw new TypeError("storage audit options are invalid");
  }
  const value = Number(arguments_[1]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new RangeError("storage audit limit is invalid");
  }
  return value;
}

export async function runStorageAuditCommand(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  const startedAt = new Date();
  const operationId = generateUuidV7();
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new TypeError("database_url is required");
  }
  const limit = auditLimit(arguments_);
  const database = createDatabase(databaseUrl);
  try {
    let blobStore: Awaited<ReturnType<typeof createConfiguredBlobStore>>;
    try {
      blobStore = await createConfiguredBlobStore(environment);
    } catch {
      throw new SafeCliFailure("storage.unavailable");
    }
    let inventory: Awaited<ReturnType<typeof listContentAuditInventory>>;
    try {
      inventory = await runMutation(database.db, listContentAuditInventory);
    } catch {
      throw new SafeCliFailure("database.unavailable");
    }
    let report: Awaited<ReturnType<typeof auditContentStorage>>;
    try {
      report = await auditContentStorage({
        inventory,
        blobStore,
        hmacKey: randomBytes(32),
        limit,
      });
    } catch {
      throw new SafeCliFailure("storage.audit-failed");
    }
    try {
      return createSafeOperationResult({
        operationId,
        command: "storage.audit",
        status: "succeeded",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        counts: report.counts,
        failureCode: null,
        findings: report.findings,
      });
    } catch (error) {
      throw new SafeCliFailure(resultFailureCode(error));
    }
  } finally {
    await database.close();
  }
}

function migrationConfirmation(arguments_: readonly string[]): boolean {
  if (arguments_.length === 0) return false;
  if (arguments_.length === 1 && arguments_[0] === "--confirm") return true;
  throw new TypeError("storage migration options are invalid");
}

export async function runStorageMigrationCommand(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SafeOperationResult> {
  const startedAt = new Date();
  const operationId = generateUuidV7();
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  const sourceRoot = environment["MYOWNNOTION_LEGACY_BLOB_ROOT"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new TypeError("database_url is required");
  }
  if (sourceRoot === undefined || sourceRoot.length === 0) {
    throw new TypeError("legacy blob root is required");
  }
  const confirm = migrationConfirmation(arguments_);
  const lock = await acquireExclusiveFileLock(
    environment["MYOWNNOTION_OPERATIONS_LOCK"]?.trim() || ".operations/operations.lock",
    { operationId, startedAt: startedAt.toISOString() },
  );
  if (lock === null) {
    return createSafeOperationResult({
      operationId,
      command: "storage.migrate-filesystem",
      status: "failed",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      counts: {},
      failureCode: "operation.already-running",
    });
  }
  const database = createDatabase(databaseUrl);
  try {
    const destination = await createConfiguredBlobStore(environment);
    const report = await migrateFilesystemContent({
      db: database.db,
      source: new FilesystemBlobStore(sourceRoot),
      destination,
      confirm,
    });
    const failed = report.counts.missing + report.counts.mismatched + report.counts.failed > 0;
    return createSafeOperationResult({
      operationId,
      command: "storage.migrate-filesystem",
      status: failed ? "failed" : "succeeded",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      counts: report.counts,
      failureCode: failed ? "storage.integrity-failed" : null,
    });
  } finally {
    await database.close();
    await lock.release();
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const command = argv.length >= 2 ? `${argv[0]}.${argv[1]}` : "";
  if (!isOperationsCommand(command)) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", failureCode: "operation.invalid-command" })}\n`,
    );
    return 2;
  }
  try {
    const commandArguments = argv.slice(2);
    let result: SafeOperationResult;
    if (command === "storage.audit") {
      result = await runStorageAuditCommand(commandArguments, environment);
    } else if (command === "storage.migrate-filesystem") {
      result = await runStorageMigrationCommand(commandArguments, environment);
    } else if (
      command === "backup.create" ||
      command === "backup.list" ||
      command === "backup.check" ||
      command === "backup.prune" ||
      command === "backup.status"
    ) {
      result = await runBackupCommand(command, commandArguments, environment);
    } else if (command === "backup.schedule") {
      result = await runScheduleCommand(commandArguments, environment);
    } else {
      result = await runRestoreCommand(command, commandArguments, environment);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return classifyOperationExitCode(command, result);
  } catch (error) {
    const failureCode = safeCliFailureCode(error);
    process.stdout.write(
      `${JSON.stringify({
        status: "failed",
        failureCode: failureCode ?? "operation.preflight-failed",
      })}\n`,
    );
    return classifyCaughtFailureExitCode(failureCode);
  }
}

const executedPath = process.argv[1];
if (executedPath !== undefined && pathToFileURL(executedPath).href === import.meta.url) {
  process.exitCode = await main();
}
