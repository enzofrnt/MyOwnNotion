/**
 * Returns a disposable installation to the empty, pre-bootstrap state (T003,
 * feature 002).
 *
 * Security journeys must start from an installation that reports
 * `ownerCount=0` / `workspaceCount=0`, because the bootstrap assertions are
 * about the `0/0` → `1/1` transition itself. This truncates only the security
 * tables; canonical content reset stays in `reset-content.ts` so a security
 * journey cannot accidentally take feature-001 rows with it.
 *
 * Tables are truncated only when they exist, so this is safe to call before
 * the security migration (T019) has landed.
 */
import pg from "pg";

/** Truncated in dependency order; `CASCADE` covers the rest. */
const SECURITY_TABLES = [
  "security_audit_events",
  "security_rate_limits",
  "security_migration_checkpoints",
  "security_record_envelopes",
  "security_key_policies",
  "security_key_generations",
  "security_key_epochs",
  "security_recovery_artifacts",
  "security_devices",
  "security_sessions",
  "security_bootstrap_attempts",
  "security_pending_credentials",
  "owner_credentials",
  "owners",
  "installations",
] as const;

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

export async function resetSecurityInstallation(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...SECURITY_TABLES]],
    );
    if (rows.length === 0) {
      return;
    }
    const present = rows.map((row) => `"${row.table_name}"`).join(", ");
    await client.query(`TRUNCATE ${present} CASCADE`);
  } finally {
    await client.end();
  }
}

/** Reads the committed counts the bootstrap journeys assert against. */
export async function readCommittedCounts(): Promise<{
  ownerCount: number;
  workspaceCount: number;
}> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ owner_count: string; workspace_count: string }>(
      `SELECT
         COALESCE((SELECT count(*) FROM owners), 0)::text AS owner_count,
         COALESCE((SELECT count(*) FROM workspaces), 0)::text AS workspace_count`,
    );
    const row = rows[0];
    return {
      ownerCount: Number(row?.owner_count ?? 0),
      workspaceCount: Number(row?.workspace_count ?? 0),
    };
  } catch {
    // Before the security migration the `owners` relation does not exist; an
    // installation with no owner table has no owner.
    return { ownerCount: 0, workspaceCount: 0 };
  } finally {
    await client.end();
  }
}
