/**
 * Explicit migration runner (repository entry point).
 *
 * Applies reviewed SQL files from packages/database/migrations in
 * lexicographic order, recording each version in schema_migrations.
 * Never uses schema push; destructive changes require a new reviewed file.
 *
 * The logic itself lives in `@myownnotion/database` so the API image's
 * migration entrypoint applies exactly the same files the same way.
 */
import process from "node:process";
import { APPLICATION_VERSION } from "../../apps/api/src/application-version.ts";
import {
  createBackupDestination,
  loadBackupConfig,
} from "../../apps/api/src/backup/backup-config.ts";
import { runGuardedMigrations } from "../../apps/api/src/backup/guarded-migration.ts";
import { loadDeploymentKey } from "../../apps/api/src/security/deployment-key.ts";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

try {
  const applied = await runGuardedMigrations({
    connectionString,
    runningVersion: APPLICATION_VERSION,
    installationId: "018f2b7c-0000-7000-8000-000000000001",
    blobRoot: process.env["MYOWNNOTION_BLOB_ROOT"]?.trim() || "./.dev-blobs",
    destination: createBackupDestination(loadBackupConfig()),
    deploymentKey: () => loadDeploymentKey(process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).bytes,
  });
  if (applied.length === 0) {
    console.info("Database is already up to date.");
  } else {
    console.info(`Applied migrations: ${applied.join(", ")}`);
  }
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
