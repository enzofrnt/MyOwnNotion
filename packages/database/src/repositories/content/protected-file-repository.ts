import { generateUuidV7, PROTECTED_FILE_CHUNK_BYTES } from "@myownnotion/domain";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { fileContents, protectedUploadChunks, uploads } from "../../schema/index.ts";
import { dataKeyGenerations, protectedBlobChunks } from "../../schema/security/index.ts";

export interface ProtectedFileScope {
  readonly installationId: string;
  readonly workspaceId: string;
  readonly kind: "content" | "upload";
  readonly id: string;
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

/** Hold through the SQL publication; retirement/revocation update this same row. */
export async function lockFileKeyGeneration(
  tx: Transaction,
  input: { workspaceId: string; generation: number; writable: boolean },
): Promise<void> {
  const [row] = await tx
    .select({ state: dataKeyGenerations.state })
    .from(dataKeyGenerations)
    .where(
      and(
        eq(dataKeyGenerations.workspaceId, input.workspaceId),
        eq(dataKeyGenerations.generation, input.generation),
      ),
    )
    .for("share");
  if (row === undefined || row.state === "revoked" || (input.writable && row.state !== "current"))
    throw new Error("The file encryption generation is unavailable.");
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
  await lockFileKeyGeneration(tx, {
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
