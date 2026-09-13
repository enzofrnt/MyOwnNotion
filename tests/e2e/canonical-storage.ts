import { withBoundedDatabaseClient } from "./bounded-database.ts";
import { expect } from "./fixtures.ts";

/** Inspect committed server storage only after independent UI/API convergence assertions. */
export async function expectPrivateCanonicalStorage(sentinels: readonly string[]): Promise<void> {
  const rows = await withBoundedDatabaseClient(
    "canonical-offline-privacy-e2e",
    async (client) =>
      (
        await client.query(`
        SELECT to_jsonb(t)::text AS payload FROM items t
        UNION ALL SELECT to_jsonb(t)::text FROM page_documents t
        UNION ALL SELECT to_jsonb(t)::text FROM revisions t
        UNION ALL SELECT to_jsonb(t)::text FROM databases t
        UNION ALL SELECT to_jsonb(t)::text FROM database_entries t
        UNION ALL SELECT to_jsonb(t)::text FROM relationships t
        UNION ALL SELECT to_jsonb(t)::text FROM protected_envelopes t
        UNION ALL SELECT to_jsonb(t)::text FROM page_operation_states t
        UNION ALL SELECT to_jsonb(t)::text FROM page_operation_updates t
        UNION ALL SELECT to_jsonb(t)::text FROM page_operation_checkpoints t
      `)
      ).rows,
  );
  expect(rows.length).toBeGreaterThan(0);
  const stored = JSON.stringify(rows);
  expect(stored).toContain("item.name");
  for (const sentinel of sentinels) expect(stored).not.toContain(sentinel);
}
