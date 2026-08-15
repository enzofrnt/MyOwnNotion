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
    expect(applied).toContain("0001_initial");
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
      // Predicated on the denormalised file-ness, not on the kind. Copying
      // the kind is what made a page unable to become a folder, because every
      // placement row referenced it through a composite foreign key.
      expect(rows[0]?.indexdef).toContain("NOT item_is_file");
    } finally {
      await client.end();
    }
  });

  it("lets an item's kind change without touching its placements", async () => {
    // The property the whole feature-004 schema change exists for, asserted
    // against a real database rather than argued in a comment.
    //
    // Under the previous schema this update violated `placements_item_kind_fk`
    // on every placement the item had, because the composite key referenced
    // (id, kind) — a value that changes when a page becomes a folder. It now
    // references (id, is_file), which does not.
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const workspaceId = "00000000-0000-7000-8000-0000000f0001";
      const itemId = "00000000-0000-7000-8000-0000000f0010";
      const revisionId = "00000000-0000-7000-8000-0000000f0020";
      const mutationId = "00000000-0000-7000-8000-0000000f0002";
      const placementId = "00000000-0000-7000-8000-0000000f0030";

      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(
        `INSERT INTO workspaces (id, schema_version) VALUES ($1, 1)
         ON CONFLICT DO NOTHING`,
        [workspaceId],
      );
      await client.query(
        `INSERT INTO mutations (id, workspace_id, command_type, status, accepted_at, result_revision_ids)
         VALUES ($1, $2, 'item.create', 'accepted', now(), ARRAY[$3]::uuid[])`,
        [mutationId, workspaceId, revisionId],
      );
      await client.query(
        `INSERT INTO items (id, workspace_id, kind, name, current_revision_id)
         VALUES ($1, $2, 'page', 'Convertible', $3)`,
        [itemId, workspaceId, revisionId],
      );
      await client.query(
        `INSERT INTO revisions (id, item_id, mutation_id, lineage_digest)
         VALUES ($1, $2, $3, 'digest')`,
        [revisionId, itemId, mutationId],
      );
      await client.query(
        `INSERT INTO placements
           (id, workspace_id, item_id, item_is_file, kind, parent_item_id, position_key, created_revision_id)
         VALUES ($1, $2, $3, false, 'hierarchy', NULL, 'V', $4)`,
        [placementId, workspaceId, itemId, revisionId],
      );
      await client.query("COMMIT");

      await client.query(`UPDATE items SET kind = 'folder' WHERE id = $1`, [itemId]);

      const { rows } = await client.query<{ kind: string; position_key: string }>(
        `SELECT i.kind, p.position_key
           FROM items i JOIN placements p ON p.item_id = i.id
          WHERE i.id = $1`,
        [itemId],
      );
      expect(rows[0]?.kind).toBe("folder");
      // Same placement, same position: the conversion did not move anything.
      expect(rows[0]?.position_key).toBe("V");
    } finally {
      await client.end();
    }
  });
});
