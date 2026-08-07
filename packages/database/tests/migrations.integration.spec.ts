/**
 * Migration verification (T022): reviewed SQL applies to an empty database,
 * is idempotent through the version registry, and yields the complete
 * canonical schema with its deferred constraints.
 */

import { applyMigrations, startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: Awaited<ReturnType<typeof startDisposablePostgres>>;

beforeAll(async () => {
  database = await startDisposablePostgres();
});

afterAll(async () => {
  await database.stop();
});

describe("reviewed SQL migrations", () => {
  it("applies from an empty database", async () => {
    const applied = await applyMigrations(database.connectionString);
    expect(applied).toContain("0001_content_foundations");
  });

  it("is idempotent: reapplying applies nothing", async () => {
    const applied = await applyMigrations(database.connectionString);
    expect(applied).toEqual([]);
  });

  it("creates the complete canonical table set", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const tables = rows.map((row) => row.table_name);
      expect(tables).toEqual(
        expect.arrayContaining([
          "workspaces",
          "items",
          "placements",
          "page_documents",
          "file_contents",
          "logical_files",
          "mutations",
          "revisions",
          "revision_parents",
          "changes",
          "relationships",
          "lifecycle_events",
          "exports",
          "schema_migrations",
        ]),
      );
    } finally {
      await client.end();
    }
  });

  it("defers the circular item↔revision constraint", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ condeferrable: boolean; condeferred: boolean }>(
        `SELECT condeferrable, condeferred FROM pg_constraint
         WHERE conname = 'items_current_revision_fk'`,
      );
      expect(rows[0]?.condeferrable).toBe(true);
      expect(rows[0]?.condeferred).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("enforces single active hierarchy placement for non-files", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'placements_single_hierarchy_unique'`,
      );
      expect(rows[0]?.indexdef).toContain("UNIQUE");
      expect(rows[0]?.indexdef).toContain("item_kind <> 'file'");
    } finally {
      await client.end();
    }
  });
});
