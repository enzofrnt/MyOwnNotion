/**
 * Where a device key is held between sessions.
 *
 * The interface is deliberately free of Electron, IndexedDB, and WebCrypto
 * platform APIs so a desktop host can wrap the key in the OS store without
 * pulling those dependencies into `client-core`.
 */

export type SecureStorageKind = "platform-secure" | "fallback";

/** A device key as persisted: an opaque id and a non-extractable handle. */
export interface StoredLocalKey {
  readonly keyId: string;
  readonly key: CryptoKey;
}

export interface SecureKeyStorage {
  readonly kind: SecureStorageKind;
  load(): Promise<StoredLocalKey | null>;
  save(stored: StoredLocalKey): Promise<void>;
  clear(): Promise<void>;
  /**
   * Optional mint path for stores that must wrap extractable bytes before the
   * in-memory handle becomes non-extractable.
   */
  mint?(): Promise<StoredLocalKey>;
}
