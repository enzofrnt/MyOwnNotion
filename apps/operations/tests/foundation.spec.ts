import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import { acquireExclusiveFileLock } from "../src/locks.ts";
import {
  type BackupManifest,
  canonicalizeBackupManifest,
  serializeBackupManifest,
} from "../src/manifest.ts";
import { runExternalJsonProcess, runExternalProcess } from "../src/process-runner.ts";
import { createSafeOperationResult } from "../src/result.ts";
import { readOperationStatus, writeOperationStatus } from "../src/status-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mon-operations-"));
  temporaryDirectories.push(directory);
  return directory;
}

function manifest(objects: BackupManifest["objects"]): BackupManifest {
  return {
    manifestVersion: 1,
    product: "myownnotion",
    createdAt: "2026-08-08T00:00:00.000Z",
    sourceRevision: "a".repeat(40),
    databaseSchemaVersions: ["0002_content_types", "0001_content_foundations"],
    toolVersions: { node: "24.0.0", postgres: "18", restic: "0.18", rclone: "1.72" },
    database: {
      path: "database/myownnotion.dump",
      format: "postgresql-custom",
      byteLength: 42,
      sha256: "d".repeat(64),
    },
    objects,
    counts: {
      workspaces: 1,
      items: 2,
      placements: 2,
      revisions: 2,
      relationships: 0,
      pageDocuments: 1,
      logicalFiles: 1,
      contentObjects: objects.length,
    },
    status: "staged",
  };
}

describe("operations foundation", () => {
  it("serializes manifests deterministically with sorted inventories", () => {
    const first = {
      contentId: "019c3e8e-3140-7a75-af40-7a4b74df0dd9",
      storageKey: "opaque/z",
      path: "objects/aa/019c3e8e-3140-7a75-af40-7a4b74df0dd9",
      byteLength: 9,
      sha256: "b".repeat(64),
    };
    const second = {
      contentId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      storageKey: "opaque/a",
      path: "objects/bb/019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      byteLength: 7,
      sha256: "a".repeat(64),
    };
    const left = serializeBackupManifest(manifest([first, second]));
    const right = serializeBackupManifest(manifest([second, first]));
    expect(left).toBe(right);
    const normalized = canonicalizeBackupManifest(manifest([first, second]));
    expect(normalized.databaseSchemaVersions).toEqual([
      "0001_content_foundations",
      "0002_content_types",
    ]);
    expect(normalized.objects.map((object) => object.contentId)).toEqual([
      second.contentId,
      first.contentId,
    ]);
  });

  it("returns a closed safe envelope and drops private or free-form fields", () => {
    const result = createSafeOperationResult({
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      command: "backup.create",
      status: "failed",
      startedAt: "2026-08-08T00:00:00.000Z",
      finishedAt: "2026-08-08T00:00:01.000Z",
      counts: { objects: 2, bytes: 51 },
      failureCode: "backup.repository-unavailable",
      password: "do-not-leak",
      storageKey: "private/object",
      stderr: "page contents and database url",
    });
    expect(result).toEqual({
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      command: "backup.create",
      status: "failed",
      startedAt: "2026-08-08T00:00:00.000Z",
      finishedAt: "2026-08-08T00:00:01.000Z",
      counts: { objects: 2, bytes: 51 },
      failureCode: "backup.repository-unavailable",
    });
    expect(JSON.stringify(result)).not.toMatch(/do-not-leak|private\/object|page contents/);
  });

  it("accepts a bounded redacted storage-audit envelope", () => {
    const result = createSafeOperationResult({
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      command: "storage.audit",
      status: "succeeded",
      startedAt: "2026-08-08T00:00:00.000Z",
      finishedAt: "2026-08-08T00:00:01.000Z",
      counts: {
        referenced: 1,
        missing: 0,
        mismatched: 0,
        temporary: 0,
        unreferenced: 0,
      },
      failureCode: null,
      findings: [],
    });
    expect(result).toMatchObject({
      command: "storage.audit",
      status: "succeeded",
      counts: { referenced: 1, missing: 0 },
      findings: [],
    });
  });

  it("accepts the canonical generated UUIDv7 as an operation identity", () => {
    const operationId = generateUuidV7();
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      createSafeOperationResult({
        operationId,
        command: "storage.audit",
        status: "succeeded",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        counts: {},
        failureCode: null,
      }).status,
    ).toBe("succeeded");
  });

  it("drains child output without returning command arguments, stdout, or stderr", async () => {
    const secret = "postgres://owner:password@private/database";
    const outcome = await runExternalProcess({
      executable: process.execPath,
      arguments: ["-e", `console.log(${JSON.stringify(secret)}); console.error('private file')`],
      failureCode: "external.failed",
    });
    expect(outcome).toEqual({ ok: true, exitCode: 0 });
    expect(JSON.stringify(outcome)).not.toContain(secret);
    expect(JSON.stringify(outcome)).not.toContain("private file");
  });

  it("captures only a validated bounded JSON projection from a child process", async () => {
    const secret = "private-value";
    const outcome = await runExternalJsonProcess(
      {
        executable: process.execPath,
        arguments: [
          "-e",
          `console.log(JSON.stringify({ snapshot_id: 'deadbeef', secret: '${secret}' }))`,
        ],
        failureCode: "external.failed",
      },
      (value) => {
        const candidate = value as Record<string, unknown>;
        if (typeof candidate["snapshot_id"] !== "string") throw new TypeError("invalid result");
        return { snapshotId: candidate["snapshot_id"] };
      },
    );
    expect(outcome).toEqual({ ok: true, exitCode: 0, value: { snapshotId: "deadbeef" } });
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it("atomically persists a bounded status file with owner-only permissions", async () => {
    const directory = await temporaryDirectory();
    const statusPath = path.join(directory, "backup.json");
    const status = createSafeOperationResult({
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      command: "backup.create",
      status: "running",
      startedAt: "2026-08-08T00:00:00.000Z",
      finishedAt: null,
      counts: { objects: 0, bytes: 0 },
      failureCode: null,
    });
    await writeOperationStatus(statusPath, status);
    expect(await readOperationStatus(statusPath)).toEqual(status);
    expect((await stat(statusPath)).mode & 0o077).toBe(0);
    expect((await readFile(statusPath, "utf8")).length).toBeLessThan(65_536);
  });

  it("allows one exclusive owner and releases the lock explicitly", async () => {
    const directory = await temporaryDirectory();
    const lockPath = path.join(directory, "operations.lock");
    const first = await acquireExclusiveFileLock(lockPath, {
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
      startedAt: "2026-08-08T00:00:00.000Z",
    });
    expect(first).not.toBeNull();
    expect(
      await acquireExclusiveFileLock(lockPath, {
        operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd8",
        startedAt: "2026-08-08T00:00:01.000Z",
      }),
    ).toBeNull();
    await first?.release();
    const next = await acquireExclusiveFileLock(lockPath, {
      operationId: "019c3e8e-3140-7a75-af40-7a4b74df0dd8",
      startedAt: "2026-08-08T00:00:01.000Z",
    });
    expect(next).not.toBeNull();
    await next?.release();
  });
});
