import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type BlobStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import { afterEach, describe, expect, it } from "vitest";
import type { BackupCounts, BackupProcessRuntime } from "../src/backup.ts";
import type { BackupManifest } from "../src/manifest.ts";
import { serializeBackupManifest } from "../src/manifest.ts";
import type {
  ExternalJsonProcessResult,
  ExternalProcessOptions,
  ExternalProcessResult,
} from "../src/process-runner.ts";
import { applyVerifiedBackup } from "../src/restore.ts";

const SNAPSHOT_ID = "deadbeef01234567";
const CONTENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EMPTY_COUNTS: BackupCounts = {
  workspaces: 0,
  items: 0,
  placements: 0,
  revisions: 0,
  relationships: 0,
  pageDocuments: 0,
  logicalFiles: 0,
  contentObjects: 0,
};

const RESTORED_COUNTS: BackupCounts = {
  workspaces: 1,
  items: 2,
  placements: 2,
  revisions: 2,
  relationships: 0,
  pageDocuments: 1,
  logicalFiles: 1,
  contentObjects: 1,
};

class ApplyRuntime implements BackupProcessRuntime {
  readonly calls: Array<{ executable: string; arguments: readonly string[] }> = [];
  readonly dumpBytes = new TextEncoder().encode("custom postgres dump");
  readonly objectBytes = new TextEncoder().encode("verified private object");

  constructor(
    private readonly failDatabaseApply = false,
    private readonly useCollisionKey = false,
  ) {}

  async runJson<T>(
    options: ExternalProcessOptions,
    parse: (value: unknown) => T,
  ): Promise<ExternalJsonProcessResult<T>> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    return {
      ok: true,
      exitCode: 0,
      value: parse([{ id: SNAPSHOT_ID, tags: ["myownnotion-complete"] }]),
    };
  }

  async run(options: ExternalProcessOptions): Promise<ExternalProcessResult> {
    this.calls.push({ executable: options.executable, arguments: options.arguments });
    if (options.executable === "restic" && options.arguments[0] === "restore") {
      const target = options.arguments[options.arguments.indexOf("--target") + 1];
      if (target === undefined) throw new Error("missing restore target");
      const objectSha256 = digest(this.objectBytes);
      const storageKey = this.useCollisionKey
        ? `${objectSha256}-00000000-0000-4000-8000-000000000001`
        : objectSha256;
      const objectPath = `objects/${objectSha256.slice(0, 2)}/${CONTENT_ID}`;
      const manifest: BackupManifest = {
        manifestVersion: 1,
        product: "myownnotion",
        createdAt: "2026-08-08T00:00:00.000Z",
        sourceRevision: "a".repeat(40),
        databaseSchemaVersions: ["0001_content_foundations"],
        toolVersions: { node: "24.14.0", postgres: "18.4", restic: "0.18.1", rclone: "1.72.1" },
        database: {
          path: "database/myownnotion.dump",
          format: "postgresql-custom",
          byteLength: this.dumpBytes.byteLength,
          sha256: digest(this.dumpBytes),
        },
        objects: [
          {
            contentId: CONTENT_ID,
            storageKey,
            path: objectPath,
            byteLength: this.objectBytes.byteLength,
            sha256: objectSha256,
          },
        ],
        counts: RESTORED_COUNTS,
        status: "complete",
      };
      await mkdir(path.join(target, "database"), { recursive: true });
      await mkdir(path.dirname(path.join(target, objectPath)), { recursive: true });
      await writeFile(path.join(target, "manifest.json"), serializeBackupManifest(manifest));
      await writeFile(path.join(target, manifest.database.path), this.dumpBytes);
      await writeFile(path.join(target, objectPath), this.objectBytes);
    }
    if (
      options.executable === "pg_restore" &&
      options.arguments[0] !== "--list" &&
      this.failDatabaseApply
    ) {
      return { ok: false, exitCode: 1, failureCode: options.failureCode };
    }
    return { ok: true, exitCode: 0 };
  }
}

async function fixture(
  options: {
    readonly failDatabaseApply?: boolean;
    readonly useCollisionKey?: boolean;
    readonly counts?: readonly BackupCounts[];
    readonly blobStore?: BlobStore;
  } = {},
): Promise<{
  readonly input: Parameters<typeof applyVerifiedBackup>[0];
  readonly runtime: ApplyRuntime;
  readonly guardPath: string;
  readonly target: FilesystemBlobStore;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mon-restore-apply-"));
  roots.push(root);
  const migrationsRoot = path.join(root, "migrations");
  await mkdir(migrationsRoot, { recursive: true });
  await writeFile(path.join(migrationsRoot, "0001_content_foundations.sql"), "SELECT 1;\n");
  const target = new FilesystemBlobStore(path.join(root, "target-blobs"));
  const runtime = new ApplyRuntime(options.failDatabaseApply, options.useCollisionKey);
  const observedCounts = [...(options.counts ?? [EMPTY_COUNTS, RESTORED_COUNTS])];
  const guardPath = path.join(root, "state", ".restore-in-progress");
  return {
    runtime,
    target,
    guardPath,
    input: {
      snapshotId: SNAPSHOT_ID,
      stagingRoot: path.join(root, "staging"),
      lockPath: path.join(root, "state", "operations.lock"),
      migrationsRoot,
      postgresMajor: 18,
      environment: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        RESTIC_REPOSITORY: "rclone:offsite:private",
        RESTIC_PASSWORD_FILE: "/run/secrets/restic-password",
      },
      processRuntime: runtime,
      now: () => new Date("2026-08-08T00:00:01.000Z"),
      databaseUrl: "postgres://owner:private-password@database:5432/myownnotion",
      targetBlobStore: options.blobStore ?? target,
      guardPath,
      confirmEmpty: true,
      readDatabaseCounts: async () => observedCounts.shift() ?? RESTORED_COUNTS,
    },
  };
}

function failingBlobStore(delegate: FilesystemBlobStore): BlobStore {
  return {
    put: async () => {
      throw new Error("interrupted object apply");
    },
    putVerifiedAt: async () => {
      throw new Error("interrupted object apply");
    },
    head: (storageKey) => delegate.head(storageKey),
    open: (storageKey, range) => delegate.open(storageKey, range),
    list: (options) => delegate.list(options),
    compare: (left, right) => delegate.compare(left, right),
    get: (storageKey) => delegate.get(storageKey),
    equals: (storageKey, candidate) => delegate.equals(storageKey, candidate),
    delete: (storageKey) => delegate.delete(storageKey),
  };
}

describe("guarded restore apply", () => {
  it("applies to empty targets, cross-verifies, and removes the readiness guard only on success", async () => {
    const test = await fixture();
    const result = await applyVerifiedBackup(test.input);
    expect(result).toMatchObject({
      command: "restore.apply",
      status: "succeeded",
      snapshotId: SNAPSHOT_ID,
      counts: { objects: 1, workspaces: 1 },
      failureCode: null,
    });
    await expect(stat(test.guardPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await test.target.list()).toHaveLength(1);
    expect(
      test.runtime.calls.find(
        (call) => call.executable === "pg_restore" && call.arguments[0] !== "--list",
      )?.arguments,
    ).toEqual(
      expect.arrayContaining([
        "--data-only",
        "--dbname=myownnotion",
        expect.stringContaining("database/myownnotion.dump"),
      ]),
    );
  });

  it("reproduces a collision-suffixed canonical object key exactly", async () => {
    const test = await fixture({ useCollisionKey: true });
    const expectedKey = `${digest(test.runtime.objectBytes)}-00000000-0000-4000-8000-000000000001`;
    expect(await applyVerifiedBackup(test.input)).toMatchObject({ status: "succeeded" });
    expect(await test.target.list()).toEqual([expectedKey]);
    expect(await test.target.get(expectedKey)).toEqual(test.runtime.objectBytes);
  });

  it("stops before the guard and mutation when the database is not empty", async () => {
    const test = await fixture({ counts: [{ ...EMPTY_COUNTS, workspaces: 1 }] });
    expect(await applyVerifiedBackup(test.input)).toMatchObject({
      status: "failed",
      counts: { guarded: 0 },
      failureCode: "restore.database-not-empty",
    });
    await expect(stat(test.guardPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      test.runtime.calls.some(
        (call) => call.executable === "pg_restore" && call.arguments[0] !== "--list",
      ),
    ).toBe(false);
  });

  it("stops before the guard when object storage is not empty", async () => {
    const test = await fixture();
    await test.target.put(new TextEncoder().encode("existing"));
    expect(await applyVerifiedBackup(test.input)).toMatchObject({
      status: "failed",
      counts: { guarded: 0 },
      failureCode: "restore.storage-not-empty",
    });
    await expect(stat(test.guardPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the guard after a database apply interruption", async () => {
    const test = await fixture({ failDatabaseApply: true });
    expect(await applyVerifiedBackup(test.input)).toMatchObject({
      status: "failed",
      counts: { guarded: 1 },
      failureCode: "restore.database-apply-failed",
    });
    expect(await readFile(test.guardPath, "utf8")).not.toMatch(/password|offsite/);
  });

  it("preserves the guard after an object apply interruption", async () => {
    const base = await fixture();
    const test = await fixture({ blobStore: failingBlobStore(base.target) });
    expect(await applyVerifiedBackup(test.input)).toMatchObject({
      status: "failed",
      counts: { guarded: 1 },
      failureCode: "restore.apply-failed",
    });
    await expect(stat(test.guardPath)).resolves.toBeDefined();
  });

  it("preserves the guard when post-apply database counts disagree", async () => {
    const test = await fixture({ counts: [EMPTY_COUNTS, { ...RESTORED_COUNTS, revisions: 1 }] });
    expect(await applyVerifiedBackup(test.input)).toMatchObject({
      status: "failed",
      counts: { guarded: 1 },
      failureCode: "restore.database-verification-failed",
    });
    await expect(stat(test.guardPath)).resolves.toBeDefined();
  });
});
