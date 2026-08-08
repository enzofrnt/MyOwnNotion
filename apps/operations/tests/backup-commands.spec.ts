import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { BackupProcessRuntime } from "../src/backup.ts";
import {
  checkBackupRepository,
  listCompleteBackups,
  pruneCompleteBackups,
  validateRetentionPolicy,
} from "../src/backup-maintenance.ts";
import { classifyOperationExitCode, runBackupCommand } from "../src/cli.ts";
import { acquireExclusiveFileLock } from "../src/locks.ts";
import type {
  ExternalJsonProcessResult,
  ExternalProcessOptions,
  ExternalProcessResult,
} from "../src/process-runner.ts";
import { createSafeOperationResult } from "../src/result.ts";
import { parseUtcSchedule, runScheduledBackupTick } from "../src/scheduler.ts";
import { writeOperationStatus } from "../src/status-store.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class Runtime implements BackupProcessRuntime {
  readonly calls: Array<{ executable: string; arguments: readonly string[] }> = [];
  fail = false;

  async run(options: ExternalProcessOptions): Promise<ExternalProcessResult> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    return this.fail
      ? { ok: false, exitCode: 1, failureCode: options.failureCode }
      : { ok: true, exitCode: 0 };
  }

  async runJson<T>(
    options: ExternalProcessOptions,
    parse: (value: unknown) => T,
  ): Promise<ExternalJsonProcessResult<T>> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    if (this.fail) return { ok: false, exitCode: 1, failureCode: options.failureCode };
    return {
      ok: true,
      exitCode: 0,
      value: parse([
        {
          id: "bbbbbbbb01234567",
          time: "2026-08-07T00:00:00.000Z",
          tags: ["myownnotion-staged", "myownnotion-complete"],
          paths: ["/private/staging"],
        },
        {
          id: "aaaaaaaa01234567",
          time: "2026-08-08T00:00:00.000Z",
          tags: ["myownnotion-complete"],
          hostname: "private-host",
        },
      ]),
    };
  }
}

async function fixture(): Promise<{
  readonly runtime: Runtime;
  readonly input: Parameters<typeof listCompleteBackups>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mon-maintenance-"));
  roots.push(root);
  const runtime = new Runtime();
  return {
    runtime,
    input: {
      environment: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        RESTIC_REPOSITORY: "rclone:offsite:myownnotion",
        RESTIC_PASSWORD_FILE: "/run/secrets/restic-password",
      },
      cacheRoot: path.join(root, "cache"),
      lockPath: path.join(root, "state", "operations.lock"),
      statusPath: path.join(root, "state", "backup.json"),
      processRuntime: runtime,
      now: () => new Date("2026-08-08T01:02:03.000Z"),
    },
  };
}

describe("backup maintenance commands", () => {
  it.each([
    ["success", "backup.create", "succeeded", null, {}, 0],
    ["invalid configuration", "backup.create", "failed", "backup.repository-required", {}, 2],
    ["overlap", "backup.create", "failed", "operation.already-running", {}, 3],
    ["restore preflight", "restore.verify", "failed", "restore.snapshot-unavailable", {}, 4],
    ["integrity", "backup.create", "failed", "backup.object-integrity-failed", {}, 5],
    ["dependency", "backup.create", "failed", "backup.database-dump-failed", {}, 6],
    ["guarded apply", "restore.apply", "failed", "restore.object-apply-failed", { guarded: 1 }, 7],
  ] as const)(
    "classifies %s with the documented exit code",
    (_label, command, status, failureCode, counts, exitCode) => {
      const result = createSafeOperationResult({
        operationId: generateUuidV7(),
        command,
        status,
        startedAt: "2026-08-08T01:30:00.000Z",
        finishedAt: "2026-08-08T01:31:00.000Z",
        counts,
        failureCode,
      });
      expect(classifyOperationExitCode(command, result)).toBe(exitCode);
    },
  );

  it("lists only closed snapshot identities and timestamps in stable order", async () => {
    const test = await fixture();
    const result = await listCompleteBackups(test.input);
    expect(result).toMatchObject({
      command: "backup.list",
      status: "succeeded",
      counts: { snapshots: 2 },
      snapshots: [
        { snapshotId: "aaaaaaaa01234567", createdAt: "2026-08-08T00:00:00.000Z" },
        { snapshotId: "bbbbbbbb01234567", createdAt: "2026-08-07T00:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/private-host|private\/staging|rclone:/);
    expect(test.runtime.calls[0]?.arguments).toEqual([
      "snapshots",
      "--json",
      "--tag",
      "myownnotion-complete",
    ]);
  });

  it("supports metadata and explicit full-data repository checks", async () => {
    const test = await fixture();
    expect(await checkBackupRepository(test.input, false)).toMatchObject({
      status: "succeeded",
      counts: { fullData: 0 },
    });
    expect(await checkBackupRepository(test.input, true)).toMatchObject({
      status: "succeeded",
      counts: { fullData: 1 },
    });
    expect(test.runtime.calls.map((call) => call.arguments)).toEqual([
      ["check"],
      ["check", "--read-data"],
    ]);
  });

  it("uses 7/4/12 in dry-run and mutates only after explicit confirmation", async () => {
    const test = await fixture();
    const policy = { daily: 7, weekly: 4, monthly: 12 };
    const dryRun = await pruneCompleteBackups(test.input, policy, false);
    expect(dryRun).toMatchObject({ status: "succeeded", counts: { confirmed: 0, ...policy } });
    const confirmed = await pruneCompleteBackups(test.input, policy, true);
    expect(confirmed).toMatchObject({ status: "succeeded", counts: { confirmed: 1, ...policy } });
    expect(test.runtime.calls[0]?.arguments).toContain("--dry-run");
    expect(test.runtime.calls[0]?.arguments).not.toContain("--prune");
    expect(test.runtime.calls[1]?.arguments).toContain("--prune");
    expect(test.runtime.calls[1]?.arguments).not.toContain("--dry-run");
  });

  it.each([
    { daily: 0, weekly: 4, monthly: 12 },
    { daily: 7, weekly: -1, monthly: 12 },
    { daily: 7, weekly: 4, monthly: 0 },
    { daily: 1.5, weekly: 4, monthly: 12 },
  ])("refuses empty or invalid retention policy $daily/$weekly/$monthly", (policy) => {
    expect(() => validateRetentionPolicy(policy)).toThrow();
  });

  it("refuses prune overlap before calling restic", async () => {
    const test = await fixture();
    const lock = await acquireExclusiveFileLock(test.input.lockPath, {
      operationId: generateUuidV7(),
      startedAt: new Date().toISOString(),
    });
    expect(lock).not.toBeNull();
    expect(
      await pruneCompleteBackups(test.input, { daily: 7, weekly: 4, monthly: 12 }, true),
    ).toMatchObject({ status: "failed", failureCode: "operation.already-running" });
    expect(test.runtime.calls).toEqual([]);
    await lock?.release();
  });

  it("runs once per UTC day and remembers the attempt across scheduler restarts", async () => {
    const test = await fixture();
    const statePath = path.join(path.dirname(test.input.lockPath), "schedule.json");
    let calls = 0;
    const createBackup = async () => {
      calls += 1;
      return createSafeOperationResult({
        operationId: generateUuidV7(),
        command: "backup.create",
        status: "succeeded",
        startedAt: "2026-08-08T01:30:00.000Z",
        finishedAt: "2026-08-08T01:31:00.000Z",
        snapshotId: "deadbeef01234567",
        counts: { objects: 1 },
        failureCode: null,
      });
    };
    const input = {
      scheduleUtc: "01:15",
      statePath,
      createBackup,
      now: () => new Date("2026-08-08T01:30:00.000Z"),
    };
    expect(await runScheduledBackupTick(input)).toMatchObject({
      status: "succeeded",
      snapshotId: "deadbeef01234567",
      counts: { attempted: 1, succeeded: 1 },
    });
    expect(await runScheduledBackupTick(input)).toMatchObject({
      status: "succeeded",
      counts: { attempted: 0, skipped: 1 },
    });
    expect(calls).toBe(1);
  });

  it("exposes the last safe backup status after a process restart", async () => {
    const test = await fixture();
    const previous = createSafeOperationResult({
      operationId: generateUuidV7(),
      command: "backup.create",
      status: "failed",
      startedAt: "2026-08-08T01:30:00.000Z",
      finishedAt: "2026-08-08T01:31:00.000Z",
      counts: { objects: 3, bytes: 42 },
      failureCode: "backup.repository-check-failed",
    });
    await writeOperationStatus(test.input.statusPath, previous);
    expect(
      await runBackupCommand("backup.status", [], {
        MYOWNNOTION_BACKUP_STATUS: test.input.statusPath,
      }),
    ).toMatchObject({
      command: "backup.status",
      status: "failed",
      counts: { objects: 3, bytes: 42 },
      failureCode: "backup.repository-check-failed",
    });
  });

  it("does not run before the configured UTC time and rejects invalid schedules", async () => {
    const test = await fixture();
    let calls = 0;
    const result = await runScheduledBackupTick({
      scheduleUtc: "23:45",
      statePath: path.join(path.dirname(test.input.lockPath), "schedule.json"),
      createBackup: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      now: () => new Date("2026-08-08T01:30:00.000Z"),
    });
    expect(result).toMatchObject({ counts: { attempted: 0, skipped: 1 } });
    expect(calls).toBe(0);
    expect(() => parseUtcSchedule("24:00")).toThrow();
    expect(() => parseUtcSchedule("1:30")).toThrow();
    expect(() => parseUtcSchedule("not-a-time")).toThrow();
  });
});
