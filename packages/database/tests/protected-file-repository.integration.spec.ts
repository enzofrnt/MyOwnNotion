import { randomUUID } from "node:crypto";
import {
  createInstallation,
  createUpload,
  deleteProtectedFileChunks,
  findProtectedContentCandidates,
  getUpload,
  insertGeneration,
  listProtectedFileChunks,
  lockDataKeyGeneration,
  type ProtectedChunkDescriptor,
  type ProtectedFileScope,
  putProtectedFileChunk,
  schema,
} from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
const installationId = randomUUID();
const now = new Date("2026-09-05T00:00:00Z");
beforeAll(async () => {
  context = await createIntegrationContext();
  await createInstallation(context.handle.db, {
    id: installationId,
    sourceLineageId: installationId,
    schemaVersion: 1,
  });
  await insertGeneration(context.handle.db, {
    id: randomUUID(),
    installationId,
    workspaceId: context.workspaceId,
    generation: 1,
    wrappedKeyMaterial: "repository-test-envelope",
    createdAt: now,
  });
});
afterAll(async () => {
  await context?.close();
});

function descriptor(index: number): ProtectedChunkDescriptor {
  return {
    chunkIndex: index,
    storageKey: randomUUID().replaceAll("-", "").repeat(2),
    salt: "repository-salt",
    nonce: "repository-nonce",
    tag: "repository-tag",
    aadDigest: "repository-aad",
    byteLength: 9,
    keyGeneration: 1,
    recordVersion: 1,
  };
}
function scope(kind: "content" | "upload", id: string = randomUUID()): ProtectedFileScope {
  return { installationId, workspaceId: context.workspaceId, kind, id };
}

describe("protected file references", () => {
  it("returns ordered references, atomically replaces a tail and refuses cross-scope substitution", async () => {
    const target = scope("content");
    const first = descriptor(0);
    const tail = descriptor(1);
    await context.handle.db.transaction(async (tx) => {
      await putProtectedFileChunk(tx, target, tail, now);
      await putProtectedFileChunk(tx, target, first, now);
    });
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([first, tail]);
    const replacement = { ...descriptor(1), recordVersion: 2 };
    await context.handle.db.transaction((tx) =>
      putProtectedFileChunk(tx, target, replacement, now),
    );
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([first, replacement]);
    await expect(
      context.handle.db.transaction((tx) =>
        putProtectedFileChunk(tx, { ...target, installationId: randomUUID() }, descriptor(1), now),
      ),
    ).rejects.toThrow();
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([first, replacement]);
    expect(
      await listProtectedFileChunks(context.handle.db, { ...target, workspaceId: randomUUID() }),
    ).toEqual([]);
    await context.handle.db.transaction((tx) => deleteProtectedFileChunks(tx, target));
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([]);
  });

  it("rolls back upload offset, manifest version and chunk references together", async () => {
    const upload = await createUpload(context.handle.db, {
      workspaceId: context.workspaceId,
      declaredLength: 100,
      mediaType: "application/octet-stream",
      originalName: "protected",
      storageFormat: "encrypted-chunks-v1",
      now,
    });
    expect((await getUpload(context.handle.db, upload.id))?.manifestVersion).toBe(1);
    const target = scope("upload", upload.id);
    await expect(
      context.handle.db.transaction(async (tx) => {
        await putProtectedFileChunk(tx, target, descriptor(0), now);
        await tx.execute(
          sql`UPDATE uploads SET received_length = 9, manifest_version = 2 WHERE id = ${upload.id}`,
        );
        throw new Error("interrupted before commit");
      }),
    ).rejects.toThrow("interrupted before commit");
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([]);
    expect(await getUpload(context.handle.db, upload.id)).toMatchObject({
      receivedLength: 0,
      manifestVersion: 1,
    });
    await context.handle.db.transaction((tx) =>
      putProtectedFileChunk(tx, target, descriptor(0), now),
    );
    expect(await listProtectedFileChunks(context.handle.db, target)).toHaveLength(1);
    await context.handle.db.transaction((tx) => deleteProtectedFileChunks(tx, target));
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([]);
    await expect(
      context.handle.db.transaction((tx) =>
        putProtectedFileChunk(tx, scope("upload"), descriptor(0), now),
      ),
    ).rejects.toThrow("does not belong");
  });

  it("rejects invalid references before SQL publication", async () => {
    const target = scope("content");
    const chunk = descriptor(0);
    for (const invalid of [
      { ...chunk, chunkIndex: -1 },
      { ...chunk, byteLength: 0 },
      { ...chunk, byteLength: 4194305 },
      { ...chunk, recordVersion: 0 },
      { ...chunk, keyGeneration: 0 },
      { ...chunk, storageKey: "../escape" },
    ])
      await expect(
        context.handle.db.transaction((tx) => putProtectedFileChunk(tx, target, invalid, now)),
      ).rejects.toThrow();
    expect(await listProtectedFileChunks(context.handle.db, target)).toEqual([]);
  });

  it("serializes retirement against in-flight publication and refuses later writes", async () => {
    const other = await context.handle.pool.connect();
    try {
      await other.query("SET lock_timeout = '100ms'");
      await context.handle.db.transaction(async (tx) => {
        await lockDataKeyGeneration(tx, {
          workspaceId: context.workspaceId,
          generation: 1,
          writable: true,
        });
        await expect(
          other.query(
            "UPDATE data_key_generations SET state = 'decrypt-only' WHERE workspace_id = $1",
            [context.workspaceId],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
      });
      await other.query(
        "UPDATE data_key_generations SET state = 'decrypt-only' WHERE workspace_id = $1",
        [context.workspaceId],
      );
      await expect(
        context.handle.db.transaction((tx) =>
          putProtectedFileChunk(tx, scope("content"), descriptor(0), now),
        ),
      ).rejects.toThrow("generation is unavailable");
      await context.handle.db.transaction((tx) =>
        lockDataKeyGeneration(tx, {
          workspaceId: context.workspaceId,
          generation: 1,
          writable: false,
        }),
      );
      await other.query(
        "UPDATE data_key_generations SET state = 'revoked' WHERE workspace_id = $1",
        [context.workspaceId],
      );
      await expect(
        context.handle.db.transaction((tx) =>
          lockDataKeyGeneration(tx, {
            workspaceId: context.workspaceId,
            generation: 1,
            writable: false,
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await other.query(
        "UPDATE data_key_generations SET state = 'current' WHERE workspace_id = $1",
        [context.workspaceId],
      );
      other.release();
    }
  });

  it("returns only verified private-format candidates with the exact tag and length", async () => {
    const tag = Buffer.alloc(32, 9);
    const id = randomUUID();
    await context.handle.db.insert(schema.fileContents).values([
      {
        id,
        storageFormat: "encrypted-chunks-v1",
        manifestVersion: 1,
        lookupTag: tag,
        byteLength: 9,
        verifiedAt: now,
      },
      {
        id: randomUUID(),
        storageFormat: "encrypted-chunks-v1",
        manifestVersion: 1,
        lookupTag: tag,
        byteLength: 9,
      },
      {
        id: randomUUID(),
        storageFormat: "encrypted-chunks-v1",
        manifestVersion: 1,
        lookupTag: tag,
        byteLength: 10,
        verifiedAt: now,
      },
      {
        id: randomUUID(),
        sha256: tag,
        storageKey: tag.toString("hex"),
        byteLength: 9,
        verifiedAt: now,
      },
    ]);
    expect(await findProtectedContentCandidates(context.handle.db, tag, 9)).toEqual([
      { contentId: id, manifestVersion: 1 },
    ]);
    expect(await findProtectedContentCandidates(context.handle.db, Buffer.alloc(32, 8), 9)).toEqual(
      [],
    );
    await expect(
      findProtectedContentCandidates(context.handle.db, Buffer.alloc(31), 9),
    ).rejects.toThrow();
    await expect(findProtectedContentCandidates(context.handle.db, tag, -1)).rejects.toThrow();
  });
});
