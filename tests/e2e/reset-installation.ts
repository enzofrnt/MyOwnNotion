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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Every table migration `0004` owns, `installations` excepted.
 *
 * These are the real names, checked against the schema at run time. The first
 * version of this list was written before the migration landed and guessed a
 * `security_` prefix for most of them; because the query only truncated tables
 * that existed, the mismatch silently reset almost nothing and no test
 * noticed. `assertTablesExist` below is what makes a future drift loud.
 */
const SECURITY_TABLES = [
  "security_audit_events",
  "security_rate_limits",
  "migration_checkpoints",
  "encryption_migrations",
  "protected_blob_chunks",
  "protected_envelopes",
  "rotation_checkpoints",
  "rotation_operations",
  "rotation_policies",
  // The key hierarchy is per-installation state, not startup infrastructure,
  // and it is truncated with everything else. Bootstrap recreates it in its
  // promotion; a workspace whose ownership arrives another way gets one on its
  // first protected write. Keeping it here instead — which an earlier attempt
  // tried — left a previous test's generation 1 in place, and the next
  // bootstrap promotion then violated the unique index and could not confirm.
  "wrapping_key_versions",
  "workspace_root_keys",
  "data_key_generations",
  "recovery_kits",
  "recovery_epochs",
  "authorized_devices",
  "sessions",
  "bootstrap_attempts",
  "pending_bootstrap_credentials",
  "password_credential_versions",
  "passkey_credentials",
  "lifecycle_events",
  "owners",
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
      [[...SECURITY_TABLES, "installations"]],
    );
    const present = new Set(rows.map((row) => row.table_name));
    const missing = [...SECURITY_TABLES, "installations"].filter((table) => !present.has(table));
    if (missing.length > 0) {
      // Loud, not skipped. A reset that quietly does nothing leaves journeys
      // running against another journey's leftovers, which is how a suite goes
      // green while asserting nothing.
      throw new Error(
        `security reset cannot run: these tables are missing from the database: ${missing.join(", ")}`,
      );
    }
    await client.query("BEGIN");
    // Released before the child rows go, so no foreign key blocks the truncate.
    await client.query(
      `UPDATE installations SET state = 'uninitialized', owner_id = NULL, workspace_id = NULL`,
    );
    // `installations` is deliberately kept. The API creates that row once at
    // startup, the way a real deployment does, and nothing recreates it — so
    // truncating it would leave every later journey claiming a bootstrap
    // attempt against an installation that does not exist. Resetting the row
    // to `uninitialized` is what a fresh install actually looks like.
    //
    // The key hierarchy is *not* kept, unlike the installation row: see the
    // note beside those tables in the list above.
    await client.query(
      `TRUNCATE ${SECURITY_TABLES.map((table) => `"${table}"`).join(", ")} CASCADE`,
    );
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

/**
 * Reads the committed counts the bootstrap journeys assert against.
 *
 * `workspaceCount` counts workspaces the installation is *bound* to, by
 * joining through `installations.workspace_id`, exactly as the server's
 * `readCounts` does. Counting raw `workspaces` rows would always report 1,
 * because feature 001 creates the canonical workspace at API startup — the
 * journeys would then assert `0/0` against a number that can never be 0 and
 * the assertion would be theatre.
 */
export async function readCommittedCounts(): Promise<{
  ownerCount: number;
  workspaceCount: number;
}> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ owner_count: string; workspace_count: string }>(
      `SELECT
         (SELECT count(*) FROM owners)::text AS owner_count,
         (SELECT count(*) FROM workspaces w
            JOIN installations i ON i.workspace_id = w.id)::text AS workspace_count`,
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

/**
 * Commits ownership directly, without the passkey ceremony.
 *
 * Feature-001 journeys are about content, not about how ownership was
 * established, and the ceremony needs a virtual authenticator that only
 * Chromium exposes — seeding through the UI would restrict the whole browser
 * matrix to one engine. The bootstrap journeys reset back to `0/0` and drive
 * the real flow; everything else starts from an installation that already has
 * an owner, which is what an installation looks like in use.
 */
export async function seedCommittedOwner(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows: installations } = await client.query<{ id: string; owner_id: string | null }>(
      `SELECT id, owner_id FROM installations LIMIT 1`,
    );
    const installation = installations[0];
    if (installation === undefined || installation.owner_id !== null) {
      // No installation row yet (the API has not started), or ownership is
      // already committed. Either way there is nothing to seed.
      return;
    }
    const { rows: workspaces } = await client.query<{ id: string }>(
      `SELECT id FROM workspaces LIMIT 1`,
    );
    const workspaceId = workspaces[0]?.id;
    if (workspaceId === undefined) {
      return;
    }
    await client.query("BEGIN");
    // `owners.id` has no default: the application always supplies it.
    const ownerId = randomUUID();
    await client.query(
      `INSERT INTO owners (id, installation_id, state) VALUES ($1, $2, 'active')`,
      [ownerId, installation.id],
    );
    await client.query(
      `UPDATE installations SET state = 'ready', owner_id = $1, workspace_id = $2 WHERE id = $3`,
      [ownerId, workspaceId, installation.id],
    );
    // A device, because a session is bound to one and sign-in refuses without
    // an active one.
    await client.query(
      `INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
       VALUES ($1, $2, 'e2e-binding', 'End-to-end browser', 'active')`,
      [randomUUID(), ownerId],
    );
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

/**
 * Digests a session secret exactly as the server does.
 *
 * Duplicated here rather than imported because `apps/api` is not on the
 * end-to-end module path. It must stay in step with `digestSessionSecret` in
 * `apps/api/src/security/session-service.ts`; if it drifts, every seeded
 * session is simply unrecognised and the content journeys land on the sign-in
 * page, which is a loud failure rather than a silent one.
 */
function digestSessionSecret(secret: string): string {
  return createHash("sha256").update(`session|${secret}`).digest("base64url");
}

/**
 * Issues a session directly, and returns the secret the browser must present.
 *
 * Content journeys are about content, not about how the owner signed in. The
 * password ceremony is exercised properly by the authentication journeys;
 * repeating it before every hierarchy test would add a sign-in to each one and
 * make a failure there look like a failure here.
 */
export async function seedSession(): Promise<string | null> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows: owners } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = owners[0]?.id;
    if (ownerId === undefined) {
      return null;
    }
    const { rows: devices } = await client.query<{ id: string }>(
      `SELECT id FROM authorized_devices WHERE owner_id = $1 AND state = 'active' LIMIT 1`,
      [ownerId],
    );
    const deviceId = devices[0]?.id;
    if (deviceId === undefined) {
      return null;
    }
    const secret = randomBytes(32).toString("base64url");
    const now = new Date();
    await client.query(
      `INSERT INTO sessions
         (id, owner_id, device_id, session_secret_hash, auth_method,
          issued_at, last_seen_at, expires_at, recent_auth_at, state)
       VALUES ($1, $2, $3, $4, 'password', $5, $5, $6, $5, 'active')`,
      [
        randomUUID(),
        ownerId,
        deviceId,
        digestSessionSecret(secret),
        now,
        new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      ],
    );
    return secret;
  } finally {
    await client.end();
  }
}
