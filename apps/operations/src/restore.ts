import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "@myownnotion/blob-store";
import { generateUuidV7 } from "@myownnotion/domain";
import pg from "pg";
import {
  type BackupCounts,
  type BackupProcessRuntime,
  createPostgresEnvironment,
  createResticEnvironment,
  hashFile,
  listDatabaseSchemaVersions,
} from "./backup.ts";
import { acquireExclusiveFileLock } from "./locks.ts";
import {
  type BackupManifest,
  parseBackupManifest,
  validateBackupCompatibility,
} from "./manifest.ts";
import { runExternalJsonProcess, runExternalProcess } from "./process-runner.ts";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";

export interface RestoreRepositoryInput {
  readonly snapshotId: string;
  readonly stagingRoot: string;
  readonly lockPath: string;
  readonly migrationsRoot: string;
  readonly postgresMajor: number;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly processRuntime?: BackupProcessRuntime;
  readonly now?: () => Date;
}

export interface RestoreApplyInput extends RestoreRepositoryInput {
  readonly databaseUrl: string;
  readonly targetBlobStore: BlobStore;
  readonly guardPath: string;
  readonly confirmEmpty: boolean;
  readonly readDatabaseCounts?: (databaseUrl: string) => Promise<BackupCounts>;
}

export interface VerifiedBackupStaging {
  readonly manifest: BackupManifest;
  readonly directory: string;
  cleanup(): Promise<void>;
}

const SNAPSHOT_PATTERN = /^[a-f0-9]{8,64}$/;
const defaultRuntime: BackupProcessRuntime = {
  run: runExternalProcess,
  runJson: runExternalJsonProcess,
};

export class RestoreFailure extends Error {
  constructor(readonly failureCode: string) {
    super(failureCode);
    this.name = "RestoreFailure";
  }
}

function parseSelectedCompleteSnapshot(value: unknown, expectedId: string): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new TypeError("selected snapshot is unavailable");
  }
  const entry = value[0];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError("selected snapshot is invalid");
  }
  const record = entry as Record<string, unknown>;
  if (
    record["id"] !== expectedId ||
    !Array.isArray(record["tags"]) ||
    !record["tags"].includes("myownnotion-complete")
  ) {
    throw new TypeError("selected snapshot is incomplete");
  }
  return expectedId;
}

async function listRelativeFiles(root: string, relative = ""): Promise<string[]> {
  const current = path.join(root, relative);
  const names = await readdir(current);
  const files: string[] = [];
  for (const name of names.sort()) {
    const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
    const metadata = await lstat(path.join(root, childRelative));
    if (metadata.isSymbolicLink()) throw new RestoreFailure("restore.staging-link-rejected");
    if (metadata.isDirectory()) {
      files.push(...(await listRelativeFiles(root, childRelative)));
    } else if (metadata.isFile()) {
      files.push(childRelative);
    } else {
      throw new RestoreFailure("restore.staging-entry-rejected");
    }
  }
  if (files.length > 1_000_002) throw new RestoreFailure("restore.staging-too-large");
  return files;
}

function manifestCounts(manifest: BackupManifest): Readonly<Record<string, number>> {
  return {
    objects: manifest.objects.length,
    bytes: manifest.objects.reduce((sum, object) => sum + object.byteLength, 0),
    workspaces: manifest.counts.workspaces,
    items: manifest.counts.items,
    revisions: manifest.counts.revisions,
  };
}

export async function stageVerifiedBackup(
  input: RestoreRepositoryInput,
): Promise<VerifiedBackupStaging> {
  if (!SNAPSHOT_PATTERN.test(input.snapshotId)) {
    throw new RestoreFailure("restore.snapshot-invalid");
  }
  const runtime = input.processRuntime ?? defaultRuntime;
  await mkdir(input.stagingRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(input.stagingRoot, "restore-"));
  const cleanup = async (): Promise<void> => rm(directory, { recursive: true, force: true });
  try {
    const resticEnv = createResticEnvironment(
      input.environment,
      path.join(input.stagingRoot, ".restic-cache"),
    );
    const selected = await runtime.runJson(
      {
        executable: "restic",
        arguments: ["snapshots", "--json", "--tag", "myownnotion-complete", input.snapshotId],
        env: resticEnv,
        failureCode: "restore.snapshot-unavailable",
      },
      (value) => parseSelectedCompleteSnapshot(value, input.snapshotId),
    );
    if (!selected.ok) throw new RestoreFailure(selected.failureCode);
    const repositoryCheck = await runtime.run({
      executable: "restic",
      arguments: ["check"],
      env: resticEnv,
      failureCode: "restore.repository-check-failed",
    });
    if (!repositoryCheck.ok) throw new RestoreFailure(repositoryCheck.failureCode);
    const restored = await runtime.run({
      executable: "restic",
      arguments: ["restore", input.snapshotId, "--target", directory],
      env: resticEnv,
      failureCode: "restore.decrypt-failed",
    });
    if (!restored.ok) throw new RestoreFailure(restored.failureCode);

    const manifest = parseBackupManifest(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    if (manifest.status !== "complete") throw new RestoreFailure("restore.manifest-incomplete");
    const targetSchemaVersions = await listDatabaseSchemaVersions(input.migrationsRoot);
    const compatibility = validateBackupCompatibility(manifest, {
      databaseSchemaVersions: targetSchemaVersions,
      postgresMajor: input.postgresMajor,
    });
    if (!compatibility.compatible) throw new RestoreFailure(compatibility.failureCode);

    const dump = await hashFile(path.join(directory, manifest.database.path));
    if (
      dump.byteLength !== manifest.database.byteLength ||
      dump.sha256 !== manifest.database.sha256
    ) {
      throw new RestoreFailure("restore.database-integrity-failed");
    }
    for (const object of manifest.objects) {
      const observed = await hashFile(path.join(directory, object.path));
      if (observed.byteLength !== object.byteLength || observed.sha256 !== object.sha256) {
        throw new RestoreFailure("restore.object-integrity-failed");
      }
    }
    const files = await listRelativeFiles(directory);
    const expectedFiles = [
      "manifest.json",
      manifest.database.path,
      ...manifest.objects.map((object) => object.path),
    ].sort();
    if (
      files.length !== expectedFiles.length ||
      files.some((file, index) => file !== expectedFiles[index])
    ) {
      throw new RestoreFailure("restore.staging-inventory-mismatch");
    }
    const archive = await runtime.run({
      executable: "pg_restore",
      arguments: ["--list", path.join(directory, manifest.database.path)],
      failureCode: "restore.database-archive-invalid",
    });
    if (!archive.ok) throw new RestoreFailure(archive.failureCode);
    return { manifest, directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function operationIdentity(now: () => Date): { operationId: string; startedAt: string } {
  const startedAt = now();
  return {
    operationId: generateUuidV7(() => startedAt.getTime()),
    startedAt: startedAt.toISOString(),
  };
}

function failureCode(error: unknown): string {
  return error instanceof RestoreFailure ? error.failureCode : "restore.verification-failed";
}

function safeSnapshotIdentity(snapshotId: string): { snapshotId: string } | object {
  return SNAPSHOT_PATTERN.test(snapshotId) ? { snapshotId } : {};
}

export async function verifyBackupForRestore(
  input: RestoreRepositoryInput,
): Promise<SafeOperationResult> {
  const now = input.now ?? (() => new Date());
  const identity = operationIdentity(now);
  const lock = await acquireExclusiveFileLock(input.lockPath, identity);
  if (lock === null) {
    return createSafeOperationResult({
      ...identity,
      command: "restore.verify",
      status: "failed",
      finishedAt: now().toISOString(),
      counts: {},
      failureCode: "operation.already-running",
    });
  }
  let staged: VerifiedBackupStaging | null = null;
  try {
    staged = await stageVerifiedBackup(input);
    return createSafeOperationResult({
      ...identity,
      command: "restore.verify",
      status: "succeeded",
      finishedAt: now().toISOString(),
      snapshotId: input.snapshotId,
      counts: manifestCounts(staged.manifest),
      failureCode: null,
    });
  } catch (error) {
    return createSafeOperationResult({
      ...identity,
      command: "restore.verify",
      status: "failed",
      finishedAt: now().toISOString(),
      ...safeSnapshotIdentity(input.snapshotId),
      counts: {},
      failureCode: failureCode(error),
    });
  } finally {
    await staged?.cleanup();
    await lock.release();
  }
}

async function readDatabaseCounts(databaseUrl: string): Promise<BackupCounts> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const result = await client.query<Record<keyof BackupCounts, number>>(`
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
    const row = result.rows[0];
    if (row === undefined) throw new RestoreFailure("restore.database-count-failed");
    return {
      workspaces: Number(row.workspaces),
      items: Number(row.items),
      placements: Number(row.placements),
      revisions: Number(row.revisions),
      relationships: Number(row.relationships),
      pageDocuments: Number(row.pageDocuments),
      logicalFiles: Number(row.logicalFiles),
      contentObjects: Number(row.contentObjects),
    };
  } finally {
    await client.end();
  }
}

function sameCounts(left: BackupCounts, right: BackupManifest["counts"]): boolean {
  return (Object.keys(right) as Array<keyof BackupCounts>).every((key) => left[key] === right[key]);
}

async function createRestoreGuard(
  guardPath: string,
  operationId: string,
  startedAt: string,
): Promise<void> {
  await mkdir(path.dirname(guardPath), { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(guardPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new RestoreFailure("restore.guard-exists");
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ operationId, startedAt })}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function verifyRestoredObjects(
  blobStore: BlobStore,
  manifest: BackupManifest,
): Promise<boolean> {
  const keys = await blobStore.list({ includeTemporary: true });
  const expectedKeys = manifest.objects.map((object) => object.storageKey).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  for (const object of manifest.objects) {
    const opened = await blobStore.open(object.storageKey);
    if (opened === null) return false;
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of opened.body) {
      byteLength += chunk.byteLength;
      hash.update(chunk);
    }
    if (byteLength !== object.byteLength || hash.digest("hex") !== object.sha256) return false;
  }
  return true;
}

export async function applyVerifiedBackup(input: RestoreApplyInput): Promise<SafeOperationResult> {
  const now = input.now ?? (() => new Date());
  const identity = operationIdentity(now);
  if (!input.confirmEmpty) throw new RestoreFailure("restore.confirmation-required");
  const lock = await acquireExclusiveFileLock(input.lockPath, identity);
  if (lock === null) {
    return createSafeOperationResult({
      ...identity,
      command: "restore.apply",
      status: "failed",
      finishedAt: now().toISOString(),
      snapshotId: input.snapshotId,
      counts: {},
      failureCode: "operation.already-running",
    });
  }
  let staged: VerifiedBackupStaging | null = null;
  let guardCreated = false;
  try {
    staged = await stageVerifiedBackup(input);
    const databaseCounts = input.readDatabaseCounts ?? readDatabaseCounts;
    const beforeCounts = await databaseCounts(input.databaseUrl);
    if (Object.values(beforeCounts).some((count) => count !== 0)) {
      throw new RestoreFailure("restore.database-not-empty");
    }
    if ((await input.targetBlobStore.list({ includeTemporary: true })).length !== 0) {
      throw new RestoreFailure("restore.storage-not-empty");
    }
    await createRestoreGuard(input.guardPath, identity.operationId, identity.startedAt);
    guardCreated = true;
    const runtime = input.processRuntime ?? defaultRuntime;
    const databaseRestore = await runtime.run({
      executable: "pg_restore",
      arguments: [
        "--exit-on-error",
        "--single-transaction",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        path.join(staged.directory, staged.manifest.database.path),
      ],
      env: createPostgresEnvironment(input.databaseUrl, input.environment),
      failureCode: "restore.database-apply-failed",
    });
    if (!databaseRestore.ok) throw new RestoreFailure(databaseRestore.failureCode);
    for (const object of staged.manifest.objects) {
      const stored = await input.targetBlobStore.putVerifiedAt(
        object.storageKey,
        createReadStream(path.join(staged.directory, object.path)),
        { maxByteLength: object.byteLength },
      );
      if (
        stored.storageKey !== object.storageKey ||
        stored.byteLength !== object.byteLength ||
        Buffer.from(stored.sha256).toString("hex") !== object.sha256
      ) {
        throw new RestoreFailure("restore.object-apply-failed");
      }
    }
    const afterCounts = await databaseCounts(input.databaseUrl);
    if (!sameCounts(afterCounts, staged.manifest.counts)) {
      throw new RestoreFailure("restore.database-verification-failed");
    }
    if (!(await verifyRestoredObjects(input.targetBlobStore, staged.manifest))) {
      throw new RestoreFailure("restore.object-verification-failed");
    }
    await rm(input.guardPath, { force: true });
    guardCreated = false;
    return createSafeOperationResult({
      ...identity,
      command: "restore.apply",
      status: "succeeded",
      finishedAt: now().toISOString(),
      snapshotId: input.snapshotId,
      counts: manifestCounts(staged.manifest),
      failureCode: null,
    });
  } catch (error) {
    return createSafeOperationResult({
      ...identity,
      command: "restore.apply",
      status: "failed",
      finishedAt: now().toISOString(),
      ...safeSnapshotIdentity(input.snapshotId),
      counts: { guarded: guardCreated ? 1 : 0 },
      failureCode: error instanceof RestoreFailure ? error.failureCode : "restore.apply-failed",
    });
  } finally {
    await staged?.cleanup();
    await lock.release();
  }
}
