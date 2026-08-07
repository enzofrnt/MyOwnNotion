/**
 * Immutable blob-store contract (T019).
 *
 * File bytes are immutable once stored. Keys are opaque locators, never
 * public URLs. Later encrypted or object-backed adapters implement the same
 * interface; deduplication remains an adapter decision that must never be
 * observable in logical behavior.
 */

export interface StoredBlob {
  /** Opaque storage locator (unique per stored object). */
  readonly storageKey: string;
  /** Full SHA-256 digest of the stored bytes. */
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  /** Instant at which complete verification finished. */
  readonly verifiedAt: Date;
}

export interface BlobStore {
  /**
   * Stores bytes immutably and returns the locator plus verified digest.
   * Implementations must verify what they wrote (digest of the persisted
   * bytes) before reporting success.
   */
  put(bytes: Uint8Array): Promise<StoredBlob>;

  /** Reads the complete bytes for a locator; null when absent. */
  get(storageKey: string): Promise<Uint8Array | null>;

  /**
   * Compares stored bytes with `candidate` byte-for-byte. Used before any
   * physical reuse: digest plus length alone is never sufficient equality
   * evidence (FR-035).
   */
  equals(storageKey: string, candidate: Uint8Array): Promise<boolean>;

  /** Removes a blob (garbage collection only; never user-facing). */
  delete(storageKey: string): Promise<void>;
}
