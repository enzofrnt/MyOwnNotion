/** The one migration path: bootstrap the guard, back up, migrate, then verify. */

import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  createInstallation,
  findInstallation,
  getOrCreateWorkspace,
  migrate,
  migrationInventory,
  recordApplicationUpdate,
  recordInitialApplicationVersion,
  unfinishedRestoration,
} from "@myownnotion/database";
import { type Uuid, validateCanonicalExport } from "@myownnotion/domain";
import { runBackupCommand } from "../admin/commands/backup-commands.ts";
import type { AppContext } from "../context.ts";
import { buildManifest } from "../routes/export.ts";
import { createProtectedContentRuntime } from "../security/protected-content-runtime.ts";
import { sealBackupArchiveFile } from "./archive-crypto.ts";
import { BackupService } from "./backup-service.ts";
import type { BackupDestination } from "./destinations/destination.ts";
import { decideUpdate } from "./update-guard.ts";

/** The migration that adds the columns the guard itself needs to read. */
export const UPDATE_GUARD_BOOTSTRAP_MIGRATION = "0006_installation_application_version";

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
  readonly installationId: string;
  readonly blobRoot: string;
  readonly destination: BackupDestination;
  readonly deploymentKey: () => Uint8Array;
  readonly logger?: {
    info(details: unknown, message: string): void;
    error(details: unknown, message: string): void;
  };
}

/**
 * Applies migrations only through the guard's own schema first.
 *
 * An installation older than feature 007 has no application-version column to
 * inspect and no backup tables to record into. That one bootstrap is therefore
 * necessarily unguarded. Every migration shipped after it goes through the
 * verified-backup path below.
 */
export async function runGuardedMigrations(input: GuardedMigrationInput): Promise<string[]> {
  const migrationOptions = {
    ...(input.migrationsDir === undefined ? {} : { migrationsDir: input.migrationsDir }),
  };
  const applied = await migrate(input.connectionString, {
    ...migrationOptions,
    throughVersion: UPDATE_GUARD_BOOTSTRAP_MIGRATION,
  });

  const database = createDatabase(input.connectionString);
  try {
    const workspace = await getOrCreateWorkspace(database.db);
    await createInstallation(database.db, {
      id: input.installationId,
      sourceLineageId: input.installationId,
      schemaVersion: workspace.schemaVersion,
    });
    const installation = await findInstallation(database.db);
    if (installation === null) {
      throw new UpdateRefusedError("the installation version could not be inspected");
    }

    const inventory = await migrationInventory(input.connectionString, migrationOptions);
    const remainingMigrations = inventory.pending;
    const contentStore = new ContentStore(new FilesystemBlobStore(input.blobRoot));
    const protectedRuntime = createProtectedContentRuntime({
      db: database.db,
      installationId: input.installationId,
      workspaceId: workspace.id,
      deploymentKey: () => Buffer.from(input.deploymentKey()),
    });
    const context: AppContext = {
      db: database.db,
      workspaceId: workspace.id,
      schemaVersion: workspace.schemaVersion,
      contentStore,
      partialUploads: new PartialUploadStore(input.blobRoot),
      protectedContent: protectedRuntime.content,
    };

    const backupForUpdate = async (
      applicationVersion: string,
      supersededByVersion?: string,
    ): Promise<Uuid | null> => {
      try {
        const service = new BackupService({
          context,
          destination: input.destination,
          applicationVersion,
          seal: async (plaintextPath, sealedPath) =>
            await sealBackupArchiveFile(input.deploymentKey(), plaintextPath, sealedPath),
        });
        const result = await runBackupCommand(
          {
            db: database.db,
            workspaceId: workspace.id,
            service,
            destination: input.destination,
          },
          "pre-update",
          supersededByVersion,
        );
        const backupId = result.data?.["backupId"];
        return result.code === 0 && typeof backupId === "string" ? (backupId as Uuid) : null;
      } catch (error) {
        input.logger?.error(
          { errorType: error instanceof Error ? error.name : "UnknownError" },
          "pre-update backup failed",
        );
        return null;
      }
    };

    let updateBackupId: Uuid | null = null;
    if (installation.applicationVersion === null) {
      // The first observed version is not a change. If a newer migration than
      // the guard is already waiting, however, it still gets a backup before it
      // runs — the absence of history does not waive the migration invariant.
      if (remainingMigrations.length > 0) {
        updateBackupId = await backupForUpdate(input.runningVersion);
        if (updateBackupId === null) {
          throw new UpdateRefusedError(
            "A verified backup could not be produced before the pending migration. No pending migration has run.",
          );
        }
      }
    } else if (installation.applicationVersion === input.runningVersion) {
      if (remainingMigrations.length > 0) {
        updateBackupId = await backupForUpdate(installation.applicationVersion);
        if (updateBackupId === null) {
          throw new UpdateRefusedError(
            "A verified backup could not be produced before the pending migration. No pending migration has run.",
          );
        }
      }
    } else {
      const decision = await decideUpdate({
        runningVersion: input.runningVersion,
        recordedVersion: installation.applicationVersion,
        backupForUpdate: async (from, to) => await backupForUpdate(from, to),
      });
      if (decision.kind === "refused") {
        throw new UpdateRefusedError(decision.reason);
      }
      if (decision.kind !== "proceed") {
        throw new UpdateRefusedError("the application version change was not resolved safely");
      }
      updateBackupId = decision.backupId;
    }

    const migrated = await migrate(input.connectionString, migrationOptions);
    applied.push(...migrated);

    // Integrity and health are checked before the new version is committed as
    // successful. The deployment's HTTP healthcheck is the second half once the
    // API starts; this verifies the database side while the migration job still
    // has authority to fail the rollout.
    const after = await migrationInventory(input.connectionString, migrationOptions);
    if (after.pending.length > 0) {
      throw new UpdateRefusedError("one or more reviewed migrations remain unapplied");
    }
    if ((await unfinishedRestoration(database.db)) !== null) {
      throw new UpdateRefusedError(
        "an unfinished restoration exists; the installation cannot be reported healthy",
      );
    }
    const exportIssues = validateCanonicalExport(await buildManifest(context));
    if (exportIssues.length > 0) {
      throw new UpdateRefusedError(
        "the post-migration canonical integrity check failed; the update is not marked successful",
      );
    }

    if (installation.applicationVersion === null) {
      await recordInitialApplicationVersion(database.db, {
        installationId: installation.id,
        applicationVersion: input.runningVersion,
      });
    } else if (installation.applicationVersion !== input.runningVersion) {
      if (updateBackupId === null) {
        throw new UpdateRefusedError("the verified pre-update backup record is missing");
      }
      await recordApplicationUpdate(database.db, {
        installationId: installation.id,
        from: installation.applicationVersion,
        to: input.runningVersion,
        backupId: updateBackupId,
        schemaVersion: workspace.schemaVersion,
      });
    }

    input.logger?.info(
      { migrationCount: applied.length },
      applied.length === 0 ? "database is already up to date" : "guarded migrations completed",
    );
    return applied;
  } finally {
    await database.close();
  }
}
