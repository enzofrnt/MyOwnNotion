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
export const CHUNK_BYTES = 4 * 1024 * 1024;

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
  readonly installationId: string;
  readonly workspaceId: string;
  readonly contentId: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

/** The entity type every file chunk is bound under. */
const CHUNK_ENTITY_TYPE = "file.chunk";

function bindingFor(binding: ChunkBinding, chunkIndex: number): EnvelopeBinding {
  return {
    installationId: binding.installationId,
    workspaceId: binding.workspaceId,
    entityType: CHUNK_ENTITY_TYPE,
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
export function splitIntoChunks(bytes: Uint8Array): readonly Uint8Array[] {
  if (bytes.length === 0) {
    // An empty file has no chunks, and `sealEnvelope` refuses empty plaintext.
    // The caller records a zero-chunk file rather than an empty envelope.
    return [];
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    chunks.push(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length)));
  }
  return chunks;
}

export interface EncryptedChunkStoreDeps {
  readonly blobs: BlobStore;
  /** The data key for the generation in `binding`. Never stored here. */
  readonly dataKey: (generation: number) => Promise<Uint8Array>;
}

export class EncryptedChunkStore {
  readonly #deps: EncryptedChunkStoreDeps;

  constructor(deps: EncryptedChunkStoreDeps) {
    this.#deps = deps;
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
    const key = await this.#deps.dataKey(binding.keyGeneration);
    const envelopes: ChunkEnvelope[] = [];

    let chunkIndex = 0;
    for (const chunk of splitIntoChunks(bytes)) {
      const bound = bindingFor(binding, chunkIndex);
      const salt = randomSalt();
      const recordKey = deriveRecordKey(key, salt, `${CHUNK_ENTITY_TYPE}:${chunkIndex}`);
      const sealed = seal(recordKey, chunk, aadBytes(bound), randomNonce());
      const stored = await this.#deps.blobs.put(sealed.ciphertext);

      envelopes.push({
        chunkIndex,
        storageKey: stored.storageKey,
        salt: toBase64Url(salt),
        nonce: toBase64Url(sealed.nonce),
        tag: toBase64Url(sealed.tag),
        aadDigest: digestOf(aadBytes(bound)),
        byteLength: chunk.length,
        keyGeneration: binding.keyGeneration,
        recordVersion: binding.recordVersion,
      });
      chunkIndex += 1;
    }
    return envelopes;
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
    if (digestOf(aadBytes(bound)) !== envelope.aadDigest) {
      throw new EnvelopeDecryptionError();
    }

    const ciphertext = await this.#deps.blobs.get(envelope.storageKey);
    if (ciphertext === null) {
      // The metadata says there is a chunk and the store does not have it.
      // Refusing is the only honest answer; returning a short file would be
      // silent truncation.
      throw new EnvelopeDecryptionError();
    }

    const key = await this.#deps.dataKey(envelope.keyGeneration);
    const recordKey = deriveRecordKey(
      key,
      fromBase64Url(envelope.salt),
      `${CHUNK_ENTITY_TYPE}:${envelope.chunkIndex}`,
    );
    return open(
      recordKey,
      {
        nonce: fromBase64Url(envelope.nonce),
        ciphertext,
        tag: fromBase64Url(envelope.tag),
      },
      aadBytes(bound),
    );
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
