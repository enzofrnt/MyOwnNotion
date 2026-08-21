/**
 * Truncates canonical content, shared by global setup and the per-project
 * reset (T106).
 *
 * `workspaces` is deliberately preserved: the API process caches its workspace
 * identity at boot, and the same process serves every Playwright project.
 */
import pg from "pg";

const MAX_RESET_ATTEMPTS = 5;
const RETRYABLE_TRANSACTION_CODES = new Set(["40P01", "40001"]);

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

async function resetCanonicalContentOnce(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export async function resetCanonicalContent(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RESET_ATTEMPTS; attempt += 1) {
    try {
      await resetCanonicalContentOnce();
      return;
    } catch (error) {
      const retryable = RETRYABLE_TRANSACTION_CODES.has(postgresErrorCode(error) ?? "");
      if (!retryable || attempt === MAX_RESET_ATTEMPTS) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 50));
    }
  }
}
