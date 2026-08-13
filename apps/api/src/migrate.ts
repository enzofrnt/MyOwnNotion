/**
 * Migration entrypoint for the API image.
 *
 * Bundled alongside `server.mjs` and run by the Compose `migrate` service
 * before the API starts. Without it the image carried the reviewed SQL files
 * with no way to apply them, so a fresh deployment brought up an API against
 * an empty database and crashed on the first query.
 *
 * It is a separate entrypoint rather than a step inside server startup on
 * purpose: schema changes must be a distinct, observable operation that either
 * succeeds or stops the rollout, not a side effect of a process that also
 * starts serving traffic — and several API replicas racing to migrate the same
 * database is exactly what a one-shot job avoids.
 */
import path from "node:path";
import process from "node:process";
import { migrate } from "@myownnotion/database";

/**
 * Where the reviewed SQL lives inside the image.
 *
 * The API Dockerfile copies `packages/database/migrations` to `/app/migrations`,
 * next to `dist/`. The workspace layout the package resolves by default does
 * not survive bundling, so the path is derived from this module's own location.
 */
const migrationsDir =
  process.env["MYOWNNOTION_MIGRATIONS_DIR"]?.trim() ||
  path.resolve(import.meta.dirname, "..", "migrations");

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

try {
  const applied = await migrate(connectionString, { migrationsDir });
  if (applied.length === 0) {
    console.info("Database is already up to date.");
  } else {
    console.info(`Applied migrations: ${applied.join(", ")}`);
  }
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
