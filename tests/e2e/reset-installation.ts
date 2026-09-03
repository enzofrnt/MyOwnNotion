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
import {
  closeBoundedDatabaseClient,
  forceCloseDatabaseClient,
  withBoundedDatabaseClient,
} from "./bounded-database.ts";

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

const MAX_RESET_ATTEMPTS = 5;
const MAX_SETUP_ATTEMPTS = 3;
const SETUP_QUERY_TIMEOUT_MS = 5_000;
const SETUP_OPERATION_TIMEOUT_MS = 10_000;
const RETRYABLE_SETUP_CODES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "55P03", // lock_not_available
  "57014", // query_canceled by statement_timeout
  "57P01", // admin_shutdown / recovered abandoned backend
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

function boundedSetupClient(applicationName: string): pg.Client {
  return new pg.Client({
    connectionString: connectionString(),
    application_name: applicationName,
    connectionTimeoutMillis: SETUP_QUERY_TIMEOUT_MS,
    query_timeout: SETUP_QUERY_TIMEOUT_MS,
    // Apply the bound before the first SELECT. A SET LOCAL issued after BEGIN
    // cannot protect a query that is itself waiting to start the transaction.
    options: `-c statement_timeout=${SETUP_QUERY_TIMEOUT_MS} -c lock_timeout=2000`,
  });
}

/**
 * Bounds a complete setup attempt, not only each SQL statement.
 *
 * A transaction can otherwise consume several query timeouts in sequence and
 * then wait again while rolling back or closing. Ending an active pg client
 * destroys its socket, so every pending query rejects and the retry policy can
 * start from a fresh connection instead of exhausting Playwright's watchdog.
 */
function armSetupDeadline(client: pg.Client): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    forceCloseDatabaseClient(client);
  }, SETUP_OPERATION_TIMEOUT_MS);
}

async function closeSetupClient(
  client: pg.Client,
  deadline: ReturnType<typeof setTimeout>,
): Promise<void> {
  clearTimeout(deadline);
  await closeBoundedDatabaseClient(client);
}

function isRetryableSetupError(error: unknown): boolean {
  const code = postgresErrorCode(error);
  if (code !== null && RETRYABLE_SETUP_CODES.has(code)) return true;
  if (!(error instanceof Error)) return false;
  return /(?:query read timeout|connection terminated|timeout expired|client was closed)/iu.test(
    error.message,
  );
}

async function withSetupRetries<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SETUP_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableSetupError(error) || attempt === MAX_SETUP_ATTEMPTS) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw new Error("bounded E2E setup exhausted without returning or throwing");
}

async function resetSecurityInstallationOnce(): Promise<void> {
  const client = boundedSetupClient("myownnotion-e2e-security-reset");
  const deadline = armSetupDeadline(client);
  let transactionOpen = false;
  try {
    await client.connect();
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
    transactionOpen = true;
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
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await closeSetupClient(client, deadline);
  }
}

export async function resetSecurityInstallation(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RESET_ATTEMPTS; attempt += 1) {
    try {
      await resetSecurityInstallationOnce();
      return;
    } catch (error) {
      const retryable = isRetryableSetupError(error);
      if (!retryable || attempt === MAX_RESET_ATTEMPTS) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 50));
    }
  }
}

/**
 * Puts the installation past its data-key write-block deadline, or lifts it.
 *
 * Exported here rather than kept inside the rotation journeys because the
 * blocked *save state* is a content concern: the only honest way to see what an
 * owner sees when a write is refused is to have the server actually refuse one.
 *
 * Always paired with `setDataKeyWriteBlock(false)` in a fixture teardown. A
 * policy left behind blocks every write in every journey that runs afterwards,
 * and the failures land nowhere near the test that caused them.
 */
export async function setDataKeyWriteBlock(blocked: boolean): Promise<void> {
  await withBoundedDatabaseClient("myownnotion-e2e-data-key-write-block", async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM installations LIMIT 1`);
    const installationId = rows[0]?.id;
    if (installationId === undefined) {
      throw new Error("no installation row: the API has not started against this database");
    }
    if (!blocked) {
      await client.query(`DELETE FROM rotation_policies WHERE installation_id = $1`, [
        installationId,
      ]);
      return;
    }

    const day = 24 * 60 * 60 * 1000;
    await client.query(
      `INSERT INTO rotation_policies
         (id, installation_id, kind, mode, due_interval_days, due_at, write_block_at,
          current_generation, state)
       VALUES (gen_random_uuid(), $1, 'data-key', 'scheduled', 365, $2, $3, 1, 'write-block')
       ON CONFLICT (installation_id, kind) DO UPDATE
         SET due_at = EXCLUDED.due_at,
             write_block_at = EXCLUDED.write_block_at,
             state = EXCLUDED.state`,
      [installationId, new Date(Date.now() - 400 * day), new Date(Date.now() - day)],
    );
  });
}

/**
 * Removes every rotation policy from the installation.
 *
 * Any journey that seeds a policy owes the next one this call. A policy is
 * installation-wide and outlives the file that wrote it, so one left behind in
 * `write-block` state refuses every write in every journey that follows —
 * including the first journeys of the *next browser project*, which then fail
 * as "the row never appeared" with nothing pointing back here.
 */
export async function clearRotationPolicies(): Promise<void> {
  await withBoundedDatabaseClient("myownnotion-e2e-clear-rotation-policies", async (client) => {
    await client.query(`DELETE FROM rotation_policies`);
  });
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
  try {
    return await withBoundedDatabaseClient(
      "myownnotion-e2e-read-committed-counts",
      async (client) => {
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
      },
    );
  } catch {
    // Before the security migration the `owners` relation does not exist; an
    // installation with no owner table has no owner.
    return { ownerCount: 0, workspaceCount: 0 };
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
async function seedCommittedOwnerOnce(): Promise<void> {
  const client = boundedSetupClient("myownnotion-e2e-owner-seed");
  const deadline = armSetupDeadline(client);
  try {
    await client.connect();
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
    try {
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
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await closeSetupClient(client, deadline);
  }
}

export async function seedCommittedOwner(): Promise<void> {
  await withSetupRetries(seedCommittedOwnerOnce);
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
async function seedSessionOnce(): Promise<string | null> {
  const client = boundedSetupClient("myownnotion-e2e-session-seed");
  const deadline = armSetupDeadline(client);
  try {
    await client.connect();
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
    await closeSetupClient(client, deadline);
  }
}

export async function seedSession(): Promise<string | null> {
  return withSetupRetries(seedSessionOnce);
}

/**
 * Issues a session on a *new* device (feature 006).
 *
 * `seedSession` reuses the one seeded device, which is right for a journey about
 * content and wrong for every journey about several devices: two contexts sharing
 * one device row cannot be told apart, so revoking "the other device" would
 * revoke both. This inserts a device of its own and returns both identities, so a
 * test can revoke one and watch the other keep working.
 */
async function seedSessionOnNewDeviceOnce(
  name = "Second end-to-end device",
): Promise<{ secret: string; deviceId: string } | null> {
  const client = boundedSetupClient("myownnotion-e2e-second-device-seed");
  const deadline = armSetupDeadline(client);
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows: owners } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = owners[0]?.id;
    if (ownerId === undefined) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return null;
    }
    const deviceId = randomUUID();
    await client.query(
      `INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
       VALUES ($1, $2, $3, $4, 'active')`,
      [deviceId, ownerId, `e2e-binding-${deviceId}`, name],
    );
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
    await client.query("COMMIT");
    transactionOpen = false;
    return { secret, deviceId };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await closeSetupClient(client, deadline);
  }
}

export async function seedSessionOnNewDevice(
  name = "Second end-to-end device",
): Promise<{ secret: string; deviceId: string } | null> {
  return withSetupRetries(() => seedSessionOnNewDeviceOnce(name));
}

/** Revokes one device, the way the owner's device screen does. */
async function revokeDeviceOnce(deviceId: string): Promise<void> {
  const client = boundedSetupClient("myownnotion-e2e-device-revocation");
  const deadline = armSetupDeadline(client);
  try {
    await client.connect();
    await client.query(
      `UPDATE authorized_devices SET state = 'revoked', revoked_at = now() WHERE id = $1`,
      [deviceId],
    );
  } finally {
    await closeSetupClient(client, deadline);
  }
}

export async function revokeDevice(deviceId: string): Promise<void> {
  await withSetupRetries(() => revokeDeviceOnce(deviceId));
}
