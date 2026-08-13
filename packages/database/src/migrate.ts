/**
 * Reviewed-SQL migration runner.
 *
 * Applies the files in `packages/database/migrations` in lexicographic order,
 * recording each version in `schema_migrations`. Never uses schema push;
 * a destructive change requires a new reviewed file.
 *
 * It lives in this package rather than in `scripts/db` because the SQL files
 * live here, and because two callers need the same logic from different
 * places: the repository script (`pnpm db:migrate`), which reads the files
 * from the workspace, and the API image's migration entrypoint, which reads
 * the copy baked into the image. A migration runner that existed only as a
 * repository script left the published image with the SQL files on board and
 * nothing able to apply them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/** The migrations shipped with this package, as laid out in the workspace. */
export const workspaceMigrationsDir = path.resolve(import.meta.dirname, "..", "migrations");

export interface MigrateOptions {
  /** Defaults to this package's own `migrations` directory. */
  readonly migrationsDir?: string;
}

/** Applies every pending migration, returning the versions it applied. */
export async function migrate(
  connectionString: string,
  options: MigrateOptions = {},
): Promise<string[]> {
  const migrationsDir = options.migrationsDir ?? workspaceMigrationsDir;
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
