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
  it("applies the single baseline from an empty database (feature 058)", async () => {
    const applied = await applyMigrations(database.connectionString);
    expect(applied).toEqual(["0001_baseline"]);
  });

  it("refuses a database built from the pre-baseline history and changes nothing", async () => {
    const legacy = await startDisposablePostgres();
    const client = new pg.Client({ connectionString: legacy.connectionString });
    await client.connect();
    try {
      await client.query(
        "CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await client.query("INSERT INTO schema_migrations (version) VALUES ('0001_initial')");
      await expect(applyMigrations(legacy.connectionString)).rejects.toThrow(
        /recreate the development database/,
      );
      const { rows } = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await client.end();
      await legacy.stop();
    }
  });

  it("adds a nullable item icon with file and length guards", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ nullable: string }>(
        `SELECT is_nullable AS nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'icon'`,
      );
      expect(rows).toEqual([{ nullable: "YES" }]);
      const constraints = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'items'::regclass
            AND conname IN ('items_icon_length_check', 'items_file_icon_check')`,
      );
      expect(constraints.rows.map(({ conname }) => conname).sort()).toEqual([
        "items_file_icon_check",
        "items_icon_length_check",
      ]);
    } finally {
      await client.end();
    }
  });

  it("retains an editor upload's source page until finalization", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ exists: boolean; nullable: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'uploads'
              AND column_name = 'attachment_parent_item_id'
         ) AS exists,
         EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'uploads'
              AND column_name = 'attachment_parent_item_id' AND is_nullable = 'YES'
         ) AS nullable`,
      );
      expect(rows[0]).toEqual({ exists: true, nullable: true });
    } finally {
      await client.end();
    }
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
          "databases",
          "database_entries",
          "page_operation_states",
          "page_operation_updates",
          "page_operation_checkpoints",
          "page_device_frontiers",
          "page_ambiguities",
          "page_legacy_branch_conversions",
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

  it("records the database migration only with its complete table pair", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{
        migration_recorded: boolean;
        databases_exists: boolean;
        entries_exists: boolean;
      }>(
        `SELECT
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_baseline')
             AS migration_recorded,
           to_regclass('public.databases') IS NOT NULL AS databases_exists,
           to_regclass('public.database_entries') IS NOT NULL AS entries_exists`,
      );
      expect(rows[0]).toEqual({
        migration_recorded: true,
        databases_exists: true,
        entries_exists: true,
      });
      // Startup after an interruption resumes through the migration registry;
      // an already committed 0007 is a no-op rather than a second schema.
      expect(await applyMigrations(database.connectionString)).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("records page operations only with every causal table and invariant", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{
        migration_recorded: boolean;
        compaction_migration_recorded: boolean;
        compaction_indexes_migration_recorded: boolean;
        backup_migration_recorded: boolean;
        state_exists: boolean;
        updates_exists: boolean;
        checkpoints_exists: boolean;
        frontiers_exists: boolean;
        ambiguities_exists: boolean;
        conversions_exists: boolean;
        base_frontier_nullable: boolean;
        update_payload_nullable: boolean;
        compacted_at_exists: boolean;
        verified_backup_id_exists: boolean;
      }>(
        `SELECT
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_baseline')
             AS migration_recorded,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_baseline')
             AS compaction_migration_recorded,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_baseline')
             AS backup_migration_recorded,
           EXISTS (
             SELECT 1 FROM schema_migrations
              WHERE version = '0001_baseline'
           ) AS compaction_indexes_migration_recorded,
           to_regclass('public.page_operation_states') IS NOT NULL AS state_exists,
           to_regclass('public.page_operation_updates') IS NOT NULL AS updates_exists,
           to_regclass('public.page_operation_checkpoints') IS NOT NULL AS checkpoints_exists,
           to_regclass('public.page_device_frontiers') IS NOT NULL AS frontiers_exists,
           to_regclass('public.page_ambiguities') IS NOT NULL AS ambiguities_exists,
           to_regclass('public.page_legacy_branch_conversions') IS NOT NULL AS conversions_exists,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'page_operation_updates'
                AND column_name = 'base_frontier_envelope_id' AND is_nullable = 'YES'
           ) AS base_frontier_nullable,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'page_operation_updates'
                AND column_name = 'update_envelope_id' AND is_nullable = 'YES'
           ) AS update_payload_nullable,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'page_operation_updates'
                AND column_name = 'compacted_at'
           ) AS compacted_at_exists,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'page_operation_checkpoints'
                AND column_name = 'verified_backup_id'
           ) AS verified_backup_id_exists`,
      );
      expect(rows[0]).toEqual({
        migration_recorded: true,
        compaction_migration_recorded: true,
        compaction_indexes_migration_recorded: true,
        backup_migration_recorded: true,
        state_exists: true,
        updates_exists: true,
        checkpoints_exists: true,
        frontiers_exists: true,
        ambiguities_exists: true,
        conversions_exists: true,
        base_frontier_nullable: true,
        update_payload_nullable: true,
        compacted_at_exists: true,
        verified_backup_id_exists: true,
      });

      const constraints = await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN (
            'page_operation_updates_sequence_unique',
            'page_operation_updates_compaction_check',
            'page_ambiguities_logical_unique'
          )
          ORDER BY conname`,
      );
      expect(constraints.rows.map(({ conname }) => conname)).toEqual([
        "page_ambiguities_logical_unique",
        "page_operation_updates_compaction_check",
        "page_operation_updates_sequence_unique",
      ]);
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'page_operation_updates_base_frontier_envelope_idx',
              'page_operation_updates_update_envelope_idx'
            )
          ORDER BY indexname`,
      );
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
        "page_operation_updates_base_frontier_envelope_idx",
        "page_operation_updates_update_envelope_idx",
      ]);
      const triggers = await client.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE NOT tgisinternal
            AND tgname IN (
              'page_operation_states_page_kind_check',
              'page_device_frontiers_no_retreat_guard',
              'page_operation_current_checkpoint_verified'
            )
          ORDER BY tgname`,
      );
      expect(triggers.rows.map(({ tgname }) => tgname)).toEqual([
        "page_device_frontiers_no_retreat_guard",
        "page_operation_current_checkpoint_verified",
        "page_operation_states_page_kind_check",
      ]);
    } finally {
      await client.end();
    }
  });

  it("rolls back the whole database capability transaction on an identity violation", async () => {
    const client = new pg.Client({ connectionString: database.connectionString });
    await client.connect();
    const workspaceId = "00000000-0000-7000-8000-0000000e0001";
    const itemId = "00000000-0000-7000-8000-0000000e0010";
    const revisionId = "00000000-0000-7000-8000-0000000e0020";
    const mutationId = "00000000-0000-7000-8000-0000000e0002";
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(`INSERT INTO workspaces (id, schema_version) VALUES ($1, 1)`, [
        workspaceId,
      ]);
      await client.query(
        `INSERT INTO mutations (id, workspace_id, command_type, status, accepted_at, result_revision_ids)
         VALUES ($1, $2, 'database.create', 'accepted', now(), ARRAY[$3]::uuid[])`,
        [mutationId, workspaceId, revisionId],
      );
      await client.query(
        `INSERT INTO items (id, workspace_id, kind, name, current_revision_id)
         VALUES ($1, $2, 'database', 'Database host', $3)`,
        [itemId, workspaceId, revisionId],
      );
      await client.query(
        `INSERT INTO revisions (id, item_id, mutation_id, lineage_digest)
         VALUES ($1, $2, $3, 'digest')`,
        [revisionId, itemId, mutationId],
      );
      await client.query(
        `INSERT INTO databases (item_id, source_id, workspace_id, definition_version)
         VALUES ($1, $3, $2, 1)`,
        [itemId, workspaceId, "00000000-0000-7000-8000-0000000e0030"],
      );

      await expect(
        client.query(
          `INSERT INTO database_entries
             (entry_item_id, database_id, workspace_id, value_version, added_revision_id, value_revision_id)
           VALUES ($1, $1, $2, 1, $3, $3)`,
          [itemId, workspaceId, revisionId],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK");

      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM databases WHERE item_id = $1`,
        [itemId],
      );
      expect(rows[0]?.count).toBe("0");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
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
