import { randomUUID } from "node:crypto";
import { migrate } from "@myownnotion/database";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { expect, it } from "vitest";

it("adds encrypted file storage without changing existing content identities or acknowledged uploads", async () => {
  const database = await startDisposablePostgres();
  const client = new pg.Client({ connectionString: database.connectionString });
  const workspace = randomUUID();
  const installation = randomUUID();
  const content = randomUUID();
  const upload = randomUUID();
  try {
    await migrate(database.connectionString, { throughVersion: "0014_full_backup_provenance" });
    await client.connect();
    await client.query("INSERT INTO workspaces(id, schema_version) VALUES ($1, 1)", [workspace]);
    await client.query(
      "INSERT INTO installations(id, source_lineage_id, state, schema_version) VALUES ($1, $2, 'uninitialized', 1)",
      [installation, randomUUID()],
    );
    await client.query(
      "INSERT INTO file_contents(id, sha256, byte_length, storage_key) VALUES ($1, $2, 9, $3)",
      [content, Buffer.alloc(32, 1), "01".repeat(32)],
    );
    await client.query(
      "INSERT INTO uploads(id, workspace_id, declared_length, received_length, media_type, original_name, storage_key, expires_at) VALUES ($1, $2, 20, 9, 'text/plain', 'historical.txt', $3, now() + interval '1 day')",
      [upload, workspace, upload],
    );

    expect(await migrate(database.connectionString)).toEqual(["0015_protected_file_storage"]);
    expect(await migrate(database.connectionString)).toEqual([]);
    expect(
      (
        await client.query(
          "SELECT id, storage_format, manifest_version, byte_length, sha256, storage_key FROM file_contents WHERE id = $1",
          [content],
        )
      ).rows[0],
    ).toEqual({
      id: content,
      storage_format: "legacy-v1",
      manifest_version: 0,
      byte_length: "9",
      sha256: Buffer.alloc(32, 1),
      storage_key: "01".repeat(32),
    });
    expect(
      (
        await client.query(
          "SELECT id, storage_format, received_length, original_name FROM uploads WHERE id = $1",
          [upload],
        )
      ).rows[0],
    ).toEqual({
      id: upload,
      storage_format: "legacy-v1",
      received_length: "9",
      original_name: "historical.txt",
    });

    // Format cutover cannot leave the identifying digest/locator readable.
    await expect(
      client.query(
        "UPDATE file_contents SET storage_format = 'encrypted-chunks-v1', manifest_version = 1, lookup_tag = $1 WHERE id = $2",
        [Buffer.alloc(32, 2), content],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query(
      "UPDATE file_contents SET storage_format = 'encrypted-chunks-v1', manifest_version = 1, lookup_tag = $1, sha256 = NULL, storage_key = NULL WHERE id = $2",
      [Buffer.alloc(32, 2), content],
    );
    await expect(
      client.query("UPDATE file_contents SET lookup_tag = $1 WHERE id = $2", [
        Buffer.alloc(31),
        content,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query("UPDATE file_contents SET storage_format = 'unknown' WHERE id = $1", [content]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await client.query(
          "SELECT sha256, storage_key, manifest_version FROM file_contents WHERE id = $1",
          [content],
        )
      ).rows[0],
    ).toEqual({ sha256: null, storage_key: null, manifest_version: 1 });

    await expect(
      client.query("UPDATE uploads SET storage_format = 'encrypted-chunks-v1' WHERE id = $1", [
        upload,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query(
      "UPDATE uploads SET storage_format = 'encrypted-chunks-v1', manifest_version = 1 WHERE id = $1",
      [upload],
    );
    const insertChunk = (index: number, length: number, generation = 1) =>
      client.query(
        "INSERT INTO protected_upload_chunks(id, installation_id, workspace_id, upload_id, chunk_index, key_generation, record_version, storage_key, salt, nonce, tag, aad_digest, byte_length) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'salt', 'nonce', 'tag', 'aad', $8)",
        [
          randomUUID(),
          installation,
          workspace,
          upload,
          index,
          generation,
          randomUUID().replaceAll("-", "").repeat(2),
          length,
        ],
      );
    await insertChunk(0, 9);
    await expect(insertChunk(0, 9)).rejects.toMatchObject({ code: "23505" });
    for (const [index, length, generation] of [
      [-1, 9, 1],
      [1, 0, 1],
      [1, 4194305, 1],
      [1, 9, 0],
    ]) {
      await expect(
        insertChunk(index as number, length as number, generation),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await client.query("DELETE FROM uploads WHERE id = $1", [upload]);
    expect(
      (await client.query("SELECT count(*)::int AS count FROM protected_upload_chunks")).rows[0]
        .count,
    ).toBe(0);
    expect(
      (await client.query("SELECT count(*)::int AS count FROM file_storage_transitions")).rows[0]
        .count,
    ).toBe(0);
    expect(
      (await client.query("SELECT count(*)::int AS count FROM protected_file_quarantine")).rows[0]
        .count,
    ).toBe(0);
    const envelope = randomUUID();
    await client.query(
      "INSERT INTO protected_envelopes(id, installation_id, workspace_id, entity_type, entity_id, key_generation, record_version, salt, nonce, ciphertext, tag, aad_digest) VALUES ($1, $2, $3, 'file.transition-inventory', $4, 1, 1, 'salt', 'nonce', 'ciphertext', 'tag', 'aad')",
      [envelope, installation, workspace, randomUUID()],
    );
    const transition = randomUUID();
    await expect(
      client.query(
        "INSERT INTO file_storage_transitions(id, installation_id, source_inventory_envelope_id, phase) VALUES ($1, $2, $3, 'inventoried')",
        [transition, installation, envelope],
      ),
    ).rejects.toMatchObject({ code: "23502" });
    await client.query(
      "INSERT INTO file_storage_transitions(id, installation_id, source_backup_id, source_inventory_envelope_id, phase) VALUES ($1, $2, $3, $4, 'inventoried')",
      [transition, installation, randomUUID(), envelope],
    );
    await expect(
      client.query("UPDATE file_storage_transitions SET phase = 'complete' WHERE id = $1", [
        transition,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    const entry = randomUUID();
    await client.query(
      "INSERT INTO file_storage_transition_entries(id, transition_id, kind, object_id, source_envelope_id, phase) VALUES ($1, $2, 'content', $3, $4, 'inventoried')",
      [entry, transition, content, envelope],
    );
    await expect(
      client.query("UPDATE file_storage_transition_entries SET phase = 'verified' WHERE id = $1", [
        entry,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query(
      "UPDATE file_storage_transition_entries SET phase = 'verified', replacement_envelope_id = $1 WHERE id = $2",
      [envelope, entry],
    );
    await client.query(
      "INSERT INTO protected_file_quarantine(id, transition_entry_id, storage_key, manifest_envelope_id) VALUES ($1, $2, $3, $4)",
      [randomUUID(), entry, "ab".repeat(32), envelope],
    );
    await expect(
      client.query("DELETE FROM file_storage_transitions WHERE id = $1", [transition]),
    ).rejects.toMatchObject({ code: "23503" });
    await client.query(
      "UPDATE file_storage_transitions SET phase = 'complete', completed_at = now() WHERE id = $1",
      [transition],
    );
  } finally {
    await client.end();
    await database.stop();
  }
});
