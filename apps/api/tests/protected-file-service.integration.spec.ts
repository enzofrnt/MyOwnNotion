import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  getOrCreateWorkspace,
  listProtectedFileChunks,
} from "@myownnotion/database";
import { generateUuidV7, PROTECTED_FILE_CHUNK_BYTES } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProtectedFileRuntime } from "../src/files/protected-file-runtime.ts";

let postgres: DisposablePostgres;
let database: DatabaseHandle;
let root: string;
let runtime: ReturnType<typeof createProtectedFileRuntime>;
let workspaceId: string;
const installationId = generateUuidV7();
const deploymentKey = randomBytes(32);
const now = () => new Date("2026-09-05T00:00:00Z");

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  database = createDatabase(postgres.connectionString);
  root = await mkdtemp(path.join(os.tmpdir(), "mon-protected-file-service-"));
  workspaceId = (await getOrCreateWorkspace(database.db)).id;
  await createInstallation(database.db, {
    id: installationId,
    sourceLineageId: installationId,
    schemaVersion: 1,
  });
  runtime = createProtectedFileRuntime({
    db: database.db,
    workspaceId,
    installationId,
    blobRoot: root,
    deploymentKey: () => deploymentKey,
    now,
  });
  await database.db.transaction((tx) => runtime.keys.initialize(tx));
});
afterAll(async () => {
  await database?.close();
  await postgres?.stop();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function* source(bytes: Uint8Array) {
  yield bytes;
}
async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

describe("shared protected file runtime", () => {
  it("stores ciphertext and private inventory, then reopens exact multi-chunk bytes after restart", async () => {
    const sentinel = "private-attachment-sentinel-for-logical-storage-inspection";
    const bytes = Buffer.alloc(PROTECTED_FILE_CHUNK_BYTES + 29, 8);
    bytes.write(sentinel);
    const stored = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(bytes), {
        maxBytes: bytes.length,
        expectedLength: bytes.length,
      }),
    );
    const rows = await database.db.execute(
      sql`SELECT * FROM file_contents WHERE id = ${stored.contentId}`,
    );
    expect(rows.rows[0]).toMatchObject({
      storage_format: "encrypted-chunks-v1",
      sha256: null,
      storage_key: null,
      reference_count: 0,
    });
    expect(
      JSON.stringify((await database.db.execute(sql`SELECT * FROM protected_envelopes`)).rows),
    ).not.toContain(sentinel);
    for (const directory of await readdir(root)) {
      for (const file of await readdir(path.join(root, directory)))
        expect(
          (await readFile(path.join(root, directory, file))).includes(Buffer.from(sentinel)),
        ).toBe(false);
    }
    const restarted = createProtectedFileRuntime({
      db: database.db,
      workspaceId,
      installationId,
      blobRoot: root,
      deploymentKey: () => deploymentKey,
      now,
    });
    const opened = await collect(restarted.files.read(database.db, stored.contentId));
    expect(Buffer.compare(opened, bytes)).toBe(0);
    expect(Buffer.from(stored.sha256).toString("hex")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(await restarted.files.manifest(database.db, stored.contentId)).toMatchObject({
      byteLength: bytes.length,
      chunks: [{ index: 0 }, { index: 1 }],
    });
  });

  it("supports an authenticated empty file without any chunk rows", async () => {
    const stored = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(Buffer.alloc(0)), { maxBytes: 0, expectedLength: 0 }),
    );
    expect(await collect(runtime.files.read(database.db, stored.contentId))).toEqual(
      Buffer.alloc(0),
    );
    expect(
      await listProtectedFileChunks(database.db, runtime.files.scope("content", stored.contentId)),
    ).toEqual([]);
  });

  it("does not publish SQL content on source interruption, overflow or incomplete declared length", async () => {
    for (const mode of ["interrupted", "overflow", "short"] as const) {
      const contentId = generateUuidV7();
      const input = (async function* () {
        yield Buffer.alloc(20, 1);
        if (mode === "interrupted") throw new Error("source interrupted");
      })();
      await expect(
        database.db.transaction((tx) =>
          runtime.files.ingest(tx, input, {
            contentId,
            maxBytes: mode === "overflow" ? 10 : 30,
            expectedLength: mode === "short" ? 30 : 10,
          }),
        ),
      ).rejects.toThrow();
      expect(
        (await database.db.execute(sql`SELECT id FROM file_contents WHERE id = ${contentId}`)).rows,
      ).toEqual([]);
      expect(
        await listProtectedFileChunks(database.db, runtime.files.scope("content", contentId)),
      ).toEqual([]);
    }
  });

  it("refuses missing deployment material before consuming input", async () => {
    const unavailable = createProtectedFileRuntime({
      db: database.db,
      workspaceId,
      installationId,
      blobRoot: root,
      deploymentKey: () => null,
    });
    let consumed = false;
    const input = (async function* () {
      consumed = true;
      yield Buffer.from("private");
    })();
    await expect(
      database.db.transaction((tx) => unavailable.files.ingest(tx, input, { maxBytes: 100 })),
    ).rejects.toThrow("protected data is unavailable");
    expect(consumed).toBe(false);
  });

  it("rejects a missing tail before yielding any bytes and refuses corrupted ciphertext", async () => {
    const stored = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(Buffer.alloc(PROTECTED_FILE_CHUNK_BYTES + 1, 2)), {
        maxBytes: PROTECTED_FILE_CHUNK_BYTES + 1,
      }),
    );
    const scope = runtime.files.scope("content", stored.contentId);
    await database.db.execute(
      sql`DELETE FROM protected_blob_chunks WHERE content_id = ${stored.contentId} AND chunk_index = 1`,
    );
    const reading = runtime.files.read(database.db, stored.contentId);
    await expect(reading.next()).rejects.toThrow();
    const small = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(Buffer.from("private bytes")), { maxBytes: 100 }),
    );
    const [chunk] = await listProtectedFileChunks(database.db, { ...scope, id: small.contentId });
    if (chunk === undefined) throw new Error("Missing chunk fixture");
    await writeFile(path.join(root, chunk.storageKey.slice(0, 2), chunk.storageKey), "damaged");
    await expect(collect(runtime.files.read(database.db, small.contentId))).rejects.toThrow();
  });
});
