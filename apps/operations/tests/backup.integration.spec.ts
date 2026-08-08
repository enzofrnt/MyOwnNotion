import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import { createDatabase, schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BackupProcessRuntime,
  type BackupSnapshotSession,
  createEncryptedBackup,
  openBackupSnapshot,
} from "../src/backup.ts";
import { acquireExclusiveFileLock } from "../src/locks.ts";
import { parseBackupManifest } from "../src/manifest.ts";
import type {
  ExternalJsonProcessResult,
  ExternalProcessOptions,
  ExternalProcessResult,
} from "../src/process-runner.ts";
import { readOperationStatus } from "../src/status-store.ts";

const roots: string[] = [];
let postgres: DisposablePostgres | null = null;

afterEach(async () => {
  if (postgres !== null) {
    await postgres.stop();
    postgres = null;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mon-backup-"));
  roots.push(directory);
  return directory;
}

class FakeProcessRuntime implements BackupProcessRuntime {
  readonly calls: Array<{ executable: string; arguments: readonly string[] }> = [];
  readonly manifests: string[] = [];

  constructor(private readonly failAt: string | null = null) {}

  async run(options: ExternalProcessOptions): Promise<ExternalProcessResult> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    const stage =
      options.executable === "pg_dump"
        ? "pg_dump"
        : options.executable === "restic"
          ? `restic:${options.arguments[0] ?? ""}`
          : options.executable;
    if (this.failAt === stage) {
      return { ok: false, exitCode: 1, failureCode: options.failureCode };
    }
    if (options.executable === "pg_dump") {
      const target = options.arguments.find((argument) => argument.startsWith("--file="));
      if (target === undefined) throw new Error("missing dump target");
      await writeFile(target.slice("--file=".length), "deterministic database dump", {
        mode: 0o600,
      });
    }
    if (options.executable === "restic" && options.arguments[0] === "backup") {
      const staging = options.cwd;
      if (staging === undefined) throw new Error("missing staging directory");
      this.manifests.push(await readFile(path.join(staging, "manifest.json"), "utf8"));
    }
    return { ok: true, exitCode: 0 };
  }

  async runJson<T>(
    options: ExternalProcessOptions,
    parse: (value: unknown) => T,
  ): Promise<ExternalJsonProcessResult<T>> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    if (this.failAt === "restic:snapshots") {
      return { ok: false, exitCode: 1, failureCode: options.failureCode };
    }
    return { ok: true, exitCode: 0, value: parse([{ id: "deadbeef01234567" }]) };
  }
}

async function fixture(failAt: string | null = null): Promise<{
  readonly runtime: FakeProcessRuntime;
  readonly input: Parameters<typeof createEncryptedBackup>[0];
  readonly root: string;
  readonly closeCount: { value: number };
}> {
  const directory = await root();
  const blobStore = new FilesystemBlobStore(path.join(directory, "blobs"));
  const bytes = new TextEncoder().encode("recoverable private object");
  const stored = await blobStore.put(bytes);
  const migrationsRoot = path.join(directory, "migrations");
  await mkdir(migrationsRoot, { recursive: true });
  await writeFile(path.join(migrationsRoot, "0001_content_foundations.sql"), "SELECT 1;\n");
  const runtime = new FakeProcessRuntime(failAt);
  const closeCount = { value: 0 };
  const snapshotFactory = async (): Promise<BackupSnapshotSession> => ({
    exportedSnapshot: "00000003-0000001B-1",
    postgresVersion: "18.4",
    counts: {
      workspaces: 1,
      items: 2,
      placements: 2,
      revisions: 2,
      relationships: 0,
      pageDocuments: 1,
      logicalFiles: 1,
      contentObjects: 1,
    },
    inventory: [
      {
        contentId: "019c3e8e-3140-7a75-af40-7a4b74df0dd7",
        storageKey: stored.storageKey,
        byteLength: stored.byteLength,
        sha256: Buffer.from(stored.sha256).toString("hex"),
      },
    ],
    finishSnapshot: async () => undefined,
    close: async () => {
      closeCount.value += 1;
    },
  });
  return {
    runtime,
    root: directory,
    closeCount,
    input: {
      databaseUrl: "postgres://owner:private-password@database:5432/myownnotion",
      blobStore,
      stagingRoot: path.join(directory, "staging"),
      lockPath: path.join(directory, "state", "operations.lock"),
      statusPath: path.join(directory, "state", "backup.json"),
      migrationsRoot,
      sourceRevision: "a".repeat(40),
      toolVersions: { node: "24.14.0", restic: "0.18.1", rclone: "1.72.1" },
      environment: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        RESTIC_REPOSITORY: "rclone:offsite:myownnotion",
        RESTIC_PASSWORD_FILE: "/run/secrets/restic-password",
      },
      processRuntime: runtime,
      snapshotFactory,
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    },
  };
}

describe("encrypted backup creation", () => {
  it("stages the exported database and exact verified objects before advertising one complete snapshot", async () => {
    const test = await fixture();
    const result = await createEncryptedBackup(test.input);
    expect(result).toMatchObject({
      command: "backup.create",
      status: "succeeded",
      snapshotId: "deadbeef01234567",
      counts: { objects: 1 },
      failureCode: null,
    });
    expect(test.closeCount.value).toBe(1);
    expect(test.runtime.manifests).toHaveLength(1);
    const manifest = parseBackupManifest(test.runtime.manifests[0] ?? "");
    expect(manifest).toMatchObject({
      status: "complete",
      counts: { contentObjects: 1 },
      database: { format: "postgresql-custom" },
    });
    expect(manifest.objects).toHaveLength(1);
    expect(test.runtime.calls.find((call) => call.executable === "pg_dump")?.arguments).toContain(
      "--exclude-table-data=schema_migrations",
    );
    expect(test.runtime.calls.at(-1)).toMatchObject({
      executable: "restic",
      arguments: ["tag", "--add", "myownnotion-complete", "deadbeef01234567"],
    });
    expect(await readOperationStatus(test.input.statusPath)).toEqual(result);
    expect(await readdir(test.input.stagingRoot)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private-password|storageKey|filename|rclone:/);
  });

  it.each([
    ["pg_dump", "backup.database-dump-failed"],
    ["restic:backup", "backup.repository-write-failed"],
    ["restic:snapshots", "backup.repository-query-failed"],
    ["restic:check", "backup.repository-check-failed"],
    ["restic:tag", "backup.complete-tag-failed"],
  ])("keeps a %s failure incomplete and redacted", async (stage, failureCode) => {
    const test = await fixture(stage);
    const result = await createEncryptedBackup(test.input);
    expect(result).toMatchObject({ status: "failed", failureCode });
    expect(result).not.toHaveProperty("snapshotId");
    const completeTags = test.runtime.calls.filter(
      (call) => call.executable === "restic" && call.arguments.includes("myownnotion-complete"),
    );
    expect(completeTags).toHaveLength(stage === "restic:tag" ? 1 : 0);
    expect(await readOperationStatus(test.input.statusPath)).toEqual(result);
  });

  it("fails closed when one snapshot-referenced object is missing", async () => {
    const test = await fixture();
    const keys = await test.input.blobStore.list();
    expect(keys).toHaveLength(1);
    await test.input.blobStore.delete(keys[0] ?? "");
    const result = await createEncryptedBackup(test.input);
    expect(result).toMatchObject({ status: "failed", failureCode: "backup.object-missing" });
    expect(test.runtime.calls.some((call) => call.executable === "restic")).toBe(false);
  });

  it("rejects overlap before opening a database snapshot or repository", async () => {
    const test = await fixture();
    const owner = await acquireExclusiveFileLock(test.input.lockPath, {
      operationId: generateUuidV7(),
      startedAt: new Date().toISOString(),
    });
    expect(owner).not.toBeNull();
    const result = await createEncryptedBackup(test.input);
    expect(result).toMatchObject({
      status: "failed",
      failureCode: "operation.already-running",
    });
    expect(test.runtime.calls).toEqual([]);
    expect(test.closeCount.value).toBe(0);
    await owner?.release();
  });

  it("captures counts and object inventory from one exported repeatable-read snapshot", async () => {
    postgres = await startMigratedPostgres();
    const database = createDatabase(postgres.connectionString);
    const session = await openBackupSnapshot(postgres.connectionString);
    await database.db.insert(schema.workspaces).values({ id: generateUuidV7(), schemaVersion: 1 });
    const currentRows = await database.db.select().from(schema.workspaces);
    expect(currentRows).toHaveLength(1);
    expect(session.counts.workspaces).toBe(0);
    expect(session.inventory).toEqual([]);
    expect(session.exportedSnapshot).toMatch(/^[0-9A-F]+-[0-9A-F]+-\d+$/i);
    await session.close();
    await database.close();
  });
});
