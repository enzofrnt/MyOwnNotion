/**
 * Immutable content ingest with cautious physical reuse (T056, US2).
 *
 * Ingest pipeline:
 * 1. Digest the incoming bytes (SHA-256 + exact length).
 * 2. Ask the registry for an already *verified* candidate with the same
 *    digest and length.
 * 3. Before reuse, compare the candidate's stored bytes byte-for-byte
 *    (FR-035). Digest, name, size, type, or preview equality is never
 *    sufficient. Verification failure falls back to storing separate
 *    content — reuse is an optimization, not a requirement.
 * 4. Otherwise store new immutable content.
 *
 * Updates are copy-on-write by construction: every ingest yields a content
 * identity; logical files repoint to new identities and never mutate bytes.
 */
import { createHash } from "node:crypto";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { BlobStore } from "./blob-store.ts";

export interface ContentCandidate {
  readonly contentId: Uuid;
  readonly storageKey: string;
}

export interface ContentIngestResult {
  readonly contentId: Uuid;
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly verifiedAt: Date;
  /** True when verified byte-equal existing content was reused physically. */
  readonly reusedExisting: boolean;
}

export type CandidateLookup = (
  sha256: Uint8Array,
  byteLength: number,
) => Promise<ContentCandidate | null>;

export class ContentStore {
  readonly #blobs: BlobStore;

  constructor(blobs: BlobStore) {
    this.#blobs = blobs;
  }

  async ingest(bytes: Uint8Array, findCandidate: CandidateLookup): Promise<ContentIngestResult> {
    const sha256 = new Uint8Array(createHash("sha256").update(bytes).digest());
    const byteLength = bytes.byteLength;

    const candidate = await findCandidate(sha256, byteLength);
    if (candidate !== null) {
      let byteEqual = false;
      try {
        byteEqual = await this.#blobs.equals(candidate.storageKey, bytes);
      } catch {
        // Verification could not be completed: store separate content.
        byteEqual = false;
      }
      if (byteEqual) {
        return {
          contentId: candidate.contentId,
          sha256,
          byteLength,
          storageKey: candidate.storageKey,
          verifiedAt: new Date(),
          reusedExisting: true,
        };
      }
    }

    const stored = await this.#blobs.put(bytes);
    return {
      contentId: generateUuidV7(),
      sha256: stored.sha256,
      byteLength: stored.byteLength,
      storageKey: stored.storageKey,
      verifiedAt: stored.verifiedAt,
      reusedExisting: false,
    };
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    return this.#blobs.get(storageKey);
  }
}
