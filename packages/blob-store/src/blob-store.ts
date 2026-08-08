/** A bounded source accepted by immutable blob adapters. */
export type BlobSource = Uint8Array | AsyncIterable<Uint8Array>;

export interface BlobWriteOptions {
  readonly maxByteLength?: number;
}

export interface BlobRange {
  readonly start: number;
  readonly endInclusive: number;
}

export interface StoredBlob {
  readonly storageKey: string;
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  readonly verifiedAt: Date;
  /** False when an already byte-equal immutable object was reused. */
  readonly created: boolean;
}

export interface BlobHead {
  readonly storageKey: string;
  readonly byteLength: number;
}

export interface OpenedBlob extends BlobHead {
  readonly contentLength: number;
  readonly range: BlobRange | null;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface BlobListOptions {
  /** Includes adapter-owned `.tmp/…` identifiers for read-only integrity audits. */
  readonly includeTemporary?: boolean;
}

export interface BlobStore {
  put(source: BlobSource, options?: BlobWriteOptions): Promise<StoredBlob>;
  /**
   * Writes verified bytes at an already-canonical key. This is restricted to
   * restore paths that must reproduce database/object identities exactly.
   */
  putVerifiedAt(
    storageKey: string,
    source: BlobSource,
    options?: BlobWriteOptions,
  ): Promise<StoredBlob>;
  head(storageKey: string): Promise<BlobHead | null>;
  open(storageKey: string, range?: BlobRange): Promise<OpenedBlob | null>;
  list(options?: BlobListOptions): Promise<string[]>;
  compare(leftStorageKey: string, rightStorageKey: string): Promise<boolean>;

  /** Compatibility helper for small callers; streaming paths use `open`. */
  get(storageKey: string): Promise<Uint8Array | null>;
  /** Compatibility helper used by cautious physical-reuse tests. */
  equals(storageKey: string, candidate: Uint8Array): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
}

export async function* blobChunks(source: BlobSource): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  for await (const value of source) {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError("blob source yielded a non-byte chunk");
    }
    yield value;
  }
}

export async function collectBlob(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Byte-for-byte equality independent of upstream chunk boundaries. */
export async function equalBlobStreams(
  left: AsyncIterable<Uint8Array>,
  right: AsyncIterable<Uint8Array>,
): Promise<boolean> {
  const leftIterator = left[Symbol.asyncIterator]();
  const rightIterator = right[Symbol.asyncIterator]();
  let leftChunk: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let rightChunk: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let leftOffset = 0;
  let rightOffset = 0;
  let leftDone = false;
  let rightDone = false;

  while (true) {
    if (leftOffset >= leftChunk.byteLength && !leftDone) {
      const next = await leftIterator.next();
      leftDone = next.done === true;
      leftChunk = next.done === true ? new Uint8Array() : next.value;
      leftOffset = 0;
    }
    if (rightOffset >= rightChunk.byteLength && !rightDone) {
      const next = await rightIterator.next();
      rightDone = next.done === true;
      rightChunk = next.done === true ? new Uint8Array() : next.value;
      rightOffset = 0;
    }

    const leftRemaining = leftChunk.byteLength - leftOffset;
    const rightRemaining = rightChunk.byteLength - rightOffset;
    if (leftDone && rightDone && leftRemaining === 0 && rightRemaining === 0) {
      return true;
    }
    if ((leftDone && leftRemaining === 0) || (rightDone && rightRemaining === 0)) {
      return false;
    }

    const comparisonLength = Math.min(leftRemaining, rightRemaining);
    for (let index = 0; index < comparisonLength; index += 1) {
      if (leftChunk[leftOffset + index] !== rightChunk[rightOffset + index]) {
        return false;
      }
    }
    leftOffset += comparisonLength;
    rightOffset += comparisonLength;
  }
}
