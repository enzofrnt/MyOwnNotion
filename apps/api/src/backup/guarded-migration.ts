/** Inspect first, protect the complete source, migrate, verify, then record the build. */
import { join } from "node:path";
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  createInstallation,
  getOrCreateWorkspace,
  migrate,
  migrationInventory,
  readStorageTransition,
  recordFullApplicationUpdate,
  unfinishedRestoration,
} from "@myownnotion/database";
import { validateCanonicalExport } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import pg from "pg";
import type { AppContext } from "../context.ts";
import { createProtectedFileRuntime } from "../files/protected-file-runtime.ts";
import { PageOperationCrypto } from "../page-state/page-operation-crypto.ts";
import { buildManifest } from "../routes/export.ts";
import { FileStorageMigration } from "../security/file-storage-migration.ts";
import { inventoryLegacyFileSources } from "../security/file-storage-source.ts";
import type { BackupDestination } from "./destinations/destination.ts";
import { VerifiedFullArchive } from "./full/archive.ts";
import { acquireFullRunLock } from "./full/locks.ts";
import { fullArchiveName } from "./full/receipts.ts";
import { assertFullRestoreActivated } from "./full/restore-state.ts";
import { FullBackupService } from "./full/service.ts";
import { inspectFullSource } from "./full/source.ts";
import { PageOperationArchiveService } from "./page-operation-archive.ts";

export class UpdateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateRefusedError";
  }
}

export interface GuardedMigrationInput {
  readonly connectionString: string;
  readonly migrationsDir?: string;
  readonly runningVersion: string;
  readonly runningCommit?: string;
  readonly runningImage?: string;
  readonly installationId: string;
  readonly blobRoot: string;
  readonly backupRoot: string;
  readonly remote?: () => BackupDestination;
  readonly deploymentKey: () => Uint8Array;
  readonly historicalKeyFiles?: readonly string[];
  readonly logger?: {
    info(details: unknown, message: string): void;
    error(details: unknown, message: string): void;
  };
}

export async function runGuardedMigrations(input: GuardedMigrationInput): Promise<string[]> {
  await assertFullRestoreActivated(input.blobRoot);
  const migrationOptions =
    input.migrationsDir === undefined ? {} : { migrationsDir: input.migrationsDir };
  const coordinator = new pg.Client({
    connectionString: input.connectionString,
    connectionTimeoutMillis: 15_000,
  });
  let release: (() => Promise<void>) | undefined;
  try {
    await coordinator.connect();
    release = await acquireFullRunLock(coordinator);
    const before = await inspectFullSource(coordinator);
    const inventory = await migrationInventory(input.connectionString, migrationOptions);
    if (inventory.applied.some((version) => !inventory.available.includes(version))) {
      throw new UpdateRefusedError(
        "The source contains migrations unknown to this build. No migration has run.",
      );
    }
    const changingVersion = before.source.applicationVersion !== input.runningVersion;
    const hasTransitions =
      (
        await coordinator.query<{ present: boolean }>(
          "SELECT to_regclass('public.file_storage_transitions') IS NOT NULL AS present",
        )
      ).rows[0]?.present === true;
    const pendingTransition = hasTransitions
      ? (
          await coordinator.query<{ source_backup_id: string }>(
            "SELECT source_backup_id FROM file_storage_transitions WHERE phase <> 'complete' LIMIT 1",
          )
        ).rows[0]
      : undefined;
    let fullBackupId: string | null = pendingTransition?.source_backup_id ?? null;
    const installationId = before.source.installationId ?? input.installationId;
    const backup = new FullBackupService({
      connectionString: input.connectionString,
      blobRoot: input.blobRoot,
      backupRoot: input.backupRoot,
      key: input.deploymentKey,
      ...(input.historicalKeyFiles === undefined
        ? {}
        : { historicalKeyFiles: input.historicalKeyFiles }),
      ...(input.remote === undefined ? {} : { remote: input.remote }),
    });
    const verifySourceBackup = async (backupId: string) => {
      const receipt = (await backup.verifiedReceipts()).find(
        (entry) => entry.backupId === backupId,
      );
      if (receipt === undefined || receipt.reason !== "pre-update")
        throw new UpdateRefusedError(
          "The original verified pre-update archive is unavailable; storage migration cannot resume.",
        );
      const archive = await VerifiedFullArchive.open(
        join(input.backupRoot, fullArchiveName(backupId)),
        input.deploymentKey(),
        input.backupRoot,
      );
      try {
        if (
          archive.manifest.backupId !== backupId ||
          (archive.manifest.source.installationId !== null &&
            archive.manifest.source.installationId !== installationId)
        )
          throw new UpdateRefusedError("The source archive belongs to another installation.");
      } finally {
        await archive.close();
      }
    };
    // Resuming a storage transition can also introduce later SQL migrations.
    // Its original recovery archive must be valid before the first such write.
    if (pendingTransition !== undefined)
      await verifySourceBackup(pendingTransition.source_backup_id);
    if (
      pendingTransition === undefined &&
      before.nonempty &&
      (inventory.pending.length > 0 || changingVersion)
    ) {
      try {
        const result = await backup.run("pre-update", coordinator);
        fullBackupId = result.manifest.backupId;
      } catch (error) {
        input.logger?.error(
          { errorType: error instanceof Error ? error.name : "UnknownError" },
          "complete pre-update backup failed",
        );
        throw new UpdateRefusedError(
          "A verified complete backup could not be produced. No migration or schema bootstrap has run.",
        );
      }
    }

    // First schema mutation, including sources older than the guard's own tables.
    const applied = await migrate(input.connectionString, migrationOptions);
    const database = createDatabase(input.connectionString);
    try {
      const workspace = await getOrCreateWorkspace(database.db);
      await createInstallation(database.db, {
        id: installationId,
        sourceLineageId: installationId,
        schemaVersion: workspace.schemaVersion,
      });
      const protectedRuntime = createProtectedFileRuntime({
        blobRoot: input.blobRoot,
        db: database.db,
        installationId,
        workspaceId: workspace.id,
        deploymentKey: () => Buffer.from(input.deploymentKey()),
      });
      const transition = await readStorageTransition(database.db, installationId);
      const hasCanonicalData =
        (
          await database.db.execute<{ present: boolean }>(sql`SELECT
        EXISTS (SELECT 1 FROM items) OR EXISTS (SELECT 1 FROM relationships) OR
        EXISTS (SELECT 1 FROM uploads) OR EXISTS (SELECT 1 FROM file_contents) OR
        EXISTS (SELECT 1 FROM exports) AS present`)
        ).rows[0]?.present === true;
      // An empty, unowned installation must not mint a data-key generation before bootstrap.
      const needsTransition =
        transition !== null ||
        hasCanonicalData ||
        (await inventoryLegacyFileSources(database.db, input.blobRoot)).length > 0;
      if (needsTransition && transition?.phase !== "complete") {
        if (fullBackupId === null) {
          fullBackupId = (await backup.run("pre-update", coordinator)).manifest.backupId;
        }
        const migration = new FileStorageMigration({
          db: database.db,
          blobRoot: input.blobRoot,
          files: protectedRuntime.files,
          records: protectedRuntime.records,
          verifySourceBackup,
        });
        await migration.run(fullBackupId);
      }
      const context: AppContext = {
        db: database.db,
        workspaceId: workspace.id,
        schemaVersion: workspace.schemaVersion,
        contentStore: new ContentStore(new FilesystemBlobStore(input.blobRoot)),
        partialUploads: new PartialUploadStore(input.blobRoot),
        protectedContent: protectedRuntime.content,
        protectedFiles: protectedRuntime.files,
        pageOperationArchive: new PageOperationArchiveService({
          workspaceId: workspace.id,
          crypto: new PageOperationCrypto(protectedRuntime.records),
        }),
      };
      if ((await migrationInventory(input.connectionString, migrationOptions)).pending.length > 0) {
        throw new UpdateRefusedError("One or more reviewed migrations remain unapplied.");
      }
      if ((await unfinishedRestoration(database.db)) !== null) {
        throw new UpdateRefusedError(
          "An unfinished restoration exists; the installation cannot be reported healthy.",
        );
      }
      if (validateCanonicalExport(await buildManifest(context)).length > 0) {
        throw new UpdateRefusedError(
          "Post-migration canonical integrity failed; the target version is not recorded as successful.",
        );
      }
      await recordFullApplicationUpdate(database.db, {
        installationId,
        from: before.source.applicationVersion,
        to: input.runningVersion,
        fullBackupId,
        schemaVersion: workspace.schemaVersion,
        commit:
          input.runningCommit ?? /^sha-([0-9a-f]{40})$/.exec(input.runningVersion)?.[1] ?? null,
        image: input.runningImage ?? null,
      });
      input.logger?.info(
        { migrationCount: applied.length, fullBackupId },
        "guarded migrations completed",
      );
      return applied;
    } finally {
      await database.close();
    }
  } finally {
    try {
      await release?.();
    } finally {
      await coordinator.end();
    }
  }
}
