/** Read source provenance through catalogues, without applying any migration. */
import type { FullBackupSource } from "@myownnotion/domain";
import type pg from "pg";

export interface FullSourceInspection {
  readonly source: FullBackupSource;
  readonly nonempty: boolean;
  readonly databaseName: string;
  readonly databaseOid: number;
}

export async function inspectFullSource(
  client: pg.Client | pg.PoolClient,
): Promise<FullSourceInspection> {
  const server = await client.query<{
    version: number;
    name: string;
    oid: number;
    nonempty: boolean;
  }>(`
    SELECT current_setting('server_version_num')::integer AS version,
      current_database() AS name,
      (SELECT oid FROM pg_database WHERE datname = current_database()) AS oid,
      EXISTS (
        SELECT 1 FROM pg_namespace n
        WHERE n.nspname NOT IN ('public', 'information_schema')
          AND n.nspname NOT LIKE 'pg_%'
        UNION ALL
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        UNION ALL
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        UNION ALL
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        UNION ALL
        SELECT 1 FROM pg_largeobject_metadata
      ) AS nonempty
  `);
  const identity = server.rows[0];
  if (identity === undefined || identity.version < 180000 || identity.version >= 190000) {
    throw new Error("Complete server backups require PostgreSQL 18.");
  }
  const relations = await client.query<{ name: string; column: string }>(`
    SELECT c.relname AS name, a.attname AS column
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname IN ('schema_migrations', 'installations')
      AND a.attnum > 0 AND NOT a.attisdropped
  `);
  const has = (table: string, column: string) =>
    relations.rows.some((row) => row.name === table && row.column === column);
  const appliedMigrations = has("schema_migrations", "version")
    ? (
        await client.query<{ version: string }>(
          "SELECT version FROM public.schema_migrations ORDER BY version",
        )
      ).rows.map((row) => row.version)
    : [];
  let installationId: string | null = null;
  let applicationVersion: string | null = null;
  let commit: string | null = null;
  let image: string | null = null;
  if (has("installations", "id")) {
    const versionColumn = has("installations", "application_version")
      ? "application_version"
      : "NULL::text";
    const commitColumn = has("installations", "application_commit")
      ? "application_commit"
      : "NULL::text";
    const imageColumn = has("installations", "application_image")
      ? "application_image"
      : "NULL::text";
    const installations = await client.query<{
      id: string;
      application_version: string | null;
      application_commit: string | null;
      application_image: string | null;
    }>(
      `SELECT id, ${versionColumn} AS application_version, ${commitColumn} AS application_commit, ${imageColumn} AS application_image FROM public.installations LIMIT 2`,
    );
    if (installations.rows.length > 1)
      throw new Error("The source installation identity is ambiguous.");
    installationId = installations.rows[0]?.id ?? null;
    applicationVersion = installations.rows[0]?.application_version ?? null;
    commit =
      installations.rows[0]?.application_commit ??
      (/^sha-[0-9a-f]{40}$/.test(applicationVersion ?? "")
        ? (applicationVersion?.slice(4) ?? null)
        : null);
    image = installations.rows[0]?.application_image ?? null;
  }
  return {
    source: {
      installationId,
      applicationVersion,
      commit,
      image,
      postgresVersion: identity.version,
      appliedMigrations,
    },
    nonempty: identity.nonempty,
    databaseName: identity.name,
    databaseOid: identity.oid,
  };
}
