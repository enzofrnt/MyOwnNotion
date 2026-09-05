import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDatabase,
  findInstallation,
  migrate,
  migrationInventory,
  readStorageTransition,
  schema,
  workspaceMigrationsDir,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { type DisposablePostgres, startDisposablePostgres } from "@myownnotion/test-utils";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import { FullBackupReceipts } from "../src/backup/full/receipts.ts";
import { runGuardedMigrations } from "../src/backup/guarded-migration.ts";
import { FileStorageMigration } from "../src/security/file-storage-migration.ts";
import { createAuthenticatedPageOperationHarness } from "./helpers/authenticated-page-operations.ts";

const directories: string[] = [];
const databases: DisposablePostgres[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const database = await startDisposablePostgres();
  databases.push(database);
  const directory = await mkdtemp(join(tmpdir(), "mon-full-guard-test-"));
  directories.push(directory);
  const migrationsDir = join(directory, "migrations");
  await cp(workspaceMigrationsDir, migrationsDir, { recursive: true });
  const key = randomBytes(32);
  return {
    directory,
    key,
    input: {
      connectionString: database.connectionString,
      migrationsDir,
      runningVersion: "0.1.0",
      installationId: "018f2b7c-0000-7000-8000-000000000001",
      blobRoot: join(directory, "blobs"),
      backupRoot: join(directory, "backups"),
      deploymentKey: () => key,
    },
  };
}

describe("complete backup before the first migration mutation", () => {
  it("decrypts protected source content before recording a successful update", async () => {
    const harness = await createAuthenticatedPageOperationHarness();
    const directory = await mkdtemp(join(tmpdir(), "mon-full-protected-guard-"));
    directories.push(directory);
    try {
      await harness.reset();
      const page = await harness.createLegacyPage("Private migration sentinel");
      const key = Buffer.from(await readFile(harness.deploymentKeyFile, "utf8"), "base64");
      await runGuardedMigrations({
        connectionString: harness.api.postgres.connectionString,
        runningVersion: "0.2.0",
        installationId: "018f2b7c-0000-7000-8000-000000000001",
        blobRoot: harness.api.blobRoot,
        backupRoot: directory,
        deploymentKey: () => key,
      });
      expect(await findInstallation(harness.api.built.database.db)).toMatchObject({
        applicationVersion: "0.2.0",
      });
      const response = await harness.api.built.app.inject({
        method: "GET",
        url: `/v1/items/${page.itemId}`,
        headers: await harness.authenticate(),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).toContain("Private migration sentinel");
      expect(await new FullBackupReceipts(directory, () => key).list()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("refuses a source containing a migration unknown to the requested build", async () => {
    const { input } = await fixture();
    await runGuardedMigrations(input);
    await rm(join(input.migrationsDir, "0014_full_backup_provenance.sql"));
    await expect(runGuardedMigrations({ ...input, runningVersion: "0.2.0" })).rejects.toThrow(
      "migrations unknown to this build",
    );
    const handle = createDatabase(input.connectionString);
    try {
      expect((await findInstallation(handle.db))?.applicationVersion).toBe("0.1.0");
    } finally {
      await handle.close();
    }
    await expect(readdir(input.backupRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("initializes an empty database without requiring a fictitious previous backup", async () => {
    const { input } = await fixture();
    const applied = await runGuardedMigrations({
      ...input,
      deploymentKey: () => {
        throw new Error("No prior deployment key exists");
      },
    });
    expect(applied).toContain("0014_full_backup_provenance");
    await expect(readdir(input.backupRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves a source older than 0006 untouched on backup failure, then preserves its V0/unknown provenance", async () => {
    const { input, directory, key } = await fixture();
    await migrate(input.connectionString, {
      migrationsDir: input.migrationsDir,
      throughVersion: "0001_initial",
    });
    const before = await migrationInventory(input.connectionString, {
      migrationsDir: input.migrationsDir,
    });
    await expect(
      runGuardedMigrations({ ...input, deploymentKey: () => Buffer.alloc(3) }),
    ).rejects.toThrow("No migration or schema bootstrap");
    expect(
      (await migrationInventory(input.connectionString, { migrationsDir: input.migrationsDir }))
        .applied,
    ).toEqual(before.applied);
    const client = new pg.Client({ connectionString: input.connectionString });
    await client.connect();
    try {
      expect(
        (await client.query("SELECT to_regclass('public.backups') AS relation")).rows[0].relation,
      ).toBeNull();
    } finally {
      await client.end();
    }
    await runGuardedMigrations(input);
    const receipts = await new FullBackupReceipts(input.backupRoot, () => key).list();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.sourceVersion).toBeNull();
    const archive = await VerifiedFullArchive.open(
      join(input.backupRoot, `${receipts[0]?.backupId}.monfull`),
      key,
      directory,
    );
    try {
      expect(archive.manifest.source).toMatchObject({
        applicationVersion: null,
        appliedMigrations: ["0001_initial"],
      });
    } finally {
      await archive.close();
    }
    const handle = createDatabase(input.connectionString);
    try {
      expect(await findInstallation(handle.db)).toMatchObject({
        applicationVersion: "0.1.0",
        previousApplicationVersion: null,
        previousFullBackupId: receipts[0]?.backupId,
        previousBackupId: null,
      });
    } finally {
      await handle.close();
    }
  });

  it("retains a recoverable source archive and original version if a later migration fails", async () => {
    const { input, key } = await fixture();
    await runGuardedMigrations(input);
    await writeFile(
      join(input.migrationsDir, "0015_failed_update.sql"),
      "BEGIN; CREATE TABLE failed_update_marker(id integer); SELECT 1/0; COMMIT;",
    );
    await expect(runGuardedMigrations({ ...input, runningVersion: "0.2.0" })).rejects.toThrow();
    const receipts = await new FullBackupReceipts(input.backupRoot, () => key).list();
    expect(receipts[0]).toMatchObject({ sourceVersion: "0.1.0", reason: "pre-update" });
    const handle = createDatabase(input.connectionString);
    try {
      expect((await findInstallation(handle.db))?.applicationVersion).toBe("0.1.0");
      expect(
        (await handle.pool.query("SELECT to_regclass('public.failed_update_marker') AS relation"))
          .rows[0].relation,
      ).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it("permits a verified local safety backup during a remote outage and records the new version only after integrity succeeds", async () => {
    const { input, key } = await fixture();
    await runGuardedMigrations(input);
    await runGuardedMigrations({
      ...input,
      runningVersion: "0.2.0",
      runningCommit: "a".repeat(40),
      remote: () => {
        throw new Error("remote provider unavailable");
      },
    });
    const receipts = await new FullBackupReceipts(input.backupRoot, () => key).list();
    expect(receipts[0]).toMatchObject({ sourceVersion: "0.1.0", remote: "failed" });
    const handle = createDatabase(input.connectionString);
    try {
      expect(await findInstallation(handle.db)).toMatchObject({
        applicationVersion: "0.2.0",
        previousApplicationVersion: "0.1.0",
        applicationCommit: "a".repeat(40),
        previousFullBackupId: receipts[0]?.backupId,
      });
    } finally {
      await handle.close();
    }
  });
});

it.each(["missing", "corrupted"] as const)(
  "refuses new SQL while the original archive is %s, then resumes after its exact repair",
  async (archiveFailure) => {
    const harness = await createAuthenticatedPageOperationHarness();
    const directory = await mkdtemp(join(tmpdir(), "mon-guarded-storage-resume-"));
    directories.push(directory);
    const cutover = FileStorageMigration.prototype.cutover;
    try {
      await harness.reset();
      await harness.createLegacyPage("Historical metadata to preserve");
      const { db, protectedFiles: files } = harness.api.built.context;
      if (files === undefined) throw new Error("Missing protected runtime");
      const bytes = Buffer.from("legacy bytes survive guarded upgrade interruption");
      const raw = await files.deps.blobs.put(bytes);
      const contentId = generateUuidV7();
      await db.insert(schema.fileContents).values({ id: contentId, ...raw, referenceCount: 1 });
      const key = Buffer.from(await readFile(harness.deploymentKeyFile, "utf8"), "base64");
      const migrationsDir = join(directory, "migrations");
      await cp(workspaceMigrationsDir, migrationsDir, { recursive: true });
      const input = {
        connectionString: harness.api.postgres.connectionString,
        migrationsDir,
        runningVersion: "0.2.0",
        installationId: files.deps.installationId,
        blobRoot: harness.api.blobRoot,
        backupRoot: directory,
        deploymentKey: () => key,
      };
      const interruption = vi
        .spyOn(FileStorageMigration.prototype, "cutover")
        .mockImplementationOnce(async function (this: FileStorageMigration, id) {
          await cutover.call(this, id);
          throw new Error("process interrupted after cutover");
        });
      await expect(runGuardedMigrations(input)).rejects.toThrow("process interrupted");
      interruption.mockRestore();
      expect((await findInstallation(db))?.applicationVersion).not.toBe("0.2.0");
      const transition = await readStorageTransition(db, input.installationId);
      expect(transition?.phase).toBe("cutover");
      const receipts = new FullBackupReceipts(directory, () => key);
      expect(await receipts.list()).toHaveLength(1);
      const archivePath = join(directory, `${transition?.sourceBackupId}.monfull`);
      const archiveBytes = await readFile(archivePath);
      const snapshot = async () => ({
        installation: await findInstallation(db),
        transition: await readStorageTransition(db, input.installationId),
        items: await db.select().from(schema.items),
        contents: await db.select().from(schema.fileContents),
        inventory: await migrationInventory(input.connectionString, { migrationsDir }),
      });
      await writeFile(
        join(migrationsDir, "9999_resume_protection_probe.sql"),
        "BEGIN; CREATE TABLE resume_protection_probe (id integer PRIMARY KEY); INSERT INTO resume_protection_probe VALUES (1); INSERT INTO schema_migrations (version) VALUES ('9999_resume_protection_probe'); COMMIT;",
      );
      const beforeRefusal = await snapshot();
      if (archiveFailure === "missing") await rm(archivePath);
      else await writeFile(archivePath, Buffer.alloc(archiveBytes.length));
      await expect(runGuardedMigrations(input)).rejects.toThrow(
        "original verified pre-update archive is unavailable",
      );
      expect(
        (
          await harness.api.built.database.pool.query(
            "SELECT to_regclass('public.resume_protection_probe') AS relation",
          )
        ).rows[0].relation,
      ).toBeNull();
      expect(await snapshot()).toEqual(beforeRefusal);
      expect((await findInstallation(db))?.applicationVersion).not.toBe("0.2.0");
      expect(await files.deps.blobs.get(raw.storageKey)).toEqual(new Uint8Array(bytes));
      expect(await receipts.list()).toHaveLength(1);
      await writeFile(archivePath, archiveBytes);
      expect(await runGuardedMigrations(input)).toEqual(["9999_resume_protection_probe"]);
      expect(
        (await harness.api.built.database.pool.query("SELECT id FROM resume_protection_probe"))
          .rows,
      ).toEqual([{ id: 1 }]);
      expect(await findInstallation(db)).toMatchObject({
        applicationVersion: "0.2.0",
        previousFullBackupId: transition?.sourceBackupId,
      });
      expect((await readStorageTransition(db, input.installationId))?.phase).toBe("complete");
      expect(await receipts.list()).toHaveLength(1);
      expect(
        (
          await db.select().from(schema.fileContents).where(eq(schema.fileContents.id, contentId))
        )[0],
      ).toMatchObject({ storageFormat: "encrypted-chunks-v1", storageKey: null, sha256: null });
      await expect(
        readFile(join(harness.api.blobRoot, raw.storageKey.slice(0, 2), raw.storageKey)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const restored = [];
      for await (const chunk of files.read(db, contentId)) restored.push(Buffer.from(chunk));
      expect(Buffer.concat(restored)).toEqual(bytes);
    } finally {
      vi.restoreAllMocks();
      await harness.close();
    }
  },
);
