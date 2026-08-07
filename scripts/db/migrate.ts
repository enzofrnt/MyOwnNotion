/**
 * Explicit migration runner.
 *
 * Applies reviewed SQL files from packages/database/migrations in
 * lexicographic order, recording each version in schema_migrations.
 * Never uses schema push; destructive changes require a new reviewed file.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const migrationsDir = path.resolve(import.meta.dirname, "../../packages/database/migrations");

export async function migrate(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const { rowCount } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version],
      );
      if ((rowCount ?? 0) > 0) {
        continue;
      }
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      // Each migration file manages its own BEGIN/COMMIT so a failure leaves
      // the database at the previous complete version.
      await client.query(sql);
      applied.push(version);
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1]);
if (isDirectRun) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  migrate(connectionString)
    .then((applied) => {
      if (applied.length === 0) {
        console.info("Database is already up to date.");
      } else {
        console.info(`Applied migrations: ${applied.join(", ")}`);
      }
    })
    .catch((error: unknown) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
