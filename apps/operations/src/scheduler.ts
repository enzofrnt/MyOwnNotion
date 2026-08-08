import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";

export interface UtcSchedule {
  readonly hour: number;
  readonly minute: number;
}

export interface BackupSchedulerInput {
  readonly scheduleUtc: string;
  readonly statePath: string;
  readonly createBackup: () => Promise<SafeOperationResult>;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxTicks?: number;
}

interface ScheduleState {
  readonly lastAttemptDate: string;
}

export function parseUtcSchedule(value: string): UtcSchedule {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (
    match === null ||
    !Number.isSafeInteger(hour) ||
    !Number.isSafeInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new TypeError("backup UTC schedule is invalid");
  }
  return { hour, minute };
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function scheduledTime(date: Date, schedule: UtcSchedule): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    schedule.hour,
    schedule.minute,
  );
}

export function isScheduledBackupDue(
  now: Date,
  schedule: UtcSchedule,
  lastAttemptDate: string | null,
): boolean {
  return now.getTime() >= scheduledTime(now, schedule) && lastAttemptDate !== utcDate(now);
}

async function readState(statePath: string): Promise<ScheduleState | null> {
  let serialized: string;
  try {
    serialized = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (Buffer.byteLength(serialized) > 1_024) throw new RangeError("schedule state is too large");
  const value = JSON.parse(serialized) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("schedule state is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).join(",") !== "lastAttemptDate" ||
    typeof record["lastAttemptDate"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record["lastAttemptDate"])
  ) {
    throw new TypeError("schedule state is invalid");
  }
  return { lastAttemptDate: record["lastAttemptDate"] };
}

async function writeState(statePath: string, state: ScheduleState): Promise<void> {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${path.basename(statePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, statePath);
    await chmod(statePath, 0o600);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function runScheduledBackupTick(
  input: Omit<BackupSchedulerInput, "sleep" | "maxTicks">,
): Promise<SafeOperationResult> {
  const now = input.now ?? (() => new Date());
  const current = now();
  const operationId = generateUuidV7(() => current.getTime());
  const schedule = parseUtcSchedule(input.scheduleUtc);
  const state = await readState(input.statePath);
  if (!isScheduledBackupDue(current, schedule, state?.lastAttemptDate ?? null)) {
    return createSafeOperationResult({
      operationId,
      command: "backup.schedule",
      status: "succeeded",
      startedAt: current.toISOString(),
      finishedAt: now().toISOString(),
      counts: { attempted: 0, skipped: 1 },
      failureCode: null,
    });
  }
  await writeState(input.statePath, { lastAttemptDate: utcDate(current) });
  const backup = await input.createBackup();
  return createSafeOperationResult({
    operationId,
    command: "backup.schedule",
    status: backup.status,
    startedAt: current.toISOString(),
    finishedAt: now().toISOString(),
    ...(backup.snapshotId === undefined ? {} : { snapshotId: backup.snapshotId }),
    counts: {
      attempted: 1,
      skipped: backup.failureCode === "operation.already-running" ? 1 : 0,
      succeeded: backup.status === "succeeded" ? 1 : 0,
    },
    failureCode: backup.failureCode,
  });
}

function millisecondsUntilNextMinute(now: Date): number {
  return Math.max(1_000, 60_000 - (now.getUTCSeconds() * 1_000 + now.getUTCMilliseconds()));
}

export async function runBackupScheduler(
  input: BackupSchedulerInput,
): Promise<SafeOperationResult> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  parseUtcSchedule(input.scheduleUtc);
  let ticks = 0;
  while (input.maxTicks === undefined || ticks < input.maxTicks) {
    const result = await runScheduledBackupTick({ ...input, now });
    ticks += 1;
    if (input.maxTicks !== undefined && ticks >= input.maxTicks) return result;
    await sleep(millisecondsUntilNextMinute(now()));
  }
  throw new Error("backup scheduler stopped unexpectedly");
}
