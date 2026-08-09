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
    await client.query(
      `TRUNCATE items, placements, page_documents, logical_files, file_contents,
        relationships, revisions, revision_parents, mutations, changes,
        lifecycle_events, exports CASCADE`,
    );
  } finally {
    await client.end();
  }
}
