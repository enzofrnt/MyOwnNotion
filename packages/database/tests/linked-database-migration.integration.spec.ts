import { migrate } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { expect, it } from "vitest";

it("migrates existing database/entry identities and immutable snapshots without retaining host ownership", async () => {
  const database = await startDisposablePostgres();
  const client = new pg.Client({ connectionString: database.connectionString });
  try {
    await migrate(database.connectionString, { throughVersion: "0015_protected_file_storage" });
    await client.connect();
    const workspaceId = generateUuidV7();
    const sourceId = generateUuidV7();
    const entryId = generateUuidV7();
    const sourceRevision = generateUuidV7();
    const entryRevision = generateUuidV7();
    const mutationId = generateUuidV7();
    const placementId = generateUuidV7();
    const snapshot = {
      databaseDefinition: { opaque: "retained payload" },
      preservedContent: "Original editorial body",
    };
    await client.query("BEGIN");
    await client.query("INSERT INTO workspaces (id, schema_version) VALUES ($1, 1)", [workspaceId]);
    await client.query(
      "INSERT INTO mutations (id, workspace_id, command_type, status, accepted_at, result_revision_ids) VALUES ($1,$2,'database.create','accepted',now(),ARRAY[$3,$4]::uuid[])",
      [mutationId, workspaceId, sourceRevision, entryRevision],
    );
    await client.query(
      "INSERT INTO items (id, workspace_id, kind, name, current_revision_id) VALUES ($1,$3,'page','Source',$4),($2,$3,'page','Entry',$5)",
      [sourceId, entryId, workspaceId, sourceRevision, entryRevision],
    );
    await client.query(
      "INSERT INTO revisions (id,item_id,mutation_id,snapshot,lineage_digest) VALUES ($1,$3,$5,$6::jsonb,'source'),($2,$4,$5,$6::jsonb,'entry')",
      [sourceRevision, entryRevision, sourceId, entryId, mutationId, JSON.stringify(snapshot)],
    );
    await client.query(
      "INSERT INTO databases (item_id,workspace_id,definition_version) VALUES ($1,$2,7)",
      [sourceId, workspaceId],
    );
    await client.query(
      "INSERT INTO database_entries (entry_item_id,database_id,workspace_id,value_version,added_revision_id) VALUES ($1,$2,$3,9,$4)",
      [entryId, sourceId, workspaceId, entryRevision],
    );
    await client.query(
      "INSERT INTO placements (id,workspace_id,item_id,item_is_file,kind,parent_item_id,position_key,created_revision_id) VALUES ($1,$2,$3,false,'hierarchy',$4,'a',$5)",
      [placementId, workspaceId, entryId, sourceId, entryRevision],
    );
    await client.query("COMMIT");
    expect(await migrate(database.connectionString)).toEqual(["0016_linked_databases"]);
    expect(
      (
        await client.query(
          "SELECT item_id, definition_version, definition_revision_id FROM databases",
        )
      ).rows,
    ).toEqual([
      { item_id: sourceId, definition_version: 7, definition_revision_id: sourceRevision },
    ]);
    expect((await client.query("SELECT id,parent_item_id,item_id FROM placements")).rows).toEqual([
      { id: placementId, parent_item_id: null, item_id: entryId },
    ]);
    expect(
      (await client.query("SELECT entry_item_id,database_id,value_version FROM database_entries"))
        .rows,
    ).toEqual([{ entry_item_id: entryId, database_id: sourceId, value_version: 9 }]);
    expect(
      (await client.query("SELECT snapshot FROM revisions")).rows.map((row) => row.snapshot),
    ).toEqual([snapshot, snapshot]);
    expect(
      (
        await client.query(
          "SELECT conname FROM pg_constraint WHERE conrelid='databases'::regclass AND confrelid='items'::regclass",
        )
      ).rows,
    ).toEqual([]);
    const refresh = await client.query(
      "SELECT c.changed_item_ids, c.revision_ids, m.command_type FROM changes c JOIN mutations m ON m.id = c.mutation_id",
    );
    expect(refresh.rows).toEqual([
      {
        changed_item_ids: [sourceId, entryId],
        revision_ids: [sourceRevision],
        command_type: "database.migration.independent",
      },
    ]);
    expect(await migrate(database.connectionString)).toEqual([]);
    expect(
      (await client.query("SELECT count(*)::integer AS count FROM changes")).rows[0]?.count,
    ).toBe(1);
  } finally {
    await client.end();
    await database.stop();
  }
});
