/** A failed pre-update verification leaves every pending migration untouched (T035). */

import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  backupsWithVerification,
  findInstallation,
  getOrCreateWorkspace,
  workspaceMigrationsDir,
} from "@myownnotion/database";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  BackupDestination,
  StoredBackup,
} from "../../../apps/api/src/backup/destinations/destination.ts";
import { FilesystemDestination } from "../../../apps/api/src/backup/destinations/filesystem.ts";
import { runGuardedMigrations } from "../../../apps/api/src/backup/guarded-migration.ts";

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

class CorruptingDestination implements BackupDestination {
  readonly name = "corrupting-test";
  #stored = new Map<string, Buffer>();

  async put(name: string, contents: Readable): Promise<void> {
    for await (const _chunk of contents) {
      // Consume the real stream, then persist different bytes to model damage
      // between the sender and the provider's durable object.
    }
    this.#stored.set(name, Buffer.from("corrupted in transit"));
  }

  async list(): Promise<StoredBackup[]> {
    return [...this.#stored].map(([name, bytes]) => ({
      name,
      byteLength: bytes.byteLength,
      storedAt: new Date(),
    }));
  }

  async read(name: string): Promise<Readable | null> {
    const bytes = this.#stored.get(name);
    return bytes === undefined ? null : Readable.from(bytes);
  }

  async delete(name: string): Promise<void> {
    this.#stored.delete(name);
  }
}

let postgres: Awaited<ReturnType<typeof startDisposablePostgres>>;
let temporaryRoot: string;
let migrationsDir: string;
let backupRoot: string;
let blobRoot: string;

beforeAll(async () => {
  postgres = await startDisposablePostgres();
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mon-update-guard-"));
  migrationsDir = path.join(temporaryRoot, "migrations");
  backupRoot = path.join(temporaryRoot, "backups");
  blobRoot = path.join(temporaryRoot, "blobs");
  await cp(workspaceMigrationsDir, migrationsDir, { recursive: true });
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("the pre-migration update guard", () => {
  it("does not run a pending migration until a pre-update backup verifies", async () => {
    const key = randomBytes(32);
    await runGuardedMigrations({
      connectionString: postgres.connectionString,
      migrationsDir,
      runningVersion: "0.1.0",
      installationId: INSTALLATION_ID,
      blobRoot,
      destination: new FilesystemDestination(backupRoot),
      deploymentKey: () => key,
    });

    await writeFile(
      path.join(migrationsDir, "0007_guard_test.sql"),
      `BEGIN;
       CREATE TABLE update_guard_marker (id integer PRIMARY KEY);
       INSERT INTO schema_migrations (version) VALUES ('0007_guard_test');
       COMMIT;`,
      "utf8",
    );

    await expect(
      runGuardedMigrations({
        connectionString: postgres.connectionString,
        migrationsDir,
        runningVersion: "0.2.0",
        installationId: INSTALLATION_ID,
        blobRoot,
        destination: new CorruptingDestination(),
        deploymentKey: () => key,
      }),
    ).rejects.toThrow(/verified backup/i);

    const client = new pg.Client({ connectionString: postgres.connectionString });
    await client.connect();
    try {
      expect(
        (await client.query("SELECT to_regclass('public.update_guard_marker') AS marker")).rows[0]
          ?.marker,
      ).toBeNull();
      expect(
        (
          await client.query(
            "SELECT version FROM schema_migrations WHERE version = '0007_guard_test'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await client.end();
    }

    await runGuardedMigrations({
      connectionString: postgres.connectionString,
      migrationsDir,
      runningVersion: "0.2.0",
      installationId: INSTALLATION_ID,
      blobRoot,
      destination: new FilesystemDestination(backupRoot),
      deploymentKey: () => key,
    });

    const database = (await import("@myownnotion/database")).createDatabase(
      postgres.connectionString,
    );
    try {
      const installation = await findInstallation(database.db);
      expect(installation).toMatchObject({
        applicationVersion: "0.2.0",
        previousApplicationVersion: "0.1.0",
      });
      expect(installation?.previousBackupId).toMatch(/^[0-9a-f-]{36}$/);
      const workspace = await getOrCreateWorkspace(database.db);
      expect(await backupsWithVerification(database.db, workspace.id)).toContainEqual(
        expect.objectContaining({
          id: installation?.previousBackupId,
          applicationVersion: "0.1.0",
          supersededByVersion: "0.2.0",
          reason: "pre-update",
          verifiedAtDestination: true,
        }),
      );
    } finally {
      await database.close();
    }
  });
});
