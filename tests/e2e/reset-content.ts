/**
 * Truncates canonical content, shared by global setup and the per-project
 * reset (T106).
 *
 * `workspaces` is deliberately preserved: the API process caches its workspace
 * identity at boot, and the same process serves every Playwright project.
 */
import pg from "pg";
import { closeBoundedDatabaseClient, forceCloseDatabaseClient } from "./bounded-database.ts";

const MAX_RESET_ATTEMPTS = 5;
const RESET_QUERY_TIMEOUT_MS = 10_000;
const RESET_OPERATION_TIMEOUT_MS = 12_000;
const RETRYABLE_TRANSACTION_CODES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "55P03", // lock_not_available (our bounded lock_timeout)
  "57014", // query_canceled (our bounded statement_timeout)
  "57P01", // admin_shutdown / recovered abandoned backend
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);
const BLOCKED_RESET_CODES = new Set([
  "55P03", // lock_not_available
  "57014", // query_canceled
]);

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function isRetryableResetError(error: unknown): boolean {
  const code = postgresErrorCode(error);
  if (code !== null && RETRYABLE_TRANSACTION_CODES.has(code)) return true;
  if (!(error instanceof Error)) return false;
  return /(?:query read timeout|connection terminated|timeout expired|client was closed)/iu.test(
    error.message,
  );
}

/**
 * Bounds the whole transaction, including rollback and connection teardown.
 *
 * Per-query timeouts alone do not help when PostgreSQL cancels a blocked
 * TRUNCATE but the client then waits forever while rolling the transaction
 * back. Closing an active pg client destroys its socket, rejects every pending
 * operation, and lets the next attempt start with a clean connection.
 */
function armResetDeadline(client: pg.Client): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    forceCloseDatabaseClient(client);
  }, RESET_OPERATION_TIMEOUT_MS);
}

async function closeResetClient(
  client: pg.Client,
  deadline: ReturnType<typeof setTimeout>,
): Promise<void> {
  clearTimeout(deadline);
  await closeBoundedDatabaseClient(client);
}

async function resetCanonicalContentOnce(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
  const client = new pg.Client({
    connectionString,
    application_name: "myownnotion-e2e-content-reset",
    connectionTimeoutMillis: RESET_QUERY_TIMEOUT_MS,
    query_timeout: RESET_QUERY_TIMEOUT_MS,
    // Protect the first statement too; SET LOCAL only applies after BEGIN.
    options: `-c statement_timeout=${RESET_QUERY_TIMEOUT_MS} -c lock_timeout=2000`,
  });
  const deadline = armResetDeadline(client);
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    // A background read may overlap the boundary between two journeys. Wait a
    // bounded amount, roll back, and retry instead of consuming the test's
    // entire timeout inside an opaque fixture setup.
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    await client.query(`SET LOCAL statement_timeout = '10s'`);
    // One TRUNCATE first, before any DELETE: deleting from the guarded
    // page-operation tables queues FK-check trigger events, and a later
    // TRUNCATE touching those tables then aborts with "pending trigger
    // events". Truncating everything canonical up front leaves nothing for
    // the deletes below to trip over.
    await client.query(
      `TRUNCATE items, placements, page_documents, logical_files, file_contents,
        relationships, revisions, revision_parents, mutations, changes,
        lifecycle_events, exports,
        page_operation_states, page_operation_updates, page_operation_checkpoints,
        page_device_frontiers, page_ambiguities, page_legacy_branch_conversions
        CASCADE`,
    );
    // `installations.previous_backup_id` points back to backups. PostgreSQL's
    // TRUNCATE ... CASCADE follows that relationship by truncating the
    // installation itself, even when the column is null; the API then keeps
    // serving from a process whose installation row vanished. Clear the
    // optional provenance and delete backup records in dependency order.
    await client.query(`UPDATE installations SET previous_backup_id = NULL`);
    await client.query(`DELETE FROM restoration_attempts`);
    await client.query(`DELETE FROM backup_verifications`);
    await client.query(`DELETE FROM backups`);
    // Operational page state (feature 017) references protected envelopes for
    // its checkpoints and frontiers. It is derived, device-independent server
    // state, so a fresh journey must start without it.
    await client.query(`DELETE FROM page_legacy_branch_conversions`);
    await client.query(`DELETE FROM page_ambiguities`);
    await client.query(`DELETE FROM page_device_frontiers`);
    await client.query(`DELETE FROM page_operation_checkpoints`);
    await client.query(`DELETE FROM page_operation_updates`);
    await client.query(`DELETE FROM page_operation_states`);
    // Protected payloads deliberately have no foreign key to canonical rows:
    // they must survive a production migration scrub. In an isolated E2E
    // installation that also means they must be cleared explicitly, otherwise
    // a later run can read an old envelope for a reused canonical identity.
    await client.query(`DELETE FROM protected_blob_chunks`);
    await client.query(`DELETE FROM protected_envelopes`);
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await closeResetClient(client, deadline);
  }
}

/**
 * Recovers a lock left by a dead E2E request, but only after a reset has
 * actually timed out waiting for it and the transaction has been abandoned
 * for at least thirty seconds.
 *
 * Doing this before every reset is unsafe even in a disposable database: the
 * API pool can still hold the terminated socket and return one transient 500
 * before it evicts that connection. A bounded lock timeout is therefore the
 * evidence that recovery may be needed; the age threshold distinguishes an
 * abandoned request from the few milliseconds between an API statement and
 * its commit. Deadlocks and serialization retries never enter this path.
 */
async function recoverAbandonedTransactions(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
  const client = new pg.Client({
    connectionString,
    application_name: "myownnotion-e2e-content-reset-recovery",
    connectionTimeoutMillis: RESET_QUERY_TIMEOUT_MS,
    query_timeout: RESET_QUERY_TIMEOUT_MS,
    options: `-c statement_timeout=${RESET_QUERY_TIMEOUT_MS}`,
  });
  const deadline = armResetDeadline(client);
  try {
    await client.connect();
    // Every matrix stack owns this disposable database. Restrict recovery to
    // transactions that are already idle there: healthy idle pool connections
    // and active requests are deliberately left alone.
    await client.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND state LIKE 'idle in transaction%'
          AND xact_start < clock_timestamp() - interval '30 seconds'`,
    );
  } finally {
    await closeResetClient(client, deadline);
  }
}

export async function resetCanonicalContent(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RESET_ATTEMPTS; attempt += 1) {
    try {
      await resetCanonicalContentOnce();
      return;
    } catch (error) {
      const code = postgresErrorCode(error) ?? "";
      const retryable = isRetryableResetError(error);
      if (!retryable || attempt === MAX_RESET_ATTEMPTS) throw error;
      if (BLOCKED_RESET_CODES.has(code)) await recoverAbandonedTransactions();
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 50));
    }
  }
}
