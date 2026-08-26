/**
 * The lifecycle of a transfer that has not finished (T046, FR-006).
 *
 * One invariant governs everything here: **the server's offset is the only
 * offset.** A client that believes it sent more than `received_length` is
 * wrong by definition, which is why the protocol has it ask (`HEAD`) rather
 * than assume. Correcting a disagreeing client silently — writing its bytes at
 * the offset the server happens to hold — produces a file that completes
 * successfully and is corrupt, which is the one outcome worth designing
 * against.
 *
 * An upload owns no item and no placement until it completes. "A partial
 * upload never appears as a complete file" is therefore a property of the
 * shape rather than a check someone has to remember to write.
 */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { uploads } from "../../schema/index.ts";

export interface UploadRecord {
  readonly id: Uuid;
  readonly declaredLength: number;
  readonly receivedLength: number;
  readonly mediaType: string;
  readonly originalName: string;
  readonly attachmentParentItemId: Uuid | null;
  readonly storageKey: string;
  readonly expiresAt: Date;
}

function toUploadRecord(row: typeof uploads.$inferSelect): UploadRecord {
  return {
    id: row.id as Uuid,
    declaredLength: row.declaredLength,
    receivedLength: row.receivedLength,
    mediaType: row.mediaType,
    originalName: row.originalName,
    attachmentParentItemId: row.attachmentParentItemId as Uuid | null,
    storageKey: row.storageKey,
    expiresAt: row.expiresAt,
  };
}

/** How long an untouched upload survives before its bytes are reclaimed. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export async function createUpload(
  executor: Database | Transaction,
  input: {
    readonly id?: Uuid;
    readonly workspaceId: Uuid;
    readonly declaredLength: number;
    readonly mediaType: string;
    readonly originalName: string;
    readonly attachmentParentItemId?: Uuid;
    readonly now?: Date;
  },
): Promise<UploadRecord> {
  const id = input.id ?? generateUuidV7();
  const now = input.now ?? new Date();
  const record = {
    id,
    workspaceId: input.workspaceId,
    declaredLength: input.declaredLength,
    receivedLength: 0,
    mediaType: input.mediaType,
    originalName: input.originalName,
    attachmentParentItemId: input.attachmentParentItemId ?? null,
    // Keyed by the upload's own identity, so two uploads of the same bytes
    // never accumulate into one another's partial file.
    storageKey: `uploads/${id}`,
    createdAt: now,
    expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
  };
  await executor.insert(uploads).values(record);
  return record;
}

export async function getUpload(
  executor: Database | Transaction,
  id: Uuid,
): Promise<UploadRecord | null> {
  const [row] = await executor.select().from(uploads).where(eq(uploads.id, id)).limit(1);
  return row === undefined ? null : toUploadRecord(row);
}

/** Serializes one upload while its bytes and durable offset are reconciled. */
export async function lockUpload(tx: Transaction, id: Uuid): Promise<UploadRecord | null> {
  const [row] = await tx.select().from(uploads).where(eq(uploads.id, id)).for("update").limit(1);
  return row === undefined ? null : toUploadRecord(row);
}

/**
 * Records the byte length observed in durable storage while the upload row is
 * locked. This may move either direction after an interrupted old or new write.
 */
export async function reconcileUploadReceivedLength(
  tx: Transaction,
  input: { readonly id: Uuid; readonly receivedLength: number },
): Promise<void> {
  await tx
    .update(uploads)
    .set({ receivedLength: input.receivedLength })
    .where(eq(uploads.id, input.id));
}

export type AdvanceOutcome =
  | { readonly ok: true; readonly receivedLength: number }
  /** The client wrote from somewhere other than where the server is. */
  | { readonly ok: false; readonly reason: "offset-mismatch"; readonly expected: number }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "overflow" };

/**
 * Records that `chunkLength` more bytes arrived at `atOffset`.
 *
 * Conditional on the offset in SQL rather than read-then-write: two `PATCH`
 * requests for one upload racing each other would otherwise both read the same
 * offset and both claim to extend it, and the second would overwrite the first
 * while reporting success.
 */
export async function advanceUpload(
  executor: Database | Transaction,
  input: { readonly id: Uuid; readonly atOffset: number; readonly chunkLength: number },
): Promise<AdvanceOutcome> {
  const current = await getUpload(executor, input.id);
  if (current === null) {
    return { ok: false, reason: "not-found" };
  }
  if (current.receivedLength !== input.atOffset) {
    // Refused, never corrected. Writing the client's bytes at the server's
    // offset would leave a gap or a duplication inside a file that then
    // completes and verifies as though nothing happened.
    return { ok: false, reason: "offset-mismatch", expected: current.receivedLength };
  }
  const next = input.atOffset + input.chunkLength;
  if (next > current.declaredLength) {
    return { ok: false, reason: "overflow" };
  }
  const updated = await executor
    .update(uploads)
    .set({ receivedLength: next })
    .where(and(eq(uploads.id, input.id), eq(uploads.receivedLength, input.atOffset)))
    .returning({ receivedLength: uploads.receivedLength });
  if (updated.length === 0) {
    // Something advanced it between the read and the write: the other request
    // won, and this one reports the mismatch rather than guessing.
    const latest = await getUpload(executor, input.id);
    return {
      ok: false,
      reason: "offset-mismatch",
      expected: latest?.receivedLength ?? input.atOffset,
    };
  }
  return { ok: true, receivedLength: next };
}

export function isComplete(record: UploadRecord): boolean {
  return record.receivedLength === record.declaredLength;
}

export async function deleteUpload(executor: Database | Transaction, id: Uuid): Promise<void> {
  await executor.delete(uploads).where(eq(uploads.id, id));
}

/**
 * Reclaims uploads nobody finished.
 *
 * Not optional housekeeping: without it an abandoned transfer occupies storage
 * that no screen accounts for, and a 2 GB abandonment is the same size as the
 * largest file the product allows.
 */
export async function expireUploads(
  executor: Database | Transaction,
  now: Date = new Date(),
): Promise<UploadRecord[]> {
  const expired = await executor.select().from(uploads).where(lt(uploads.expiresAt, now));
  if (expired.length === 0) {
    return [];
  }
  await executor.delete(uploads).where(lt(uploads.expiresAt, now));
  return expired.map(toUploadRecord);
}

/** Total bytes currently held by unfinished uploads, for diagnostics. */
export async function pendingUploadBytes(executor: Database | Transaction): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`coalesce(sum(${uploads.receivedLength}), 0)::bigint` })
    .from(uploads);
  return Number(row?.total ?? 0);
}
