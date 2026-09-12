import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDatabase,
  findInstallation,
  migrate,
  migrationInventory,
  workspaceMigrationsDir,
} from "@myownnotion/database";
import { type DisposablePostgres, startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import { FullBackupReceipts } from "../src/backup/full/receipts.ts";
import { runGuardedMigrations } from "../src/backup/guarded-migration.ts";
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
