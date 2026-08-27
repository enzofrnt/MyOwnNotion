/**
 * Reviewed-SQL migration runner.
 *
 * Applies the files in `packages/database/migrations` in lexicographic order,
 * recording each version in `schema_migrations`. Never uses schema push;
 * a destructive change requires a new reviewed file.
 *
 * It lives in this package rather than in `scripts/db` because the SQL files
 * live here, and because two callers need the same logic from different
 * places: the repository script (`bun run db:migrate`), which reads the files
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
  /** Applies no file after this version. Used to bootstrap the update guard itself. */
  readonly throughVersion?: string;
}

export interface MigrationInventory {
  readonly applied: readonly string[];
  readonly available: readonly string[];
  readonly pending: readonly string[];
}

function migrationFiles(migrationsDir: string, throughVersion?: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => throughVersion === undefined || file.replace(/\.sql$/, "") <= throughVersion);
}

/** Lists reviewed and applied versions without changing the database. */
export async function migrationInventory(
  connectionString: string,
  options: MigrateOptions = {},
): Promise<MigrationInventory> {
  const migrationsDir = options.migrationsDir ?? workspaceMigrationsDir;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const available = migrationFiles(migrationsDir, options.throughVersion).map((file) =>
      file.replace(/\.sql$/, ""),
    );
    const table = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    const applied = table.rows[0]?.exists
      ? (
          await client.query<{ version: string }>(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
        ).rows.map((row) => row.version)
      : [];
    const known = new Set(applied);
    return { applied, available, pending: available.filter((version) => !known.has(version)) };
  } finally {
    await client.end();
  }
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
    const files = migrationFiles(migrationsDir, options.throughVersion);
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
