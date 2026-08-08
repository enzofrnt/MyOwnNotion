import { mkdir } from "node:fs/promises";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { BackupFailure, type BackupProcessRuntime, createResticEnvironment } from "./backup.ts";
import { acquireExclusiveFileLock } from "./locks.ts";
import { runExternalJsonProcess, runExternalProcess } from "./process-runner.ts";
import {
  createSafeOperationResult,
  type SafeBackupSnapshot,
  type SafeOperationResult,
} from "./result.ts";
import { writeOperationStatus } from "./status-store.ts";

export interface BackupRetentionPolicy {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}

export interface BackupMaintenanceInput {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly cacheRoot: string;
  readonly lockPath: string;
  readonly statusPath: string;
  readonly processRuntime?: BackupProcessRuntime;
  readonly now?: () => Date;
}

const defaultRuntime: BackupProcessRuntime = {
  run: runExternalProcess,
  runJson: runExternalJsonProcess,
};

function parseSnapshots(value: unknown): SafeBackupSnapshot[] {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new TypeError("restic snapshot list is invalid");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError("restic snapshot is invalid");
    }
    const record = entry as Record<string, unknown>;
    const tags = record["tags"];
    if (
      typeof record["id"] !== "string" ||
      !/^[a-f0-9]{8,64}$/.test(record["id"]) ||
      typeof record["time"] !== "string" ||
      !Number.isFinite(Date.parse(record["time"])) ||
      !Array.isArray(tags) ||
      !tags.includes("myownnotion-complete")
    ) {
      throw new TypeError("restic snapshot is incomplete or invalid");
    }
    return {
      snapshotId: record["id"],
      createdAt: new Date(record["time"]).toISOString(),
    };
  });
}

function operation(now: () => Date): { operationId: string; startedAt: string } {
  const started = now();
  return { operationId: generateUuidV7(() => started.getTime()), startedAt: started.toISOString() };
}

async function persist(
  input: BackupMaintenanceInput,
  result: SafeOperationResult,
): Promise<SafeOperationResult> {
  await writeOperationStatus(input.statusPath, result);
  return result;
}

async function context(input: BackupMaintenanceInput): Promise<{
  readonly runtime: BackupProcessRuntime;
  readonly env: Readonly<Record<string, string>>;
  readonly now: () => Date;
}> {
  const now = input.now ?? (() => new Date());
  const cacheDirectory = path.join(input.cacheRoot, "restic-cache");
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  return {
    runtime: input.processRuntime ?? defaultRuntime,
    env: createResticEnvironment(input.environment, cacheDirectory),
    now,
  };
}

export async function listCompleteBackups(
  input: BackupMaintenanceInput,
): Promise<SafeOperationResult> {
  const { runtime, env, now } = await context(input);
  const identity = operation(now);
  const listed = await runtime.runJson(
    {
      executable: "restic",
      arguments: ["snapshots", "--json", "--tag", "myownnotion-complete"],
      env,
      failureCode: "backup.repository-query-failed",
    },
    parseSnapshots,
  );
  const result = listed.ok
    ? createSafeOperationResult({
        ...identity,
        command: "backup.list",
        status: "succeeded",
        finishedAt: now().toISOString(),
        counts: { snapshots: listed.value.length },
        failureCode: null,
        snapshots: listed.value,
      })
    : createSafeOperationResult({
        ...identity,
        command: "backup.list",
        status: "failed",
        finishedAt: now().toISOString(),
        counts: {},
        failureCode: listed.failureCode,
      });
  return persist(input, result);
}

export async function checkBackupRepository(
  input: BackupMaintenanceInput,
  readData: boolean,
): Promise<SafeOperationResult> {
  const { runtime, env, now } = await context(input);
  const identity = operation(now);
  const checked = await runtime.run({
    executable: "restic",
    arguments: readData ? ["check", "--read-data"] : ["check"],
    env,
    failureCode: "backup.repository-check-failed",
  });
  return persist(
    input,
    createSafeOperationResult({
      ...identity,
      command: "backup.check",
      status: checked.ok ? "succeeded" : "failed",
      finishedAt: now().toISOString(),
      counts: { fullData: readData ? 1 : 0 },
      failureCode: checked.ok ? null : checked.failureCode,
    }),
  );
}

function retentionValue(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new BackupFailure(`backup.retention-${label}-invalid`);
  }
  return value;
}

export function validateRetentionPolicy(policy: BackupRetentionPolicy): BackupRetentionPolicy {
  return {
    daily: retentionValue(policy.daily, "daily"),
    weekly: retentionValue(policy.weekly, "weekly"),
    monthly: retentionValue(policy.monthly, "monthly"),
  };
}

export async function pruneCompleteBackups(
  input: BackupMaintenanceInput,
  policy: BackupRetentionPolicy,
  confirm: boolean,
): Promise<SafeOperationResult> {
  const validated = validateRetentionPolicy(policy);
  const { runtime, env, now } = await context(input);
  const identity = operation(now);
  const lock = await acquireExclusiveFileLock(input.lockPath, identity);
  if (lock === null) {
    return createSafeOperationResult({
      ...identity,
      command: "backup.prune",
      status: "failed",
      finishedAt: now().toISOString(),
      counts: {},
      failureCode: "operation.already-running",
    });
  }
  try {
    const arguments_ = [
      "forget",
      "--tag",
      "myownnotion-complete",
      "--keep-daily",
      String(validated.daily),
      "--keep-weekly",
      String(validated.weekly),
      "--keep-monthly",
      String(validated.monthly),
      ...(confirm ? ["--prune"] : ["--dry-run"]),
    ];
    const forgotten = await runtime.run({
      executable: "restic",
      arguments: arguments_,
      env,
      failureCode: confirm ? "backup.repository-prune-failed" : "backup.retention-check-failed",
    });
    return await persist(
      input,
      createSafeOperationResult({
        ...identity,
        command: "backup.prune",
        status: forgotten.ok ? "succeeded" : "failed",
        finishedAt: now().toISOString(),
        counts: {
          daily: validated.daily,
          weekly: validated.weekly,
          monthly: validated.monthly,
          confirmed: confirm ? 1 : 0,
        },
        failureCode: forgotten.ok ? null : forgotten.failureCode,
      }),
    );
  } finally {
    await lock.release();
  }
}
