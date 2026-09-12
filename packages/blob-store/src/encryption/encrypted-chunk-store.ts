/**
 * Encrypted file chunks (T056, feature 002).
 *
 * A file is sealed in fixed-size chunks rather than as one envelope, for three
 * reasons that all matter at the sizes a workspace actually holds:
 *
 *   - **Memory.** A 2 GB attachment must not require 2 GB of plaintext and 2 GB
 *     of ciphertext in the process at once.
 *   - **Range reads.** Serving a byte range of a video should decrypt the
 *     chunks that overlap it, not the file.
 *   - **Blast radius.** A corrupted chunk costs one chunk, and the read of that
 *     chunk refuses, rather than the whole file becoming unopenable.
 *
 * **Each chunk's index is in its AAD.** Without it, chunks could be reordered
 * or duplicated within a file and every one would still authenticate — the
 * file would decrypt to something the owner never wrote, with no error. That
 * is the single most important line in this module.
 *
 * Ciphertext is content-addressed by its own digest, so two identical chunks
 * under the same key deduplicate. They will rarely be identical, because each
 * chunk carries a fresh salt and nonce; deduplication here is a property of
 * the storage layer, not a promise about files.
 */

import { createHash } from "node:crypto";
import {
  PROTECTED_FILE_CHUNK_BYTES,
  type ProtectedFileManifest,
  readProtectedFileManifest,
} from "@myownnotion/domain";
import {
  aadBytes,
  deriveRecordKey,
  type EnvelopeBinding,
  EnvelopeDecryptionError,
  fromBase64Url,
  open,
  randomNonce,
  randomSalt,
  seal,
  toBase64Url,
} from "@myownnotion/domain/security";
import type { BlobStore } from "../blob-store.ts";

/**
 * 4 MiB, as FR-017 requires.
 *
 * Large enough that per-chunk overhead is negligible, small enough that a
 * single chunk is a comfortable buffer. Changing it changes how existing files
 * are addressed, so it is a constant rather than a parameter.
 */
export const CHUNK_BYTES = PROTECTED_FILE_CHUNK_BYTES;

/** The stored metadata for one sealed chunk. */
export interface ChunkEnvelope {
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

export interface ChunkBinding {
  readonly kind?: "content" | "upload";
  readonly installationId: string;
  readonly workspaceId: string;
  readonly contentId: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

/** The entity type every file chunk is bound under. */
function entityType(binding: ChunkBinding): string {
  return binding.kind === "upload" ? "file.upload-chunk" : "file.chunk";
}
function requireChunkSize(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > CHUNK_BYTES)
    throw new RangeError("Invalid encrypted chunk size.");
}

function bindingFor(binding: ChunkBinding, chunkIndex: number): EnvelopeBinding {
  return {
    installationId: binding.installationId,
    workspaceId: binding.workspaceId,
    entityType: entityType(binding),
    entityId: binding.contentId,
    keyGeneration: binding.keyGeneration,
    recordVersion: binding.recordVersion,
    // The field that makes reordering and duplication detectable.
    chunkIndex,
  };
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

/** Splits a payload into chunk-sized views without copying. */
export function splitIntoChunks(
  bytes: Uint8Array,
  chunkBytes: number = CHUNK_BYTES,
): readonly Uint8Array[] {
  requireChunkSize(chunkBytes);
  if (bytes.length === 0) {
    // An empty file has no chunks, and `sealEnvelope` refuses empty plaintext.
    // The caller records a zero-chunk file rather than an empty envelope.
    return [];
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    chunks.push(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)));
  }
  return chunks;
}

export interface EncryptedChunkStoreDeps {
  readonly blobs: BlobStore;
  /** Registers a key durably before its ciphertext is published. */
  readonly beforeBlobWrite?: (storageKey: string) => Promise<void>;
  /** The data key for the generation in `binding`. Never stored here. */
  readonly dataKey: (generation: number) => Promise<Uint8Array>;
  /**
   * Bytes per chunk. Defaults to the 4 MiB the requirement fixes.
   *
   * Overridable so tests can exercise multi-chunk behaviour — ordering,
   * duplication, gaps — without moving megabytes per assertion. Those
   * properties are about the chunk *index*, not the chunk size, and proving
   * them at 4 MiB a chunk cost a CI runner its heap. One test still runs at the
   * real size, and another asserts the constant itself, so the production
   * value stays pinned.
   */
  readonly chunkBytes?: number;
}

export class EncryptedChunkStore {
  readonly #deps: EncryptedChunkStoreDeps;
  readonly #chunkBytes: number;

  constructor(deps: EncryptedChunkStoreDeps) {
    this.#deps = deps;
    this.#chunkBytes = deps.chunkBytes ?? CHUNK_BYTES;
    requireChunkSize(this.#chunkBytes);
  }

  /**
   * Seals a payload and writes every chunk.
   *
   * Returns the envelopes in index order; the caller persists them. Nothing
   * about a chunk's plaintext is derivable from what is written: the storage
   * key is the digest of the *ciphertext*, so it reveals nothing about the
   * content and is stable for identical ciphertext.
   */
  async write(bytes: Uint8Array, binding: ChunkBinding): Promise<readonly ChunkEnvelope[]> {
    const envelopes: ChunkEnvelope[] = [];
    for (const [index, chunk] of splitIntoChunks(bytes, this.#chunkBytes).entries())
      envelopes.push(await this.writeChunk(chunk, binding, index));
    return envelopes;
  }

  /** Seal exactly one bounded part; never wipe key material owned by the provider. */
  async writeChunk(
    bytes: Uint8Array,
    binding: ChunkBinding,
    chunkIndex: number,
  ): Promise<ChunkEnvelope> {
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > this.#chunkBytes ||
      !Number.isSafeInteger(chunkIndex) ||
      chunkIndex < 0
    )
      throw new RangeError("Invalid encrypted chunk bounds.");
    const key = Uint8Array.from(await this.#deps.dataKey(binding.keyGeneration));
    let recordKey: Uint8Array | undefined;
    try {
      const bound = bindingFor(binding, chunkIndex);
      const salt = randomSalt();
      recordKey = deriveRecordKey(key, salt, `${entityType(binding)}:${chunkIndex}`);
      const sealed = seal(recordKey, bytes, aadBytes(bound), randomNonce());
      const stored = await this.#deps.blobs.put(
        sealed.ciphertext,
        this.#deps.beforeBlobWrite === undefined
          ? undefined
          : { beforeWrite: this.#deps.beforeBlobWrite },
      );
      return {
        chunkIndex,
        storageKey: stored.storageKey,
        salt: toBase64Url(salt),
        nonce: toBase64Url(sealed.nonce),
        tag: toBase64Url(sealed.tag),
        aadDigest: digestOf(aadBytes(bound)),
        byteLength: bytes.byteLength,
        keyGeneration: binding.keyGeneration,
        recordVersion: binding.recordVersion,
      };
    } finally {
      recordKey?.fill(0);
      key.fill(0);
    }
  }

  /** Backpressure consumes at most one next chunk; cancellation wipes pending bytes. */
  async *writeStream(
    source: AsyncIterable<Uint8Array>,
    binding: ChunkBinding,
    startIndex = 0,
  ): AsyncGenerator<ChunkEnvelope> {
    if (!Number.isSafeInteger(startIndex) || startIndex < 0)
      throw new RangeError("Invalid encrypted chunk start index.");
    const pending = new Uint8Array(this.#chunkBytes);
    let used = 0;
    let index = startIndex;
    try {
      for await (const incoming of source) {
        let offset = 0;
        while (offset < incoming.byteLength) {
          const count = Math.min(this.#chunkBytes - used, incoming.byteLength - offset);
          pending.set(incoming.subarray(offset, offset + count), used);
          used += count;
          offset += count;
          if (used === this.#chunkBytes) {
            yield await this.writeChunk(pending, binding, index++);
            pending.fill(0);
            used = 0;
          }
        }
      }
      if (used > 0) yield await this.writeChunk(pending.subarray(0, used), binding, index);
    } finally {
      pending.fill(0);
    }
  }

  /**
   * Opens one chunk.
   *
   * The AAD is rebuilt from the caller's binding and the envelope's own index,
   * never from anything stored alongside the ciphertext. A stored `aadDigest`
   * that disagrees means the row has been edited, and the mismatch is checked
   * before the tag so the cause is specific rather than a generic failure.
   */
  async readChunk(envelope: ChunkEnvelope, binding: ChunkBinding): Promise<Uint8Array> {
    const bound = bindingFor(binding, envelope.chunkIndex);
    if (
      envelope.keyGeneration !== binding.keyGeneration ||
      envelope.recordVersion !== binding.recordVersion ||
      !Number.isSafeInteger(envelope.chunkIndex) ||
      envelope.chunkIndex < 0 ||
      !Number.isSafeInteger(envelope.byteLength) ||
      envelope.byteLength <= 0 ||
      envelope.byteLength > this.#chunkBytes ||
      digestOf(aadBytes(bound)) !== envelope.aadDigest
    )
      throw new EnvelopeDecryptionError();
    const ciphertext = await this.#deps.blobs.get(envelope.storageKey);
    if (ciphertext === null || ciphertext.byteLength !== envelope.byteLength)
      throw new EnvelopeDecryptionError();
    const key = Uint8Array.from(await this.#deps.dataKey(envelope.keyGeneration));
    let recordKey: Uint8Array | undefined;
    try {
      recordKey = deriveRecordKey(
        key,
        fromBase64Url(envelope.salt),
        `${entityType(binding)}:${envelope.chunkIndex}`,
      );
      return open(
        recordKey,
        { nonce: fromBase64Url(envelope.nonce), ciphertext, tag: fromBase64Url(envelope.tag) },
        aadBytes(bound),
      );
    } finally {
      recordKey?.fill(0);
      key.fill(0);
    }
  }

  /**
   * The caller must first authenticate the manifest under its trusted binding.
   * Match SQL descriptors to that inventory before returning each opened chunk.
   * Ownership of yielded plaintext passes to the consumer; keys remain local.
   */
  async *readStream(
    envelopes: readonly ChunkEnvelope[],
    binding: ChunkBinding,
    authenticatedManifest: ProtectedFileManifest,
  ): AsyncGenerator<Uint8Array> {
    const manifest = readProtectedFileManifest(authenticatedManifest, {
      kind: binding.kind ?? "content",
      id: binding.contentId,
      recordVersion: binding.recordVersion,
    });
    if (envelopes.length !== manifest.chunks.length) throw new EnvelopeDecryptionError();
    const byIndex = new Map(envelopes.map((envelope) => [envelope.chunkIndex, envelope]));
    if (byIndex.size !== envelopes.length) throw new EnvelopeDecryptionError();
    const digest = createHash("sha256");
    for (const descriptor of manifest.chunks) {
      const envelope = byIndex.get(descriptor.index);
      if (
        envelope === undefined ||
        envelope.storageKey !== descriptor.storageKey ||
        envelope.byteLength !== descriptor.byteLength ||
        envelope.keyGeneration !== descriptor.keyGeneration ||
        envelope.recordVersion !== descriptor.recordVersion
      )
        throw new EnvelopeDecryptionError();
      const bytes = await this.readChunk(envelope, {
        ...binding,
        keyGeneration: descriptor.keyGeneration,
        recordVersion: descriptor.recordVersion,
      });
      digest.update(bytes);
      yield bytes;
    }
    if (manifest.kind === "content" && digest.digest("hex") !== manifest.sha256)
      throw new EnvelopeDecryptionError();
  }

  /**
   * Reassembles a whole file.
   *
   * The envelopes are checked for a complete, gapless, in-order index sequence
   * before anything is read. A missing chunk in the middle would otherwise
   * produce a file that is shorter than it should be but decrypts cleanly —
   * the worst kind of corruption, because nothing reports it.
   */
  async read(envelopes: readonly ChunkEnvelope[], binding: ChunkBinding): Promise<Uint8Array> {
    const ordered = [...envelopes].sort((left, right) => left.chunkIndex - right.chunkIndex);
    for (const [position, envelope] of ordered.entries()) {
      if (envelope.chunkIndex !== position) {
        throw new EnvelopeDecryptionError();
      }
    }

    const parts: Uint8Array[] = [];
    for (const envelope of ordered) {
      parts.push(await this.readChunk(envelope, binding));
    }
    return Buffer.concat(parts);
  }

  /** Removes the ciphertext for a chunk. Metadata removal is the caller's. */
  async delete(envelope: ChunkEnvelope): Promise<void> {
    await this.#deps.blobs.delete(envelope.storageKey);
  }
}
