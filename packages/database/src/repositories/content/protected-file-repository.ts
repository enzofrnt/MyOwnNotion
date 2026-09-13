import { generateUuidV7, PROTECTED_FILE_CHUNK_BYTES } from "@myownnotion/domain";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { fileContents, protectedUploadChunks, uploads } from "../../schema/index.ts";
import { protectedBlobChunks } from "../../schema/security/index.ts";
import { lockDataKeyGeneration } from "../security/key-repository.ts";

export interface ProtectedFileScope {
  readonly installationId: string;
  readonly workspaceId: string;
  readonly kind: "content" | "upload";
  readonly id: string;
}

export async function countProtectedFileChunksInGeneration(
  executor: Database | Transaction,
  input: { workspaceId: string; keyGeneration: number },
): Promise<number> {
  const result = await executor.execute<{ total: string }>(sql`
    SELECT (
      (SELECT count(*) FROM protected_blob_chunks
       WHERE workspace_id = ${input.workspaceId} AND key_generation = ${input.keyGeneration}) +
      (SELECT count(*) FROM protected_upload_chunks
       WHERE workspace_id = ${input.workspaceId} AND key_generation = ${input.keyGeneration})
    )::text AS total
  `);
  return Number(result.rows[0]?.total ?? 0);
}

/** One object per bounded rotation transaction; committed references are its restart cursor. */
export async function findProtectedFileToRotate(
  tx: Transaction,
  input: { installationId: string; workspaceId: string; generation: number },
): Promise<{ kind: "content" | "upload"; id: string } | null> {
  const result = await tx.execute<{ kind: "content" | "upload"; id: string }>(sql`
    SELECT 'content' AS kind, content_id AS id FROM protected_blob_chunks
      WHERE installation_id = ${input.installationId} AND workspace_id = ${input.workspaceId}
        AND key_generation = ${input.generation}
    UNION
    SELECT 'upload' AS kind, upload_id AS id FROM protected_upload_chunks
      WHERE installation_id = ${input.installationId} AND workspace_id = ${input.workspaceId}
        AND key_generation = ${input.generation}
    ORDER BY kind, id LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export interface ProtectedChunkDescriptor {
  readonly chunkIndex: number;
  readonly storageKey: string;
  readonly salt: string;
  readonly nonce: string;
  readonly tag: string;
  readonly aadDigest: string;
  readonly byteLength: number;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

function chunkTable(scope: ProtectedFileScope) {
  return scope.kind === "content" ? protectedBlobChunks : protectedUploadChunks;
}

function chunkScope(scope: ProtectedFileScope) {
  const table = chunkTable(scope);
  const objectId =
    scope.kind === "content" ? protectedBlobChunks.contentId : protectedUploadChunks.uploadId;
  return sql`${table.installationId} = ${scope.installationId}
    AND ${table.workspaceId} = ${scope.workspaceId} AND ${objectId} = ${scope.id}`;
}

export async function listProtectedFileChunks(
  executor: Database | Transaction,
  scope: ProtectedFileScope,
): Promise<readonly ProtectedChunkDescriptor[]> {
  const table = chunkTable(scope);
  return await executor
    .select({
      chunkIndex: table.chunkIndex,
      storageKey: table.storageKey,
      salt: table.salt,
      nonce: table.nonce,
      tag: table.tag,
      aadDigest: table.aadDigest,
      byteLength: table.byteLength,
      keyGeneration: table.keyGeneration,
      recordVersion: table.recordVersion,
    })
    .from(table)
    .where(chunkScope(scope))
    .orderBy(asc(table.chunkIndex));
}

/** The caller has already durably sealed the bytes and locks the content/upload row. */
export async function putProtectedFileChunk(
  tx: Transaction,
  scope: ProtectedFileScope,
  chunk: ProtectedChunkDescriptor,
  now: Date,
): Promise<void> {
  if (
    !Number.isSafeInteger(chunk.chunkIndex) ||
    chunk.chunkIndex < 0 ||
    !Number.isSafeInteger(chunk.byteLength) ||
    chunk.byteLength <= 0 ||
    chunk.byteLength > PROTECTED_FILE_CHUNK_BYTES ||
    !Number.isInteger(chunk.keyGeneration) ||
    chunk.keyGeneration < 1 ||
    !Number.isInteger(chunk.recordVersion) ||
    chunk.recordVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(chunk.storageKey)
  )
    throw new Error("Invalid protected file chunk reference.");
  await lockDataKeyGeneration(tx, {
    workspaceId: scope.workspaceId,
    generation: chunk.keyGeneration,
    writable: true,
  });
  const row = {
    ...chunk,
    installationId: scope.installationId,
    workspaceId: scope.workspaceId,
    createdAt: now,
  };
  let updated: readonly { id: string }[];
  if (scope.kind === "content") {
    updated = await tx
      .insert(protectedBlobChunks)
      .values({ ...row, id: generateUuidV7(), contentId: scope.id })
      .onConflictDoUpdate({
        target: [protectedBlobChunks.contentId, protectedBlobChunks.chunkIndex],
        set: row,
        setWhere: chunkScope(scope),
      })
      .returning({ id: protectedBlobChunks.id });
  } else {
    const [upload] = await tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.id, scope.id), eq(uploads.workspaceId, scope.workspaceId)));
    if (upload === undefined)
      throw new Error("The protected upload does not belong to this workspace.");
    updated = await tx
      .insert(protectedUploadChunks)
      .values({ ...row, id: generateUuidV7(), uploadId: scope.id })
      .onConflictDoUpdate({
        target: [protectedUploadChunks.uploadId, protectedUploadChunks.chunkIndex],
        set: row,
        setWhere: chunkScope(scope),
      })
      .returning({ id: protectedUploadChunks.id });
  }
  if (updated.length !== 1) throw new Error("The protected chunk belongs to another scope.");
}

/** Row deletion and its manifest/offset change belong in the same transaction. */
export async function deleteProtectedFileChunks(
  tx: Transaction,
  scope: ProtectedFileScope,
): Promise<void> {
  await tx.delete(chunkTable(scope)).where(chunkScope(scope));
}

/** Candidates are only a private lookup hint; the caller must authenticate and compare bytes. */
export async function findProtectedContentCandidates(
  executor: Database | Transaction,
  lookupTag: Uint8Array,
  byteLength: number,
): Promise<readonly { contentId: string; manifestVersion: number }[]> {
  if (lookupTag.byteLength !== 32 || !Number.isSafeInteger(byteLength) || byteLength < 0)
    throw new Error("Invalid protected content candidate identity.");
  return await executor
    .select({ contentId: fileContents.id, manifestVersion: fileContents.manifestVersion })
    .from(fileContents)
    .where(
      and(
        eq(fileContents.storageFormat, "encrypted-chunks-v1"),
        eq(fileContents.lookupTag, lookupTag),
        eq(fileContents.byteLength, byteLength),
        isNotNull(fileContents.verifiedAt),
      ),
    )
    .orderBy(asc(fileContents.id))
    .limit(32);
}
