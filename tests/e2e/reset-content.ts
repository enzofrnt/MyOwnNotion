/**
 * Truncates canonical content, shared by global setup and the per-project
 * reset (T106).
 *
 * `workspaces` is deliberately preserved: the API process caches its workspace
 * identity at boot, and the same process serves every Playwright project.
 */
import pg from "pg";

export async function resetCanonicalContent(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    // `installations.previous_backup_id` points back to backups. PostgreSQL's
    // TRUNCATE ... CASCADE follows that relationship by truncating the
    // installation itself, even when the column is null; the API then keeps
    // serving from a process whose installation row vanished. Clear the
    // optional provenance and delete backup records in dependency order.
    await client.query(`UPDATE installations SET previous_backup_id = NULL`);
    await client.query(`DELETE FROM restoration_attempts`);
    await client.query(`DELETE FROM backup_verifications`);
    await client.query(`DELETE FROM backups`);
    // Protected payloads deliberately have no foreign key to canonical rows:
    // they must survive a production migration scrub. In an isolated E2E
    // installation that also means they must be cleared explicitly, otherwise
    // a later run can read an old envelope for a reused canonical identity.
    await client.query(`DELETE FROM protected_blob_chunks`);
    await client.query(`DELETE FROM protected_envelopes`);
    await client.query(
      `TRUNCATE items, placements, page_documents, logical_files, file_contents,
        relationships, revisions, revision_parents, mutations, changes,
        lifecycle_events, exports CASCADE`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
