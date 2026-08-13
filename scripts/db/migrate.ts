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
import { migrate } from "@myownnotion/database";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

try {
  const applied = await migrate(connectionString);
  if (applied.length === 0) {
    console.info("Database is already up to date.");
  } else {
    console.info(`Applied migrations: ${applied.join(", ")}`);
  }
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
