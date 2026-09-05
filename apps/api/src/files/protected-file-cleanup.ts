import {
  type Database,
  listProtectedFileChunks,
  schema,
  type Transaction,
} from "@myownnotion/database";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { lockFullFileMaintenance, shareFullBlobDeletion } from "../backup/full/locks.ts";
import type { ProtectedFileService } from "./protected-file-service.ts";

export async function queueProtectedFileGarbage(
  tx: Transaction,
  workspaceId: string,
  storageKeys: readonly string[],
): Promise<void> {
  if (storageKeys.length === 0) return;
  await tx
    .insert(schema.protectedFileGarbage)
    .values(storageKeys.map((storageKey) => ({ storageKey, workspaceId })))
    .onConflictDoNothing();
}

/** Removing the transfer and queuing its ciphertext commit together. */
export async function retireProtectedUpload(
  tx: Transaction,
  files: ProtectedFileService,
  id: string,
): Promise<void> {
  const chunks = await listProtectedFileChunks(tx, files.scope("upload", id));
  await queueProtectedFileGarbage(
    tx,
    files.deps.workspaceId,
    chunks.map((chunk) => chunk.storageKey),
  );
  await tx
    .delete(schema.protectedEnvelopes)
    .where(
      and(
        eq(schema.protectedEnvelopes.workspaceId, files.deps.workspaceId),
        eq(schema.protectedEnvelopes.entityId, id),
        inArray(schema.protectedEnvelopes.entityType, [
          "file.upload-metadata",
          "file.upload-state",
        ]),
      ),
    );
  await tx
    .delete(schema.uploads)
    .where(and(eq(schema.uploads.id, id), eq(schema.uploads.workspaceId, files.deps.workspaceId)));
}

/** Bounded, retryable housekeeping; never discovers/deletes unclassified legacy orphans. */
export async function cleanupProtectedFiles(
  db: Database,
  files: ProtectedFileService,
  now = new Date(),
): Promise<{ expired: number; deleted: number }> {
  const expired = await db.transaction(async (tx) => {
    await lockFullFileMaintenance(tx);
    const expired = await tx
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(
        and(
          eq(schema.uploads.workspaceId, files.deps.workspaceId),
          eq(schema.uploads.storageFormat, "encrypted-chunks-v1"),
          lt(schema.uploads.expiresAt, now),
        ),
      )
      .limit(32)
      .for("update");
    for (const row of expired) await retireProtectedUpload(tx, files, row.id);
    return expired.length;
  });
  // Retirement must commit first: rolling back a later physical deletion must
  // never resurrect an upload whose ciphertext has already been removed.
  return db.transaction(async (tx) => {
    await lockFullFileMaintenance(tx);
    await shareFullBlobDeletion(tx);
    const candidates = await tx
      .select()
      .from(schema.protectedFileGarbage)
      .where(eq(schema.protectedFileGarbage.workspaceId, files.deps.workspaceId))
      .limit(64)
      .for("update");
    let deleted = 0;
    for (const { storageKey } of candidates) {
      const references = await tx.execute<{ present: boolean }>(sql`SELECT
        EXISTS (SELECT 1 FROM protected_blob_chunks WHERE storage_key = ${storageKey}) OR
        EXISTS (SELECT 1 FROM protected_upload_chunks WHERE storage_key = ${storageKey}) OR
        EXISTS (SELECT 1 FROM protected_file_quarantine WHERE storage_key = ${storageKey}) OR
        EXISTS (SELECT 1 FROM file_contents WHERE storage_key = ${storageKey}) AS present`);
      const referenced = references.rows[0]?.present;
      if (referenced === undefined) throw new Error("File references could not be verified.");
      if (!referenced) {
        await files.deps.blobs.delete(storageKey);
        deleted++;
      }
      await tx
        .delete(schema.protectedFileGarbage)
        .where(eq(schema.protectedFileGarbage.storageKey, storageKey));
    }
    return { expired, deleted };
  });
}

export function startProtectedFileCleanup(input: {
  db: Database;
  files: ProtectedFileService;
  now: () => Date;
  reportFailure: (error: unknown) => void;
}): () => Promise<void> {
  let pending: Promise<unknown> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || pending !== undefined) return;
    pending = cleanupProtectedFiles(input.db, input.files, input.now())
      .catch(input.reportFailure)
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(run, 60_000);
  timer.unref();
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
