/**
 * Playwright global setup: start each end-to-end run from empty canonical
 * content so journeys are deterministic. The workspace row is preserved
 * because the API process caches its identity at boot.
 */
import pg from "pg";

export default async function globalSetup(): Promise<void> {
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
