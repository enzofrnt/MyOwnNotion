import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countProtectedFileChunksInGeneration,
  createDatabase,
  createInstallation,
  findCurrentGeneration,
  getOrCreateWorkspace,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, PROTECTED_FILE_CHUNK_BYTES, type Uuid } from "@myownnotion/domain";
import { startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { parseCommand } from "../src/admin/command-parser.ts";
import { rotationDataKeyCommand } from "../src/admin/commands/rotation-data-key.ts";
import { createProtectedFileRuntime } from "../src/files/protected-file-runtime.ts";
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";

async function* source(bytes: Uint8Array) {
  yield bytes;
}
async function expectBytes(stream: AsyncIterable<Uint8Array>, expected: Buffer) {
  const chunks: Buffer[] = [];
  for await (const bytes of stream) chunks.push(Buffer.from(bytes));
  expect(Buffer.compare(Buffer.concat(chunks), expected)).toBe(0);
}

it("resumes a failed file rotation, preserves completed and partial bytes and refuses premature revocation", async () => {
  const postgres = await startMigratedPostgres();
  const handle = createDatabase(postgres.connectionString);
  const root = await mkdtemp(join(tmpdir(), "mon-file-rotation-"));
  const key = randomBytes(32);
  const now = () => new Date();
  try {
    const installationId = generateUuidV7();
    const workspaceId = (await getOrCreateWorkspace(handle.db)).id;
    await createInstallation(handle.db, {
      id: installationId,
      sourceLineageId: installationId,
      schemaVersion: 1,
    });
    const runtime = createProtectedFileRuntime({
      db: handle.db,
      installationId,
      workspaceId,
      blobRoot: root,
      deploymentKey: () => key,
      now,
    });
    await handle.db.transaction((tx) => runtime.keys.initialize(tx));
    await handle.db.insert(schema.rotationPolicies).values({
      id: generateUuidV7(),
      installationId,
      kind: "data-key",
      mode: "scheduled",
      dueIntervalDays: 180,
      dueAt: now(),
      writeBlockAt: new Date(Date.now() + 86400000),
      currentGeneration: 1,
      state: "due",
    });
    const content = randomBytes(PROTECTED_FILE_CHUNK_BYTES + 7);
    const partial = randomBytes(PROTECTED_FILE_CHUNK_BYTES + 3);
    const stored = await handle.db.transaction((tx) =>
      runtime.files.ingest(tx, source(content), { maxBytes: content.length }),
    );
    const transfers = new ProtectedUploadService(runtime.files);
    const upload = await handle.db.transaction((tx) =>
      transfers.create(tx, {
        workspaceId: workspaceId as Uuid,
        originalName: "private rotation.txt",
        mediaType: "text/plain",
        declaredLength: partial.length + 4,
        now: now(),
      }),
    );
    await handle.db.transaction((tx) =>
      transfers.append(tx, { id: upload.id, offset: 0, source: source(partial) }),
    );
    const deps = {
      db: handle.db,
      installationId,
      workspaceId,
      deploymentKey: () => key,
      now,
      batchSize: 1,
    };
    const rotate = parseCommand(["security", "rotation", "data-key", "--yes"]);
    const revoke = parseCommand([
      "security",
      "rotation",
      "data-key",
      "--revoke-generation",
      "1",
      "--yes",
    ]);
    expect((await rotationDataKeyCommand(rotate, deps, { execute: true })).code).toBe(
      EXIT_CODES.refused,
    );
    expect((await findCurrentGeneration(handle.db, workspaceId))?.generation).toBe(1);
    const protectedDeps = { ...deps, protectedFiles: runtime.files };
    const put = runtime.blobs.put.bind(runtime.blobs);
    let calls = 0;
    const failure = vi.spyOn(runtime.blobs, "put").mockImplementation(async (bytes) => {
      if (++calls === 2) throw new Error("fixture disk interruption");
      return put(bytes);
    });
    let first: Awaited<ReturnType<typeof rotationDataKeyCommand>>;
    try {
      first = await rotationDataKeyCommand(rotate, protectedDeps, { execute: true });
      expect(first.code).toBe(EXIT_CODES.integrityFailure);
    } finally {
      failure.mockRestore();
    }
    expect(
      await countProtectedFileChunksInGeneration(handle.db, { workspaceId, keyGeneration: 1 }),
    ).toBe(3);
    await expectBytes(runtime.files.read(handle.db, stored.contentId), content);
    expect((await rotationDataKeyCommand(revoke, protectedDeps, { execute: true })).code).toBe(
      EXIT_CODES.refused,
    );
    const resumed = await rotationDataKeyCommand(rotate, protectedDeps, { execute: true });
    expect(resumed.code, resumed.message).toBe(EXIT_CODES.ok);
    expect(resumed.data?.["operationId"]).toBe(first.data?.["operationId"]);
    expect((await findCurrentGeneration(handle.db, workspaceId))?.generation).toBe(2);
    expect(
      await countProtectedFileChunksInGeneration(handle.db, { workspaceId, keyGeneration: 1 }),
    ).toBe(0);
    await expectBytes(runtime.files.read(handle.db, stored.contentId), content);
    const current = await transfers.get(handle.db, upload.id);
    if (current === null) throw new Error("Missing partial fixture");
    expect(current.receivedLength).toBe(partial.length);
    expect(current.originalName).toBe("private rotation.txt");
    await expectBytes(transfers.read(handle.db, current), partial);
    const appended = await handle.db.transaction((tx) =>
      transfers.append(tx, {
        id: upload.id,
        offset: partial.length,
        source: source(Buffer.from("tail")),
      }),
    );
    expect(appended.ok).toBe(true);
    const finished = await transfers.get(handle.db, upload.id);
    if (finished === null) throw new Error("Missing finished fixture");
    await expectBytes(
      transfers.read(handle.db, finished),
      Buffer.concat([partial, Buffer.from("tail")]),
    );
    // A key can retire between selection and SQL publication. Both ordinary
    // and batched envelope writes must reject that stale selection atomically.
    const dataKey = runtime.keys.dataKey.bind(runtime.keys);
    for (const batch of [false, true]) {
      const entityId = generateUuidV7();
      const stale = vi
        .spyOn(runtime.keys, "dataKey")
        .mockImplementationOnce(async (executor, input) => {
          const selected = await dataKey(executor, input);
          await handle.db.transaction((tx) => runtime.keys.startNextGeneration(tx));
          return selected;
        });
      try {
        const input = {
          id: generateUuidV7(),
          entityType: "item",
          entityId,
          recordVersion: 1,
          payload: Buffer.from("pending"),
        };
        await expect(
          batch
            ? runtime.records.writeNewMany(handle.db, [input])
            : runtime.records.write(handle.db, input),
        ).rejects.toThrow("generation is unavailable");
      } finally {
        stale.mockRestore();
      }
      expect(await runtime.records.read(handle.db, { entityType: "item", entityId })).toBeNull();
    }

    const reader = runtime.files.read(handle.db, stored.contentId);
    await reader.next();
    const revocation = rotationDataKeyCommand(revoke, protectedDeps, { execute: true });
    void revocation.catch(() => undefined);
    try {
      await expect
        .poll(async () => {
          const rows = await handle.db.execute<{ total: string }>(
            sql`SELECT count(*)::text AS total FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
          );
          return Number(rows.rows[0]?.total);
        })
        .toBeGreaterThan(0);
    } finally {
      await reader.return(undefined);
    }
    expect((await revocation).code).toBe(EXIT_CODES.ok);
    await expectBytes(runtime.files.read(handle.db, stored.contentId), content);
    await expectBytes(
      transfers.read(handle.db, finished),
      Buffer.concat([partial, Buffer.from("tail")]),
    );
  } finally {
    key.fill(0);
    await handle.close();
    await postgres.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
