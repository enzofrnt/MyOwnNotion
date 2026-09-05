/** Inspect first, protect the complete source, migrate, verify, then record the build. */
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  createInstallation,
  getOrCreateWorkspace,
  migrate,
  migrationInventory,
  recordFullApplicationUpdate,
  unfinishedRestoration,
} from "@myownnotion/database";
import { validateCanonicalExport } from "@myownnotion/domain";
import pg from "pg";
import type { AppContext } from "../context.ts";
import { PageOperationCrypto } from "../page-state/page-operation-crypto.ts";
import { buildManifest } from "../routes/export.ts";
import { createProtectedContentRuntime } from "../security/protected-content-runtime.ts";
import type { BackupDestination } from "./destinations/destination.ts";
import { acquireFullRunLock } from "./full/locks.ts";
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
    let fullBackupId: string | null = null;
    if (before.nonempty && (inventory.pending.length > 0 || changingVersion)) {
      try {
        const backup = new FullBackupService({
          connectionString: input.connectionString,
          blobRoot: input.blobRoot,
          backupRoot: input.backupRoot,
          key: input.deploymentKey,
          ...(input.remote === undefined ? {} : { remote: input.remote }),
        });
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
      const installationId = before.source.installationId ?? input.installationId;
      await createInstallation(database.db, {
        id: installationId,
        sourceLineageId: installationId,
        schemaVersion: workspace.schemaVersion,
      });
      const protectedRuntime = createProtectedContentRuntime({
        db: database.db,
        installationId,
        workspaceId: workspace.id,
        deploymentKey: () => Buffer.from(input.deploymentKey()),
      });
      const context: AppContext = {
        db: database.db,
        workspaceId: workspace.id,
        schemaVersion: workspace.schemaVersion,
        contentStore: new ContentStore(new FilesystemBlobStore(input.blobRoot)),
        partialUploads: new PartialUploadStore(input.blobRoot),
        protectedContent: protectedRuntime.content,
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
