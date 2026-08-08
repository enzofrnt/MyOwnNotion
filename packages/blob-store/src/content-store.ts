import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type {
  BlobRange,
  BlobSource,
  BlobStore,
  BlobWriteOptions,
  OpenedBlob,
} from "./blob-store.ts";

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
  readonly reusedExisting: boolean;
  /** True only when this ingest owns a newly created physical object. */
  readonly createdPhysicalObject: boolean;
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

  async ingest(
    source: BlobSource,
    findCandidate: CandidateLookup,
    options: BlobWriteOptions = {},
  ): Promise<ContentIngestResult> {
    const stored = await this.#blobs.put(source, options);
    const candidate = await findCandidate(stored.sha256, stored.byteLength);
    if (candidate !== null) {
      let byteEqual = candidate.storageKey === stored.storageKey;
      if (!byteEqual) {
        try {
          byteEqual = await this.#blobs.compare(candidate.storageKey, stored.storageKey);
        } catch {
          byteEqual = false;
        }
      }
      if (byteEqual) {
        if (stored.created && candidate.storageKey !== stored.storageKey) {
          await this.#blobs.delete(stored.storageKey);
        }
        return {
          contentId: candidate.contentId,
          sha256: stored.sha256,
          byteLength: stored.byteLength,
          storageKey: candidate.storageKey,
          verifiedAt: stored.verifiedAt,
          reusedExisting: true,
          createdPhysicalObject: false,
        };
      }
    }

    return {
      contentId: generateUuidV7(),
      sha256: stored.sha256,
      byteLength: stored.byteLength,
      storageKey: stored.storageKey,
      verifiedAt: stored.verifiedAt,
      reusedExisting: false,
      createdPhysicalObject: stored.created,
    };
  }

  async read(storageKey: string): Promise<Uint8Array | null> {
    return this.#blobs.get(storageKey);
  }

  async open(storageKey: string, range?: BlobRange): Promise<OpenedBlob | null> {
    return this.#blobs.open(storageKey, range);
  }

  async discardUnreferenced(content: ContentIngestResult): Promise<void> {
    if (content.createdPhysicalObject && !content.reusedExisting) {
      await this.#blobs.delete(content.storageKey);
    }
  }

  get blobStore(): BlobStore {
    return this.#blobs;
  }
}
