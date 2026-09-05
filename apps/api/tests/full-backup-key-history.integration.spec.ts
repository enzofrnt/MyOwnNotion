import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, schema } from "@myownnotion/database";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import { expect, it } from "vitest";
import { parseCommand } from "../src/admin/command-parser.ts";
import { rotationWrappingKeyCommand } from "../src/admin/commands/rotation-wrapping-key.ts";
import { runFullBackupCommand } from "../src/admin/full-backup-commands.ts";
import { buildApp } from "../src/app.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import {
  assertFullRestoreActivated,
  readFullRestoreState,
} from "../src/backup/full/restore-state.ts";
import { FullBackupService } from "../src/backup/full/service.ts";
import { buildManifest } from "../src/routes/export.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { createAuthenticatedPageOperationHarness } from "./helpers/authenticated-page-operations.ts";

it("keeps A recovery operational after real A→B wrapping rotation while writing only B", async () => {
  const harness = await createAuthenticatedPageOperationHarness();
  const directory = await mkdtemp(join(tmpdir(), "mon-backup-key-history-"));
  const installationId = "018f2b7c-0000-7000-8000-000000000001";
  const keyA = Buffer.from(await readFile(harness.deploymentKeyFile, "utf8"), "base64");
  const keyB = randomBytes(32);
  try {
    await harness.reset();
    await harness.createLegacyPage("Synthetic historical recovery page");
    const { db, workspaceId } = harness.api.built.context;
    const keys = (database: typeof db, key: Buffer) =>
      new KeyHierarchy({
        db: database,
        installationId,
        workspaceId,
        deploymentKey: () => key,
        now: () => new Date(),
      });
    const originalDataKey = await keys(db, keyA).dataKey(db, { writable: true });
    await db
      .insert(schema.rotationPolicies)
      .values({
        id: randomUUID(),
        installationId,
        kind: "wrapping-key",
        mode: "scheduled",
        dueIntervalDays: 365,
        dueAt: new Date(),
        writeBlockAt: new Date(Date.now() + 86_400_000),
        currentGeneration: 1,
        state: "due",
      })
      .onConflictDoNothing();
    const keyBFile = join(directory, "key-B");
    await writeFile(keyBFile, keyB.toString("base64"), { mode: 0o600 });
    const backupRoot = join(directory, "backups", "full");
    const remote = new FilesystemDestination(join(directory, "remote"));
    let remoteAvailable = false;
    let now = new Date("2026-01-01T04:00:00.000Z");
    const options = {
      connectionString: harness.api.postgres.connectionString,
      blobRoot: harness.api.blobRoot,
      backupRoot,
      now: () => now,
      remote: () => {
        if (!remoteAvailable) throw new Error("synthetic remote outage");
        return remote;
      },
    };
    const serviceA = new FullBackupService({ ...options, key: () => keyA });
    const first = await serviceA.run("manual");
    now = new Date("2026-01-02T04:00:00.000Z");
    const second = await serviceA.run("manual");
    const originalBytes = await readFile(first.path);
    const originalSecondBytes = await readFile(second.path);
    expect(first.receipt.remote).toBe("failed");
    const rotated = await rotationWrappingKeyCommand(
      parseCommand(["security", "rotation", "wrapping-key", "--new-key-file", keyBFile, "--yes"]),
      { db, installationId, deploymentKeyFile: harness.deploymentKeyFile, now: () => new Date() },
      { execute: true },
    );
    expect(rotated.code).toBe(0);
    expect(rotated.message).toContain("Retain the old key");
    expect(rotated.message).not.toContain("destroy the old key");
    expect((await keys(db, keyB).dataKey(db, { writable: false })).material).toEqual(
      originalDataKey.material,
    );
    await expect(keys(db, keyA).dataKey(db, { writable: false })).rejects.toThrow();

    now = new Date("2026-05-01T04:00:00.000Z");
    const serviceB = new FullBackupService({
      ...options,
      key: () => keyB,
      historicalKeyFiles: [harness.deploymentKeyFile],
    });
    expect((await serviceB.receipts.scan()).invalidCount).toBe(0);
    expect((await serviceB.verifiedReceipts()).map((row) => row.backupId)).toEqual([
      second.receipt.backupId,
      first.receipt.backupId,
    ]);
    expect((await serviceB.activities.read("backup"))?.backupId).toBe(second.receipt.backupId);
    // A remote outage remains conservative even when the retained receipts use A.
    expect(await serviceB.prune(90)).toBe(0);
    await expect(VerifiedFullArchive.open(first.path, keyB, directory)).rejects.toThrow();
    const env = {
      DATABASE_URL: harness.api.postgres.connectionString,
      MYOWNNOTION_BLOB_ROOT: harness.api.blobRoot,
      MYOWNNOTION_BACKUP_ROOT: join(directory, "backups"),
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyBFile,
      MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES: JSON.stringify([harness.deploymentKeyFile]),
    };
    for (const verb of ["inspect", "verify"]) {
      expect(
        (
          await runFullBackupCommand(
            parseCommand(["backup", "full", verb, "--file", first.path]),
            env,
          )
        ).code,
      ).toBe(0);
    }
    expect(
      (await runFullBackupCommand(parseCommand(["backup", "full", "list"]), env)).data,
    ).toMatchObject({ invalidReceipts: 0 });
    expect(await serviceB.rehearseArchive(first.path)).toMatchObject({
      backupId: first.receipt.backupId,
      databaseRestored: true,
    });

    // Actual restore never silently uses a configured historical key. Supply A explicitly.
    const target = await startDisposablePostgres();
    try {
      const targetDirectory = join(directory, "restored-A");
      const targetEnv = { ...env, MYOWNNOTION_RESTORE_DATABASE_URL: target.connectionString };
      const apply = parseCommand([
        "restore",
        "full",
        "apply",
        "--file",
        first.path,
        "--target-directory",
        targetDirectory,
        "--yes",
      ]);
      expect((await runFullBackupCommand(apply, targetEnv)).code).not.toBe(0);
      await expect(readFile(join(targetDirectory, ".full-restore-state"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const explicitA = {
        ...targetEnv,
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: harness.deploymentKeyFile,
      };
      expect((await runFullBackupCommand(apply, explicitA)).code).toBe(0);
      expect(
        (
          await runFullBackupCommand(
            parseCommand([
              "restore",
              "full",
              "activate",
              "--target-directory",
              targetDirectory,
              "--yes",
            ]),
            explicitA,
          )
        ).code,
      ).toBe(0);
      const restored = createDatabase(target.connectionString);
      try {
        expect(
          (await keys(restored.db, keyA).dataKey(restored.db, { writable: false })).material,
        ).toEqual(originalDataKey.material);
        await expect(
          keys(restored.db, keyB).dataKey(restored.db, { writable: false }),
        ).rejects.toThrow();
      } finally {
        await restored.close();
      }
    } finally {
      await target.stop();
    }

    // Reproduce the cutover window: outer archive A, already rewrapped SQL B.
    const mixed = await new FullBackupService({
      ...options,
      key: () => keyA,
      backupRoot: join(directory, "mixed-backups"),
    }).run("manual");
    const mixedTarget = await startDisposablePostgres();
    try {
      const targetDirectory = join(directory, "restored-mixed");
      const explicitA = {
        ...env,
        MYOWNNOTION_RESTORE_DATABASE_URL: mixedTarget.connectionString,
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: harness.deploymentKeyFile,
      };
      expect(
        (
          await runFullBackupCommand(
            parseCommand([
              "restore",
              "full",
              "apply",
              "--file",
              mixed.path,
              "--target-directory",
              targetDirectory,
              "--yes",
            ]),
            explicitA,
          )
        ).code,
      ).toBe(0);
      expect((await readFullRestoreState(targetDirectory, keyA)).stage).toBe("data-restored");
      await expect(readFullRestoreState(targetDirectory, keyB)).rejects.toThrow();
      expect(
        (
          await runFullBackupCommand(
            parseCommand([
              "restore",
              "full",
              "activate",
              "--target-directory",
              targetDirectory,
              "--yes",
            ]),
            explicitA,
          )
        ).code,
      ).toBe(0);
      await expect(assertFullRestoreActivated(targetDirectory)).resolves.toBeUndefined();
      await expect(readFile(join(targetDirectory, ".full-restore-state"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const restoredApp = await buildApp({
        databaseUrl: mixedTarget.connectionString,
        blobRoot: targetDirectory,
        fullBackupRoot: join(directory, "restored-mixed-backups"),
        security: loadSecurityConfig({
          MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
          MYOWNNOTION_API_HOST: "127.0.0.1",
          MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
          MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyBFile,
        }),
      });
      try {
        expect(
          (
            await keys(restoredApp.context.db, keyB).dataKey(restoredApp.context.db, {
              writable: false,
            })
          ).material,
        ).toEqual(originalDataKey.material);
        await expect(
          keys(restoredApp.context.db, keyA).dataKey(restoredApp.context.db, { writable: false }),
        ).rejects.toThrow();
        expect(JSON.stringify(await buildManifest(restoredApp.context))).toContain(
          "Synthetic historical recovery page",
        );
        expect((await restoredApp.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(
          200,
        );
      } finally {
        await restoredApp.close();
      }
    } finally {
      await mixedTarget.stop();
    }

    remoteAvailable = true;
    expect((await serviceB.retryRemote())?.backupId).toBe(second.receipt.backupId);
    expect(await readFile(second.path)).toEqual(originalSecondBytes);
    expect(await readFile(join(directory, "remote", `${second.receipt.backupId}.monfull`))).toEqual(
      originalSecondBytes,
    );
    // The retried receipt is newly written with B; the other receipt remains A.
    expect(
      await new FullBackupService({ ...options, key: () => keyB }).receipts.scan(),
    ).toMatchObject({ invalidCount: 1 });
    const scheduled = await serviceB.runScheduled(4, "UTC");
    expect(scheduled).not.toBeNull();
    if (scheduled === null) throw new Error("Expected a scheduled B archive");
    expect(await serviceB.runScheduled(4, "UTC")).toBeNull();
    const archiveB = await VerifiedFullArchive.open(
      join(backupRoot, `${scheduled.backupId}.monfull`),
      keyB,
      directory,
    );
    await archiveB.close();
    await expect(
      VerifiedFullArchive.open(join(backupRoot, `${scheduled.backupId}.monfull`), keyA, directory),
    ).rejects.toThrow();
    expect(
      (await new FullBackupService({ ...options, key: () => keyB }).activities.read("backup"))
        ?.backupId,
    ).toBe(scheduled.backupId);
    expect(await readFile(first.path)).toEqual(originalBytes);
    expect(await serviceB.prune(90)).toBe(2);
    await expect(readFile(first.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(second.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(directory, "remote", `${second.receipt.backupId}.monfull`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await serviceB.verifiedReceipts()).map((row) => row.backupId)).toEqual([
      scheduled.backupId,
    ]);
    now = new Date("2027-05-01T04:00:00.000Z");
    expect(await serviceB.prune(90)).toBe(0);
  } finally {
    keyA.fill(0);
    keyB.fill(0);
    await harness.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
