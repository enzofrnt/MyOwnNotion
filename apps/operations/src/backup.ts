import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "@myownnotion/blob-store";
import { generateUuidV7 } from "@myownnotion/domain";
import pg from "pg";
import { acquireExclusiveFileLock } from "./locks.ts";
import {
  type BackupManifest,
  type BackupObjectRecord,
  parseBackupManifest,
  serializeBackupManifest,
} from "./manifest.ts";
import {
  type ExternalJsonProcessResult,
  type ExternalProcessOptions,
  type ExternalProcessResult,
  runExternalJsonProcess,
  runExternalProcess,
} from "./process-runner.ts";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";
import { writeOperationStatus } from "./status-store.ts";

export interface BackupCounts {
  readonly workspaces: number;
  readonly items: number;
  readonly placements: number;
  readonly revisions: number;
  readonly relationships: number;
  readonly pageDocuments: number;
  readonly logicalFiles: number;
  readonly contentObjects: number;
}

export interface BackupInventoryRecord {
  readonly contentId: string;
  readonly storageKey: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface BackupSnapshotSession {
  readonly exportedSnapshot: string;
  readonly postgresVersion: string;
  readonly counts: BackupCounts;
  readonly inventory: readonly BackupInventoryRecord[];
  finishSnapshot(): Promise<void>;
  close(): Promise<void>;
}

export interface BackupToolVersions {
  readonly node: string;
  readonly restic: string;
  readonly rclone: string;
}

export interface BackupProcessRuntime {
  run(options: ExternalProcessOptions): Promise<ExternalProcessResult>;
  runJson<T>(
    options: ExternalProcessOptions,
    parse: (value: unknown) => T,
  ): Promise<ExternalJsonProcessResult<T>>;
}

export interface CreateEncryptedBackupInput {
  readonly databaseUrl: string;
  readonly blobStore: BlobStore;
  readonly stagingRoot: string;
  readonly lockPath: string;
  readonly statusPath: string;
  readonly migrationsRoot: string;
  readonly sourceRevision: string;
  readonly toolVersions: BackupToolVersions;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly processRuntime?: BackupProcessRuntime;
  readonly snapshotFactory?: (databaseUrl: string) => Promise<BackupSnapshotSession>;
  readonly now?: () => Date;
}

const BACKUP_ADVISORY_LOCK = 1_299_144_366;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{7,64}$/;
const SNAPSHOT_ID_PATTERN = /^[a-f0-9]{8,64}$/;

export class BackupFailure extends Error {
  constructor(readonly failureCode: string) {
    super(failureCode);
    this.name = "BackupFailure";
  }
}

function safeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BackupFailure(`backup.${label}-invalid`);
  }
  return parsed;
}

export async function openBackupSnapshot(databaseUrl: string): Promise<BackupSnapshotSession> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  let transactionOpen = false;
  let advisoryLockHeld = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [BACKUP_ADVISORY_LOCK],
    );
    if (lock.rows[0]?.acquired !== true) {
      throw new BackupFailure("operation.already-running");
    }
    advisoryLockHeld = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const snapshot = await client.query<{ snapshot: string }>(
      "SELECT pg_export_snapshot() AS snapshot",
    );
    const version = await client.query<{ server_version: string }>("SHOW server_version");
    const countsResult = await client.query<Record<keyof BackupCounts, number>>(`
      SELECT
        (SELECT count(*)::integer FROM workspaces) AS workspaces,
        (SELECT count(*)::integer FROM items) AS items,
        (SELECT count(*)::integer FROM placements) AS placements,
        (SELECT count(*)::integer FROM revisions) AS revisions,
        (SELECT count(*)::integer FROM relationships) AS relationships,
        (SELECT count(*)::integer FROM page_documents) AS "pageDocuments",
        (SELECT count(*)::integer FROM logical_files) AS "logicalFiles",
        (SELECT count(*)::integer FROM file_contents WHERE reference_count > 0) AS "contentObjects"
    `);
    const inventoryResult = await client.query<{
      contentId: string;
      storageKey: string;
      byteLength: string | number;
      sha256: string;
    }>(`
      SELECT
        id::text AS "contentId",
        storage_key AS "storageKey",
        byte_length AS "byteLength",
        encode(sha256, 'hex') AS sha256
      FROM file_contents
      WHERE reference_count > 0 AND verified_at IS NOT NULL
      ORDER BY id
    `);
    const countRow = countsResult.rows[0];
    const exportedSnapshot = snapshot.rows[0]?.snapshot;
    const postgresVersion = version.rows[0]?.server_version;
    if (countRow === undefined || exportedSnapshot === undefined || postgresVersion === undefined) {
      throw new BackupFailure("backup.snapshot-invalid");
    }
    const counts: BackupCounts = {
      workspaces: safeInteger(countRow.workspaces, "count"),
      items: safeInteger(countRow.items, "count"),
      placements: safeInteger(countRow.placements, "count"),
      revisions: safeInteger(countRow.revisions, "count"),
      relationships: safeInteger(countRow.relationships, "count"),
      pageDocuments: safeInteger(countRow.pageDocuments, "count"),
      logicalFiles: safeInteger(countRow.logicalFiles, "count"),
      contentObjects: safeInteger(countRow.contentObjects, "count"),
    };
    const inventory = inventoryResult.rows.map((row) => ({
      contentId: row.contentId,
      storageKey: row.storageKey,
      byteLength: safeInteger(row.byteLength, "object-length"),
      sha256: row.sha256,
    }));
    if (inventory.length !== counts.contentObjects) {
      throw new BackupFailure("backup.inventory-incomplete");
    }
    let closed = false;
    const finishSnapshot = async (): Promise<void> => {
      if (!transactionOpen) return;
      transactionOpen = false;
      await client.query("COMMIT");
    };
    return {
      exportedSnapshot,
      postgresVersion,
      counts,
      inventory,
      finishSnapshot,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await finishSnapshot();
        } finally {
          if (advisoryLockHeld) {
            advisoryLockHeld = false;
            await client
              .query("SELECT pg_advisory_unlock($1)", [BACKUP_ADVISORY_LOCK])
              .catch(() => undefined);
          }
          await client.end();
        }
      },
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (advisoryLockHeld) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [BACKUP_ADVISORY_LOCK])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    throw error;
  }
}

export async function listDatabaseSchemaVersions(migrationsRoot: string): Promise<string[]> {
  const names = await readdir(migrationsRoot);
  const versions = names
    .filter((name) => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name))
    .map((name) => name.slice(0, -4))
    .sort();
  if (versions.length === 0) {
    throw new BackupFailure("backup.schema-unavailable");
  }
  return versions;
}

export async function hashFile(filePath: string): Promise<{ byteLength: number; sha256: string }> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  let byteLength = 0;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      byteLength += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return { byteLength, sha256: hash.digest("hex") };
}

async function stageObject(
  blobStore: BlobStore,
  stagingRoot: string,
  expected: BackupInventoryRecord,
): Promise<BackupObjectRecord> {
  const opened = await blobStore.open(expected.storageKey);
  if (opened === null) throw new BackupFailure("backup.object-missing");
  const relativePath = `objects/${expected.sha256.slice(0, 2)}/${expected.contentId}`;
  const targetPath = path.join(stagingRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const handle = await open(targetPath, "wx", 0o600);
  try {
    for await (const chunk of opened.body) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
        if (bytesWritten === 0) throw new BackupFailure("backup.object-write-failed");
        offset += bytesWritten;
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const observed = await hashFile(targetPath);
  if (observed.byteLength !== expected.byteLength || observed.sha256 !== expected.sha256) {
    throw new BackupFailure("backup.object-integrity-failed");
  }
  return {
    contentId: expected.contentId,
    storageKey: expected.storageKey,
    path: relativePath,
    byteLength: observed.byteLength,
    sha256: observed.sha256,
  };
}

export function createPostgresEnvironment(
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new BackupFailure("backup.database-url-invalid");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.hostname.length === 0 || database.length === 0) {
    throw new BackupFailure("backup.database-url-invalid");
  }
  return {
    PATH: environment["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: "10",
    ...(url.searchParams.get("sslmode") === null
      ? {}
      : { PGSSLMODE: url.searchParams.get("sslmode") as string }),
  };
}

export function createResticEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  cacheDirectory: string,
): Readonly<Record<string, string>> {
  const repository = environment["RESTIC_REPOSITORY"]?.trim();
  const passwordFile = environment["RESTIC_PASSWORD_FILE"]?.trim();
  if (repository === undefined || repository.length === 0) {
    throw new BackupFailure("backup.repository-required");
  }
  if (passwordFile === undefined || passwordFile.length === 0) {
    throw new BackupFailure("backup.password-file-required");
  }
  return {
    PATH: environment["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    RESTIC_REPOSITORY: repository,
    RESTIC_PASSWORD_FILE: passwordFile,
    RESTIC_CACHE_DIR: cacheDirectory,
    ...(environment["RCLONE_CONFIG"] === undefined
      ? {}
      : { RCLONE_CONFIG: environment["RCLONE_CONFIG"] }),
  };
}

function snapshotIdFromList(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new TypeError("restic snapshot result is invalid");
  }
  const candidate = value[0];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new TypeError("restic snapshot result is invalid");
  }
  const snapshotId = (candidate as Record<string, unknown>)["id"];
  if (typeof snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    throw new TypeError("restic snapshot identity is invalid");
  }
  return snapshotId;
}

const defaultProcessRuntime: BackupProcessRuntime = {
  run: runExternalProcess,
  runJson: runExternalJsonProcess,
};

export async function createEncryptedBackup(
  input: CreateEncryptedBackupInput,
): Promise<SafeOperationResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const operationId = generateUuidV7(() => startedAt.getTime());
  const processRuntime = input.processRuntime ?? defaultProcessRuntime;
  if (!SOURCE_REVISION_PATTERN.test(input.sourceRevision)) {
    throw new BackupFailure("backup.source-revision-invalid");
  }
  const lock = await acquireExclusiveFileLock(input.lockPath, {
    operationId,
    startedAt: startedAt.toISOString(),
  });
  if (lock === null) {
    return createSafeOperationResult({
      operationId,
      command: "backup.create",
      status: "failed",
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      counts: {},
      failureCode: "operation.already-running",
    });
  }

  let snapshot: BackupSnapshotSession | null = null;
  let stagingDirectory: string | null = null;
  let counts: Readonly<Record<string, number>> = {};
  let snapshotCounts: BackupCounts | null = null;
  let snapshotInventory: readonly BackupInventoryRecord[] = [];
  let postgresVersion = "";
  const persist = async (result: SafeOperationResult): Promise<SafeOperationResult> => {
    await writeOperationStatus(input.statusPath, result);
    return result;
  };
  try {
    await persist(
      createSafeOperationResult({
        operationId,
        command: "backup.create",
        status: "running",
        startedAt: startedAt.toISOString(),
        finishedAt: null,
        counts: {},
        failureCode: null,
      }),
    );
    await mkdir(input.stagingRoot, { recursive: true, mode: 0o700 });
    stagingDirectory = await mkdtemp(path.join(input.stagingRoot, "backup-"));
    await mkdir(path.join(stagingDirectory, "database"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(stagingDirectory, "objects"), { recursive: true, mode: 0o700 });
    const resticEnv = createResticEnvironment(
      input.environment,
      path.join(input.stagingRoot, ".restic-cache"),
    );
    const schemaVersions = await listDatabaseSchemaVersions(input.migrationsRoot);
    snapshot = await (input.snapshotFactory ?? openBackupSnapshot)(input.databaseUrl);
    snapshotCounts = snapshot.counts;
    snapshotInventory = snapshot.inventory;
    postgresVersion = snapshot.postgresVersion;
    counts = {
      objects: snapshotInventory.length,
      bytes: snapshotInventory.reduce((sum, object) => sum + object.byteLength, 0),
    };
    const dumpPath = path.join(stagingDirectory, "database", "myownnotion.dump");
    const dump = await processRuntime.run({
      executable: "pg_dump",
      arguments: [
        "--format=custom",
        "--data-only",
        "--exclude-table-data=schema_migrations",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot.exportedSnapshot}`,
        `--file=${dumpPath}`,
      ],
      env: createPostgresEnvironment(input.databaseUrl, input.environment),
      failureCode: "backup.database-dump-failed",
    });
    if (!dump.ok) throw new BackupFailure(dump.failureCode);
    await snapshot.finishSnapshot();

    const objects: BackupObjectRecord[] = [];
    for (const expected of snapshotInventory) {
      objects.push(await stageObject(input.blobStore, stagingDirectory, expected));
    }
    if (snapshotCounts === null) throw new BackupFailure("backup.snapshot-invalid");
    const dumpDigest = await hashFile(dumpPath);
    const manifest: BackupManifest = {
      manifestVersion: 1,
      product: "myownnotion",
      createdAt: startedAt.toISOString(),
      sourceRevision: input.sourceRevision,
      databaseSchemaVersions: schemaVersions,
      toolVersions: {
        node: input.toolVersions.node,
        postgres: postgresVersion,
        restic: input.toolVersions.restic,
        rclone: input.toolVersions.rclone,
      },
      database: {
        path: "database/myownnotion.dump",
        format: "postgresql-custom",
        byteLength: dumpDigest.byteLength,
        sha256: dumpDigest.sha256,
      },
      objects,
      counts: snapshotCounts,
      status: "complete",
    };
    const manifestPath = path.join(stagingDirectory, "manifest.json");
    await writeFile(manifestPath, serializeBackupManifest(manifest), { mode: 0o600, flag: "wx" });
    parseBackupManifest(await readFile(manifestPath, "utf8"));

    const operationTag = `myownnotion-operation-${operationId}`;
    const backup = await processRuntime.run({
      executable: "restic",
      arguments: [
        "backup",
        "--tag",
        "myownnotion-staged",
        "--tag",
        operationTag,
        "manifest.json",
        "database",
        "objects",
      ],
      cwd: stagingDirectory,
      env: resticEnv,
      failureCode: "backup.repository-write-failed",
    });
    if (!backup.ok) throw new BackupFailure(backup.failureCode);
    const snapshots = await processRuntime.runJson(
      {
        executable: "restic",
        arguments: ["snapshots", "--json", "--latest", "1", "--tag", operationTag],
        env: resticEnv,
        failureCode: "backup.repository-query-failed",
      },
      snapshotIdFromList,
    );
    if (!snapshots.ok) throw new BackupFailure(snapshots.failureCode);
    const check = await processRuntime.run({
      executable: "restic",
      arguments: ["check"],
      env: resticEnv,
      failureCode: "backup.repository-check-failed",
    });
    if (!check.ok) throw new BackupFailure(check.failureCode);
    parseBackupManifest(await readFile(manifestPath, "utf8"));
    const tag = await processRuntime.run({
      executable: "restic",
      arguments: ["tag", "--add", "myownnotion-complete", snapshots.value],
      env: resticEnv,
      failureCode: "backup.complete-tag-failed",
    });
    if (!tag.ok) throw new BackupFailure(tag.failureCode);
    // restic rewrites snapshot metadata as a new identity; advertise the
    // complete-tagged id rather than the pre-tag staged identity.
    const completeSnapshots = await processRuntime.runJson(
      {
        executable: "restic",
        arguments: [
          "snapshots",
          "--json",
          "--latest",
          "1",
          "--tag",
          "myownnotion-complete",
          "--tag",
          operationTag,
        ],
        env: resticEnv,
        failureCode: "backup.repository-query-failed",
      },
      snapshotIdFromList,
    );
    if (!completeSnapshots.ok) throw new BackupFailure(completeSnapshots.failureCode);
    return await persist(
      createSafeOperationResult({
        operationId,
        command: "backup.create",
        status: "succeeded",
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        snapshotId: completeSnapshots.value,
        counts,
        failureCode: null,
      }),
    );
  } catch (error) {
    const failureCode =
      error instanceof BackupFailure ? error.failureCode : "backup.unexpected-failure";
    return await persist(
      createSafeOperationResult({
        operationId,
        command: "backup.create",
        status: "failed",
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        counts,
        failureCode,
      }),
    );
  } finally {
    await snapshot?.close().catch(() => undefined);
    if (stagingDirectory !== null) await rm(stagingDirectory, { recursive: true, force: true });
    await lock.release();
  }
}
