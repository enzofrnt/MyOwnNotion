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
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";

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
  it("decrypts only overlapping range chunks and refuses a tampered selected chunk before yielding", async () => {
    const bytes = randomBytes(PROTECTED_FILE_CHUNK_BYTES * 2 + 17);
    const stored = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(bytes), { maxBytes: bytes.length }),
    );
    const chunks = await listProtectedFileChunks(
      database.db,
      runtime.files.scope("content", stored.contentId),
    );
    const range = { start: PROTECTED_FILE_CHUNK_BYTES - 5, end: PROTECTED_FILE_CHUNK_BYTES + 5 };
    expect(await collect(runtime.files.read(database.db, stored.contentId, range))).toEqual(
      bytes.subarray(range.start, range.end + 1),
    );
    const first = chunks[0];
    if (first === undefined) throw new Error("Missing chunk fixture");
    await writeFile(
      path.join(root, first.storageKey.slice(0, 2), first.storageKey),
      Buffer.from("corrupt ciphertext"),
    );
    const tail = { start: bytes.length - 9, end: bytes.length - 1 };
    expect(await collect(runtime.files.read(database.db, stored.contentId, tail))).toEqual(
      bytes.subarray(tail.start),
    );
    const broken = runtime.files.read(database.db, stored.contentId, { start: 0, end: 2 });
    await expect(broken.next()).rejects.toThrow();
  });

  it("resumes across a full chunk boundary, rewrites only the tail and reopens the accepted prefix", async () => {
    const transfers = new ProtectedUploadService(runtime.files);
    const upload = await database.db.transaction((tx) =>
      transfers.create(tx, {
        workspaceId: workspaceId as import("@myownnotion/domain").Uuid,
        declaredLength: PROTECTED_FILE_CHUNK_BYTES + 100,
        originalName: "private transfer.txt",
        mediaType: "text/plain",
      }),
    );
    const first = Buffer.alloc(PROTECTED_FILE_CHUNK_BYTES - 3, 5);
    await database.db.transaction((tx) =>
      transfers.append(tx, { id: upload.id, offset: 0, source: source(first) }),
    );
    await database.db.transaction((tx) =>
      transfers.append(tx, {
        id: upload.id,
        offset: first.length,
        source: source(Buffer.from("ABCDE")),
      }),
    );
    const before = await listProtectedFileChunks(
      database.db,
      runtime.files.scope("upload", upload.id),
    );
    expect(before).toHaveLength(2);
    await database.db.transaction((tx) =>
      transfers.append(tx, {
        id: upload.id,
        offset: first.length + 5,
        source: source(Buffer.from("FG")),
      }),
    );
    const after = await listProtectedFileChunks(
      database.db,
      runtime.files.scope("upload", upload.id),
    );
    expect(after[0]?.storageKey).toBe(before[0]?.storageKey);
    expect(after[1]?.storageKey).not.toBe(before[1]?.storageKey);
    const restarted = createProtectedFileRuntime({
      db: database.db,
      workspaceId,
      installationId,
      blobRoot: root,
      deploymentKey: () => deploymentKey,
    });
    const reopenedTransfers = new ProtectedUploadService(restarted.files);
    const resumed = await reopenedTransfers.get(database.db, upload.id);
    if (resumed === null) throw new Error("Missing upload fixture");
    expect(resumed).toMatchObject({
      receivedLength: first.length + 7,
      originalName: "private transfer.txt",
    });
    const readBack = await collect(reopenedTransfers.read(database.db, resumed));
    expect(Buffer.compare(readBack, Buffer.concat([first, Buffer.from("ABCDEFG")]))).toBe(0);
    const states = await database.db.execute(
      sql`SELECT record_version FROM protected_envelopes WHERE entity_type = 'file.upload-state' AND entity_id = ${upload.id}`,
    );
    expect(states.rows).toHaveLength(1);
  });

  it("keeps the old acknowledged prefix after an offset conflict, overflow or interrupted source", async () => {
    const transfers = new ProtectedUploadService(runtime.files);
    const upload = await database.db.transaction((tx) =>
      transfers.create(tx, {
        workspaceId: workspaceId as import("@myownnotion/domain").Uuid,
        declaredLength: 12,
        originalName: "private partial.txt",
        mediaType: "text/plain",
      }),
    );
    await database.db.transaction((tx) =>
      transfers.append(tx, { id: upload.id, offset: 0, source: source(Buffer.from("safe")) }),
    );
    const before = await transfers.get(database.db, upload.id);
    expect(
      await database.db.transaction((tx) =>
        transfers.append(tx, {
          id: upload.id,
          offset: 0,
          source: source(Buffer.from("duplicate")),
        }),
      ),
    ).toEqual({ ok: false, reason: "offset-mismatch", expected: 4 });
    await expect(
      database.db.transaction((tx) =>
        transfers.append(tx, { id: upload.id, offset: 4, source: source(Buffer.alloc(9)) }),
      ),
    ).rejects.toThrow("exceed");
    await expect(
      database.db.transaction((tx) =>
        transfers.append(tx, {
          id: upload.id,
          offset: 4,
          source: (async function* () {
            yield Buffer.from("next");
            throw new Error("source disconnected");
          })(),
        }),
      ),
    ).rejects.toThrow("source disconnected");
    expect(await transfers.get(database.db, upload.id)).toEqual(before);
    if (before === null) throw new Error("Missing upload fixture");
    expect(await collect(transfers.read(database.db, before))).toEqual(Buffer.from("safe"));
  });

  it("reuses only authenticated byte-equal content and removes temporary duplicate ciphertext", async () => {
    const bytes = Buffer.from("deduplicated protected fixture bytes");
    const first = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(bytes), { maxBytes: 100 }),
    );
    const physicalKeys = async () =>
      (
        await Promise.all(
          (
            await readdir(root)
          ).map(async (directory) =>
            (await readdir(path.join(root, directory))).map((file) => `${directory}/${file}`),
          ),
        )
      )
        .flat()
        .sort();
    const before = await physicalKeys();
    const second = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(bytes), { maxBytes: 100 }),
    );
    expect(second.contentId).toBe(first.contentId);
    expect(second.reusedExisting).toBe(true);
    expect(await physicalKeys()).toEqual(before);
    const different = Buffer.from(bytes);
    different[0] = 120;
    const tag = await runtime.keys.fileContentLookupTag(
      database.db,
      createHash("sha256").update(different).digest(),
      different.length,
    );
    await database.db.execute(
      sql`UPDATE file_contents SET lookup_tag = ${Buffer.from(tag)} WHERE id = ${first.contentId}`,
    );
    const third = await database.db.transaction((tx) =>
      runtime.files.ingest(tx, source(different), { maxBytes: 100 }),
    );
    expect(third.contentId).not.toBe(first.contentId);
    expect(third.reusedExisting).toBe(false);
    expect(await collect(runtime.files.read(database.db, first.contentId))).toEqual(bytes);
    expect(await collect(runtime.files.read(database.db, third.contentId))).toEqual(different);
  });

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
