import {
  findProtectedFileToRotate,
  listProtectedFileChunks,
  lockDataKeyGeneration,
  lockUpload,
  putProtectedFileChunk,
  schema,
  type Transaction,
} from "@myownnotion/database";
import { and, eq, lt } from "drizzle-orm";
import { lockFullFileMaintenance } from "../backup/full/locks.ts";
import { queueProtectedFileGarbage } from "./protected-file-cleanup.ts";
import {
  type ProtectedFileService,
  ProtectedFileUnavailableError,
} from "./protected-file-service.ts";
import { ProtectedUploadService } from "./protected-upload-service.ts";

/** Rewrite at most `limit` chunks atomically; readers pin FILE until consumption. */
export async function rotateProtectedFileBatch(
  tx: Transaction,
  files: ProtectedFileService,
  fromGeneration: number,
  toGeneration: number,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Invalid file rotation batch.");
  await lockFullFileMaintenance(tx);
  await lockDataKeyGeneration(tx, {
    workspaceId: files.deps.workspaceId,
    generation: toGeneration,
    writable: true,
  });
  const object = await findProtectedFileToRotate(tx, {
    installationId: files.deps.installationId,
    workspaceId: files.deps.workspaceId,
    generation: fromGeneration,
  });
  if (object === null) return 0;
  const scope = files.scope(object.kind, object.id);
  const upload =
    object.kind === "upload"
      ? await lockUpload(tx, object.id as import("@myownnotion/domain").Uuid)
      : null;
  const manifest =
    object.kind === "content"
      ? await files.manifest(tx, object.id)
      : upload === null
        ? null
        : await new ProtectedUploadService(files).state(tx, upload);
  if (manifest === null) throw new ProtectedFileUnavailableError();
  const chunks = [...(await listProtectedFileChunks(tx, scope))];
  if (
    chunks.length !== manifest.chunks.length ||
    chunks.some((chunk, index) => {
      const trusted = manifest.chunks[index];
      return (
        trusted === undefined ||
        trusted.index !== chunk.chunkIndex ||
        trusted.storageKey !== chunk.storageKey ||
        trusted.byteLength !== chunk.byteLength ||
        trusted.keyGeneration !== chunk.keyGeneration ||
        trusted.recordVersion !== chunk.recordVersion
      );
    })
  )
    throw new ProtectedFileUnavailableError();
  const nextVersion = manifest.recordVersion + 1;
  const store = files.chunkStore(tx);
  const retired: string[] = [];
  for (let index = 0; index < chunks.length && retired.length < limit; index++) {
    const chunk = chunks[index];
    if (chunk === undefined || chunk.keyGeneration !== fromGeneration) continue;
    const binding = {
      ...scope,
      contentId: object.id,
      keyGeneration: chunk.keyGeneration,
      recordVersion: chunk.recordVersion,
    };
    const bytes = await store.readChunk(chunk, binding);
    try {
      const replacement = await store.writeChunk(
        bytes,
        {
          ...binding,
          keyGeneration: toGeneration,
          recordVersion: nextVersion,
        },
        chunk.chunkIndex,
      );
      await putProtectedFileChunk(tx, scope, replacement, files.deps.now());
      chunks[index] = replacement;
      retired.push(chunk.storageKey);
    } finally {
      bytes.fill(0);
    }
  }
  await files.deps.content.writeFileManifest(tx, {
    ...manifest,
    recordVersion: nextVersion,
    chunks: chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      byteLength: chunk.byteLength,
      storageKey: chunk.storageKey,
      keyGeneration: chunk.keyGeneration,
      recordVersion: chunk.recordVersion,
    })),
  });
  if (object.kind === "content") {
    await tx
      .update(schema.fileContents)
      .set({ manifestVersion: nextVersion })
      .where(eq(schema.fileContents.id, object.id));
  } else {
    await tx
      .update(schema.uploads)
      .set({ manifestVersion: nextVersion })
      .where(eq(schema.uploads.id, object.id));
  }
  await tx
    .delete(schema.protectedEnvelopes)
    .where(
      and(
        eq(schema.protectedEnvelopes.workspaceId, scope.workspaceId),
        eq(
          schema.protectedEnvelopes.entityType,
          object.kind === "content" ? "file.content-manifest" : "file.upload-state",
        ),
        eq(schema.protectedEnvelopes.entityId, object.id),
        lt(schema.protectedEnvelopes.recordVersion, nextVersion),
      ),
    );
  await queueProtectedFileGarbage(tx, scope.workspaceId, retired);
  return retired.length;
}
