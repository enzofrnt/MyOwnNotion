import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import { createDatabase, listContentAuditInventory, runMutation } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { auditContentStorage } from "./audit.ts";
import { acquireExclusiveFileLock } from "./locks.ts";
import { migrateFilesystemContent } from "./migrate-filesystem.ts";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";
import { createConfiguredBlobStore } from "./storage-config.ts";

export const OPERATIONS_COMMANDS = [
  "storage.audit",
  "storage.migrate-filesystem",
  "backup.create",
  "backup.list",
  "backup.check",
  "backup.prune",
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
    error.name === "SafeCliFailure" &&
    "failureCode" in error &&
    typeof error.failureCode === "string" &&
    /^[a-z][a-z0-9.-]{0,127}$/.test(error.failureCode)
  ) {
    return error.failureCode;
  }
  return null;
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
  if (command !== "storage.audit" && command !== "storage.migrate-filesystem") {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", failureCode: "operation.invalid-command" })}\n`,
    );
    return 2;
  }
  try {
    const result =
      command === "storage.audit"
        ? await runStorageAuditCommand(argv.slice(2), environment)
        : await runStorageMigrationCommand(argv.slice(2), environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failureCode === "operation.already-running") return 3;
    return result.status === "succeeded" ? 0 : 5;
  } catch (error) {
    const failureCode = safeCliFailureCode(error);
    process.stdout.write(
      `${JSON.stringify({
        status: "failed",
        failureCode: failureCode ?? "operation.preflight-failed",
      })}\n`,
    );
    return failureCode === null ? 2 : 6;
  }
}

const executedPath = process.argv[1];
if (executedPath !== undefined && pathToFileURL(executedPath).href === import.meta.url) {
  process.exitCode = await main();
}
