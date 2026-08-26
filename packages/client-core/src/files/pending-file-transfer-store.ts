/**
 * Encrypted, crash-recoverable staging for files referenced by editor blocks.
 *
 * A page may be edited for days without a network. The browser therefore has
 * to make the file bytes durable before committing the block that names them.
 * Rows in `staging` are never editor-safe and are removed at the next launch;
 * `ready` is written only after every encrypted chunk is present.
 */

import type { EnvelopeBinding, Uuid } from "@myownnotion/domain";
import { withLocalDatabaseLock } from "../coordination/cross-context-coordinator.ts";
import type { LocalDatabase } from "../local-store/schema.ts";
import {
  LOCAL_ENTITY_TYPES,
  type LocalCipher,
  type LocalEnvelope,
} from "../security/local-encryption.ts";

const MANIFEST_VERSION = 1 as const;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const FILE_STAGING_RESOURCE = "pending-file:editorial-commit";

function fileTransferResource(fileItemId: Uuid): string {
  return `pending-file:${fileItemId}:transfer`;
}

export interface PendingFileTransferEncryptionContext {
  readonly installationId: string;
  readonly workspaceId: string;
}

export interface PendingFileTransferMetadata {
  readonly fileItemId: Uuid;
  readonly attachmentParentItemId: Uuid;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly lastModified: number;
  readonly chunkBytes: number;
  readonly chunkCount: number;
  readonly createdAt: string;
}

interface PendingFileManifestPayload extends PendingFileTransferMetadata {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly status: "staging" | "ready";
}

export interface PendingFileByteSource {
  readonly fileItemId: Uuid;
  readonly attachmentParentItemId: Uuid;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly lastModified: number;
  slice(start?: number, end?: number): Promise<Blob>;
}

export type PendingFilePersistenceBoundary =
  | "manifest-written"
  | "chunk-written"
  | "before-ready"
  | "ready-written";

export class PendingFileStagingCrashError extends Error {
  readonly boundary: PendingFilePersistenceBoundary;

  constructor(boundary: PendingFilePersistenceBoundary) {
    super(`simulated process interruption after ${boundary}`);
    this.name = "PendingFileStagingCrashError";
    this.boundary = boundary;
  }
}

export interface PendingFileTransferStoreOptions {
  readonly chunkBytes?: number;
  /** Test-only process interruption hook; production never supplies one. */
  readonly onPersistenceBoundary?: (
    boundary: PendingFilePersistenceBoundary,
    chunkIndex?: number,
  ) => void | Promise<void>;
}

export type PendingFileStageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "quota" | "storage" };

export interface PendingFileRecoveryResult {
  /** Ciphertext is retained for recovery instead of being silently discarded. */
  readonly blockedFileItemIds: readonly Uuid[];
}

export interface PendingFileReadyListing {
  readonly ready: readonly PendingFileTransferMetadata[];
  /** Ready rows whose identity or authenticated ciphertext could not be verified. */
  readonly blockedFileItemIds: readonly Uuid[];
}

function chunkId(fileItemId: Uuid, chunkIndex: number): string {
  return `${fileItemId}:${chunkIndex}`;
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "QuotaExceededError" ||
      (error as { inner?: { name?: string } }).inner?.name === "QuotaExceededError")
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function immutableMetadata(metadata: PendingFileTransferMetadata): object {
  return {
    fileItemId: metadata.fileItemId,
    attachmentParentItemId: metadata.attachmentParentItemId,
    fileName: metadata.fileName,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    lastModified: metadata.lastModified,
    chunkBytes: metadata.chunkBytes,
    chunkCount: metadata.chunkCount,
    createdAt: metadata.createdAt,
  };
}

async function metadataDigest(metadata: PendingFileTransferMetadata): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(immutableMetadata(metadata))),
  );
  return bytesToHex(new Uint8Array(digest));
}

function isManifestPayload(value: unknown): value is PendingFileManifestPayload {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    row["manifestVersion"] === MANIFEST_VERSION &&
    (row["status"] === "staging" || row["status"] === "ready") &&
    typeof row["fileItemId"] === "string" &&
    typeof row["attachmentParentItemId"] === "string" &&
    typeof row["fileName"] === "string" &&
    typeof row["mediaType"] === "string" &&
    Number.isInteger(row["byteLength"]) &&
    Number(row["byteLength"]) >= 0 &&
    Number.isFinite(row["lastModified"]) &&
    Number.isInteger(row["chunkBytes"]) &&
    Number(row["chunkBytes"]) > 0 &&
    Number.isInteger(row["chunkCount"]) &&
    Number(row["chunkCount"]) >= 0 &&
    typeof row["createdAt"] === "string"
  );
}

export class PendingFileTransferStore {
  readonly #db: LocalDatabase;
  readonly #cipher: LocalCipher;
  readonly #context: PendingFileTransferEncryptionContext;
  readonly #chunkBytes: number;
  readonly #onBoundary: PendingFileTransferStoreOptions["onPersistenceBoundary"];

  constructor(
    db: LocalDatabase,
    cipher: LocalCipher,
    context: PendingFileTransferEncryptionContext,
    options: PendingFileTransferStoreOptions = {},
  ) {
    this.#db = db;
    this.#cipher = cipher;
    this.#context = context;
    this.#chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!Number.isInteger(this.#chunkBytes) || this.#chunkBytes < 1) {
      throw new TypeError("chunkBytes must be a positive integer");
    }
    this.#onBoundary = options.onPersistenceBoundary;
  }

  /**
   * Holds the cross-tab boundary from ready staging through editor commit.
   * Browser termination releases the Web Lock, allowing the next launch to
   * classify an unreferenced ready staging as abandoned.
   */
  async withEditorialCommit<T>(work: () => Promise<T>): Promise<T> {
    return withLocalDatabaseLock(this.#db, FILE_STAGING_RESOURCE, work);
  }

  /** Ensures two tabs cannot create or patch the same deterministic upload concurrently. */
  async withTransferLease<T>(fileItemId: Uuid, work: () => Promise<T>): Promise<T> {
    return withLocalDatabaseLock(this.#db, fileTransferResource(fileItemId), work);
  }

  #binding(
    entityType: string,
    entityId: string,
    recordVersion: number,
    chunkIndex?: number,
  ): EnvelopeBinding {
    return {
      ...this.#context,
      entityType,
      entityId,
      keyGeneration: 1,
      recordVersion,
      ...(chunkIndex === undefined ? {} : { chunkIndex }),
    };
  }

  async #manifestEnvelope(
    payload: PendingFileManifestPayload,
    recordVersion: number,
  ): Promise<LocalEnvelope> {
    return this.#cipher.seal(
      this.#binding(
        LOCAL_ENTITY_TYPES.pendingFileTransferManifest,
        payload.fileItemId,
        recordVersion,
      ),
      payload,
    );
  }

  async #openManifestRow(row: {
    readonly fileItemId: Uuid;
    readonly status: "staging" | "ready";
    readonly recordVersion: number;
    readonly sealedManifest: LocalEnvelope;
  }): Promise<PendingFileManifestPayload> {
    const opened = await this.#cipher.open(
      this.#binding(
        LOCAL_ENTITY_TYPES.pendingFileTransferManifest,
        row.fileItemId,
        row.recordVersion,
      ),
      row.sealedManifest,
    );
    if (!isManifestPayload(opened)) throw new TypeError("invalid pending file manifest");
    if (opened.fileItemId !== row.fileItemId || opened.status !== row.status) {
      throw new TypeError("pending file manifest routing does not match its sealed payload");
    }
    return opened;
  }

  async #chunkBinding(
    metadata: PendingFileTransferMetadata,
    chunkIndex: number,
  ): Promise<EnvelopeBinding> {
    const digest = await metadataDigest(metadata);
    return this.#binding(
      LOCAL_ENTITY_TYPES.pendingFileTransferChunk,
      `${metadata.fileItemId}.${digest}`,
      1,
      chunkIndex,
    );
  }

  async #boundary(boundary: PendingFilePersistenceBoundary, chunkIndex?: number): Promise<void> {
    await this.#onBoundary?.(boundary, chunkIndex);
  }

  /** Encrypts every byte before making the transfer eligible for a block commit. */
  async stage(input: {
    readonly fileItemId: Uuid;
    readonly attachmentParentItemId: Uuid;
    readonly file: File;
  }): Promise<PendingFileStageResult> {
    const existing = await this.#db.pendingFileTransfers.get(input.fileItemId);
    if (existing?.status === "ready") {
      const metadata = await this.#openManifestRow(existing);
      if (
        metadata.attachmentParentItemId === input.attachmentParentItemId &&
        metadata.fileName === input.file.name &&
        metadata.mediaType === input.file.type &&
        metadata.byteLength === input.file.size &&
        metadata.lastModified === input.file.lastModified
      ) {
        return { ok: true };
      }
      return { ok: false, reason: "storage" };
    }
    if (existing !== undefined) await this.remove(input.fileItemId);

    const now = new Date().toISOString();
    const metadata: PendingFileTransferMetadata = {
      fileItemId: input.fileItemId,
      attachmentParentItemId: input.attachmentParentItemId,
      fileName: input.file.name,
      mediaType: input.file.type,
      byteLength: input.file.size,
      lastModified: input.file.lastModified,
      chunkBytes: this.#chunkBytes,
      chunkCount: Math.ceil(input.file.size / this.#chunkBytes),
      createdAt: now,
    };
    const staging: PendingFileManifestPayload = {
      manifestVersion: MANIFEST_VERSION,
      status: "staging",
      ...metadata,
    };

    try {
      await this.#db.pendingFileTransfers.put({
        fileItemId: input.fileItemId,
        status: "staging",
        createdAt: now,
        updatedAt: now,
        recordVersion: 1,
        sealedManifest: await this.#manifestEnvelope(staging, 1),
      });
      await this.#boundary("manifest-written");

      for (let index = 0; index < metadata.chunkCount; index += 1) {
        const start = index * metadata.chunkBytes;
        const plaintext = new Uint8Array(
          await input.file
            .slice(start, Math.min(start + metadata.chunkBytes, input.file.size))
            .arrayBuffer(),
        );
        const sealedChunk = await this.#cipher.sealBytes(
          await this.#chunkBinding(metadata, index),
          plaintext,
        );
        await this.#db.pendingFileTransferChunks.put({
          id: chunkId(input.fileItemId, index),
          fileItemId: input.fileItemId,
          chunkIndex: index,
          recordVersion: 1,
          sealedChunk,
        });
        await this.#boundary("chunk-written", index);
      }
      await this.#boundary("before-ready");

      const ready: PendingFileManifestPayload = { ...staging, status: "ready" };
      const sealedManifest = await this.#manifestEnvelope(ready, 2);
      await this.#db.transaction(
        "rw",
        [this.#db.pendingFileTransfers, this.#db.pendingFileTransferChunks],
        async () => {
          const chunks = await this.#db.pendingFileTransferChunks
            .where("fileItemId")
            .equals(input.fileItemId)
            .sortBy("chunkIndex");
          if (
            chunks.length !== metadata.chunkCount ||
            chunks.some(({ chunkIndex }, index) => chunkIndex !== index)
          ) {
            throw new Error("pending file staging is incomplete");
          }
          await this.#db.pendingFileTransfers.put({
            fileItemId: input.fileItemId,
            status: "ready",
            createdAt: now,
            updatedAt: new Date().toISOString(),
            recordVersion: 2,
            sealedManifest,
          });
        },
      );
      await this.#boundary("ready-written");
      return { ok: true };
    } catch (error) {
      // The crash hook models a process that vanished and therefore could not
      // clean up. Every real failure is cleaned immediately.
      if (error instanceof PendingFileStagingCrashError) throw error;
      await this.remove(input.fileItemId).catch(() => undefined);
      return { ok: false, reason: isQuotaError(error) ? "quota" : "storage" };
    }
  }

  /** Removes only rows cryptographically proven to be incomplete staging. */
  async recoverIncomplete(): Promise<PendingFileRecoveryResult> {
    const manifests = await this.#db.pendingFileTransfers.toArray();
    const incompleteRows: typeof manifests = [];
    const blockedFileItemIds: Uuid[] = [];
    for (const row of manifests) {
      if (row.status !== "staging") continue;
      try {
        await this.#openManifestRow(row);
        incompleteRows.push(row);
      } catch {
        // Routing metadata is not trusted enough to delete authenticated data.
        // Keep the ciphertext so the owner can recover it or diagnose key loss.
        blockedFileItemIds.push(row.fileItemId);
      }
    }

    await this.#db.transaction(
      "rw",
      [this.#db.pendingFileTransfers, this.#db.pendingFileTransferChunks],
      async () => {
        for (const candidate of incompleteRows) {
          const current = await this.#db.pendingFileTransfers.get(candidate.fileItemId);
          // A concurrent ready commit always wins over cleanup. Record versions
          // make that decision without decrypting inside the Dexie transaction.
          if (current?.status !== "staging" || current.recordVersion !== candidate.recordVersion) {
            continue;
          }
          await this.#db.pendingFileTransfers.delete(candidate.fileItemId);
          await this.#db.pendingFileTransferChunks
            .where("fileItemId")
            .equals(candidate.fileItemId)
            .delete();
        }

        const liveManifests = await this.#db.pendingFileTransfers.toArray();
        const manifestIds = new Set(liveManifests.map(({ fileItemId }) => fileItemId));
        const orphanChunks = await this.#db.pendingFileTransferChunks
          .filter(({ fileItemId }) => !manifestIds.has(fileItemId))
          .primaryKeys();
        if (orphanChunks.length > 0) {
          await this.#db.pendingFileTransferChunks.bulkDelete(orphanChunks);
        }
      },
    );
    return { blockedFileItemIds };
  }

  /** Isolates one unreadable manifest so every other transfer can still resume. */
  async listReady(): Promise<PendingFileReadyListing> {
    const rows = await this.#db.pendingFileTransfers.where("status").equals("ready").toArray();
    const ready: PendingFileTransferMetadata[] = [];
    const blockedFileItemIds: Uuid[] = [];
    for (const row of rows) {
      try {
        const {
          manifestVersion: _version,
          status: _status,
          ...metadata
        } = await this.#openManifestRow(row);
        ready.push(metadata);
      } catch {
        blockedFileItemIds.push(row.fileItemId);
      }
    }
    return { ready, blockedFileItemIds };
  }

  async openSource(fileItemId: Uuid): Promise<PendingFileByteSource | null> {
    const row = await this.#db.pendingFileTransfers.get(fileItemId);
    if (row === undefined || row.status !== "ready") return null;
    const {
      manifestVersion: _version,
      status: _status,
      ...metadata
    } = await this.#openManifestRow(row);
    const readChunk = async (index: number): Promise<Uint8Array<ArrayBuffer>> => {
      const chunk = await this.#db.pendingFileTransferChunks.get(chunkId(fileItemId, index));
      if (chunk === undefined || chunk.chunkIndex !== index || chunk.recordVersion !== 1) {
        throw new Error("pending file chunk is missing");
      }
      const bytes = await this.#cipher.openBytes(
        await this.#chunkBinding(metadata, index),
        chunk.sealedChunk,
      );
      const expected = Math.min(
        metadata.chunkBytes,
        metadata.byteLength - index * metadata.chunkBytes,
      );
      if (bytes.byteLength !== expected) throw new Error("pending file chunk length is invalid");
      return bytes;
    };
    return {
      fileItemId,
      attachmentParentItemId: metadata.attachmentParentItemId,
      name: metadata.fileName,
      type: metadata.mediaType,
      size: metadata.byteLength,
      lastModified: metadata.lastModified,
      async slice(start = 0, end = metadata.byteLength): Promise<Blob> {
        const boundedStart = Math.max(0, Math.min(metadata.byteLength, Math.trunc(start)));
        const boundedEnd = Math.max(boundedStart, Math.min(metadata.byteLength, Math.trunc(end)));
        if (boundedStart === boundedEnd) return new Blob([], { type: metadata.mediaType });
        const first = Math.floor(boundedStart / metadata.chunkBytes);
        const last = Math.floor((boundedEnd - 1) / metadata.chunkBytes);
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for (let index = first; index <= last; index += 1) {
          const bytes = await readChunk(index);
          const from = index === first ? boundedStart - index * metadata.chunkBytes : 0;
          const to = index === last ? boundedEnd - index * metadata.chunkBytes : bytes.byteLength;
          parts.push(bytes.slice(from, to));
        }
        return new Blob(parts, { type: metadata.mediaType });
      },
    };
  }

  async loadFile(fileItemId: Uuid): Promise<File | null> {
    const source = await this.openSource(fileItemId);
    if (source === null) return null;
    return new File([await source.slice()], source.name, {
      type: source.type,
      lastModified: source.lastModified,
    });
  }

  async remove(fileItemId: Uuid): Promise<void> {
    await this.#db.transaction(
      "rw",
      [this.#db.pendingFileTransfers, this.#db.pendingFileTransferChunks],
      async () => {
        await this.#db.pendingFileTransfers.delete(fileItemId);
        await this.#db.pendingFileTransferChunks.where("fileItemId").equals(fileItemId).delete();
      },
    );
  }
}
