import { createHash } from "node:crypto";
import { type BlobStore, EncryptedChunkStore } from "@myownnotion/blob-store";
import {
  type Database,
  findProtectedContentCandidates,
  listProtectedFileChunks,
  lockDataKeyGeneration,
  type ProtectedChunkDescriptor,
  putProtectedFileChunk,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  generateUuidV7,
  PROTECTED_FILE_CHUNK_BYTES,
  type ProtectedFileManifest,
  type Uuid,
} from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import {
  lockFullFileMaintenance,
  shareFullBlobDeletion,
  shareFullFileMutation,
} from "../backup/full/locks.ts";
import type { KeyHierarchy } from "../security/key-hierarchy.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { FileByteRange } from "./file-range.ts";
import { pinnedFileRead } from "./pinned-file-read.ts";

export interface ProtectedStoredContent {
  readonly contentId: Uuid;
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  readonly verifiedAt: Date;
  readonly reusedExisting: boolean;
  readonly storageFormat: "encrypted-chunks-v1";
  readonly manifestVersion: number;
}

export class ProtectedFileUnavailableError extends Error {
  constructor() {
    super("Protected file content is unavailable.");
  }
}

export interface ProtectedFileServiceDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly blobs: BlobStore;
  readonly keys: KeyHierarchy;
  readonly content: ProtectedContent;
  readonly now: () => Date;
}

/** SQL orchestration around the existing encryption hierarchy and bounded blob primitives. */
export class ProtectedFileService {
  constructor(readonly deps: ProtectedFileServiceDeps) {}

  chunkStore(executor: Database | Transaction): EncryptedChunkStore {
    return new EncryptedChunkStore({
      blobs: this.deps.blobs,
      beforeBlobWrite: (storageKey) => this.registerBlobWriteIntent(storageKey),
      dataKey: async (generation) =>
        (await this.deps.keys.dataKey(executor, { generation, writable: false })).material,
    });
  }

  private async registerBlobWriteIntent(storageKey: string): Promise<void> {
    await this.deps.db
      .insert(schema.protectedFileGarbage)
      .values({ storageKey, workspaceId: this.deps.workspaceId, createdAt: this.deps.now() })
      .onConflictDoNothing();
  }

  /** A canonical row in the surrounding transaction now owns this ciphertext. */
  async acknowledgeBlobWrite(tx: Transaction, storageKey: string): Promise<void> {
    await tx
      .delete(schema.protectedFileGarbage)
      .where(
        and(
          eq(schema.protectedFileGarbage.storageKey, storageKey),
          eq(schema.protectedFileGarbage.workspaceId, this.deps.workspaceId),
        ),
      );
  }

  scope(kind: "content" | "upload", id: string) {
    return {
      installationId: this.deps.installationId,
      workspaceId: this.deps.workspaceId,
      kind,
      id,
    };
  }

  /** One-shot input: callers must not automatically replay this transaction's source stream. */
  async ingest(
    tx: Transaction,
    source: AsyncIterable<Uint8Array>,
    options: { maxBytes: number; expectedLength?: number; contentId?: Uuid },
  ): Promise<ProtectedStoredContent> {
    return this.ingestContent(tx, source, options);
  }

  /** Transition only: preserve a referenced legacy identity and verify its original digest. */
  async protectLegacyContent(
    tx: Transaction,
    contentId: Uuid,
    source: AsyncIterable<Uint8Array>,
  ): Promise<ProtectedStoredContent> {
    await lockFullFileMaintenance(tx);
    const [legacy] = await tx
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, contentId))
      .for("update")
      .limit(1);
    if (legacy === undefined || legacy.storageFormat !== "legacy-v1" || legacy.sha256 === null)
      throw new ProtectedFileUnavailableError();
    return this.ingestContent(
      tx,
      source,
      {
        contentId,
        maxBytes: legacy.byteLength,
        expectedLength: legacy.byteLength,
      },
      legacy.sha256,
    );
  }

  private async ingestContent(
    tx: Transaction,
    source: AsyncIterable<Uint8Array>,
    options: { maxBytes: number; expectedLength?: number; contentId?: Uuid },
    legacyDigest?: Uint8Array,
  ): Promise<ProtectedStoredContent> {
    if (
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 0 ||
      (options.expectedLength !== undefined &&
        (!Number.isSafeInteger(options.expectedLength) ||
          options.expectedLength < 0 ||
          options.expectedLength > options.maxBytes))
    )
      throw new RangeError("Invalid protected file length limit.");
    await shareFullFileMutation(tx);
    const dataKey = await this.deps.keys.dataKey(tx, { writable: true });
    await lockDataKeyGeneration(tx, {
      workspaceId: this.deps.workspaceId,
      generation: dataKey.generation,
      writable: true,
    });
    const contentId = options.contentId ?? generateUuidV7();
    const scope = this.scope("content", contentId);
    const binding = { ...scope, contentId, keyGeneration: dataKey.generation, recordVersion: 1 };
    const digest = createHash("sha256");
    let byteLength = 0;
    const bounded = (async function* () {
      for await (const bytes of source) {
        byteLength += bytes.byteLength;
        if (!Number.isSafeInteger(byteLength) || byteLength > options.maxBytes)
          throw new RangeError("The file exceeds the permitted length.");
        digest.update(bytes);
        yield bytes;
      }
    })();
    const chunks: ProtectedChunkDescriptor[] = [];
    for await (const chunk of this.chunkStore(tx).writeStream(bounded, binding)) chunks.push(chunk);
    if (options.expectedLength !== undefined && byteLength !== options.expectedLength)
      throw new Error("The file stream did not match its declared length.");
    const sha256 = new Uint8Array(digest.digest());
    if (legacyDigest !== undefined && !Buffer.from(sha256).equals(legacyDigest))
      throw new ProtectedFileUnavailableError();
    const lookupTag = await this.deps.keys.fileContentLookupTag(tx, sha256, byteLength);
    const verifiedAt = this.deps.now();
    // A keyed digest narrows candidates; only an authenticated byte comparison permits reuse.
    const candidates =
      legacyDigest === undefined && options.contentId === undefined
        ? await findProtectedContentCandidates(tx, lookupTag, byteLength)
        : [];
    for (const candidate of candidates) {
      let equal = true;
      let index = 0;
      try {
        for await (const existing of this.read(tx, candidate.contentId)) {
          const incoming = chunks[index++];
          if (
            incoming === undefined ||
            Buffer.compare(existing, await this.chunkStore(tx).readChunk(incoming, binding)) !== 0
          ) {
            equal = false;
            break;
          }
        }
        equal = equal && index === chunks.length;
      } catch {
        equal = false;
      }
      if (!equal) continue;
      await shareFullBlobDeletion(tx);
      for (const chunk of chunks) await this.deps.blobs.delete(chunk.storageKey);
      for (const chunk of chunks) await this.acknowledgeBlobWrite(tx, chunk.storageKey);
      return {
        contentId: candidate.contentId as Uuid,
        sha256,
        byteLength,
        verifiedAt,
        reusedExisting: true,
        storageFormat: "encrypted-chunks-v1",
        manifestVersion: candidate.manifestVersion,
      };
    }
    const manifest: ProtectedFileManifest = {
      format: "myownnotion.protected-file",
      formatVersion: 1,
      kind: "content",
      id: contentId,
      recordVersion: 1,
      byteLength,
      sha256: Buffer.from(sha256).toString("hex"),
      chunks: chunks.map((chunk) => ({
        index: chunk.chunkIndex,
        byteLength: chunk.byteLength,
        storageKey: chunk.storageKey,
        keyGeneration: chunk.keyGeneration,
        recordVersion: chunk.recordVersion,
      })),
    };
    const protectedValues = {
      storageFormat: "encrypted-chunks-v1" as const,
      manifestVersion: 1,
      lookupTag,
      byteLength,
      verifiedAt,
    };
    if (legacyDigest === undefined) {
      await tx.insert(schema.fileContents).values({
        id: contentId,
        ...protectedValues,
        referenceCount: 0,
      });
    } else {
      await tx
        .update(schema.fileContents)
        .set({
          ...protectedValues,
          sha256: null,
          storageKey: null,
        })
        .where(eq(schema.fileContents.id, contentId));
    }
    for (const chunk of chunks) {
      await putProtectedFileChunk(tx, scope, chunk, verifiedAt);
      await this.acknowledgeBlobWrite(tx, chunk.storageKey);
    }
    await this.deps.content.writeFileManifest(tx, manifest);
    return {
      contentId,
      sha256,
      byteLength,
      verifiedAt,
      reusedExisting: false,
      storageFormat: "encrypted-chunks-v1",
      manifestVersion: 1,
    };
  }

  async manifest(
    executor: Database | Transaction,
    contentId: string,
  ): Promise<ProtectedFileManifest & { kind: "content" }> {
    const [row] = await executor
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, contentId))
      .limit(1);
    if (row === undefined || row.verifiedAt === null || row.storageFormat !== "encrypted-chunks-v1")
      throw new ProtectedFileUnavailableError();
    const manifest = await this.deps.content.readFileManifest(executor, {
      kind: "content",
      id: contentId,
      recordVersion: row.manifestVersion,
    });
    if (manifest === null || manifest.kind !== "content" || manifest.byteLength !== row.byteLength)
      throw new ProtectedFileUnavailableError();
    return manifest;
  }

  async *read(
    executor: Database | Transaction,
    contentId: string,
    range?: FileByteRange,
  ): AsyncGenerator<Uint8Array> {
    yield* pinnedFileRead(executor, (tx) => this.readPinned(tx, contentId, range));
  }

  private async *readPinned(
    executor: Transaction,
    contentId: string,
    range?: FileByteRange,
  ): AsyncGenerator<Uint8Array> {
    const manifest = await this.manifest(executor, contentId);
    const chunks = await listProtectedFileChunks(executor, this.scope("content", contentId));
    if (range !== undefined) {
      if (
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start ||
        range.end >= manifest.byteLength ||
        chunks.length !== manifest.chunks.length
      )
        throw new ProtectedFileUnavailableError();
      const first = Math.floor(range.start / PROTECTED_FILE_CHUNK_BYTES);
      const last = Math.floor(range.end / PROTECTED_FILE_CHUNK_BYTES);
      for (let index = first; index <= last; index++) {
        const chunk = chunks[index];
        const trusted = manifest.chunks[index];
        if (
          chunk === undefined ||
          trusted === undefined ||
          chunk.chunkIndex !== trusted.index ||
          chunk.storageKey !== trusted.storageKey ||
          chunk.byteLength !== trusted.byteLength ||
          chunk.keyGeneration !== trusted.keyGeneration ||
          chunk.recordVersion !== trusted.recordVersion
        )
          throw new ProtectedFileUnavailableError();
        const bytes = await this.chunkStore(executor).readChunk(chunk, {
          installationId: this.deps.installationId,
          workspaceId: this.deps.workspaceId,
          contentId,
          keyGeneration: chunk.keyGeneration,
          recordVersion: chunk.recordVersion,
        });
        const offset = index * PROTECTED_FILE_CHUNK_BYTES;
        yield bytes.subarray(
          Math.max(0, range.start - offset),
          Math.min(bytes.length, range.end - offset + 1),
        );
      }
      return;
    }
    yield* this.chunkStore(executor).readStream(
      chunks,
      {
        installationId: this.deps.installationId,
        workspaceId: this.deps.workspaceId,
        contentId,
        keyGeneration: chunks[0]?.keyGeneration ?? 1,
        recordVersion: manifest.recordVersion,
      },
      manifest,
    );
  }
}
