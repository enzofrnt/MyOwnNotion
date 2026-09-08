/**
 * Device key custody and lifecycle (T058, US4, FR-012, FR-014).
 *
 * The key never leaves WebCrypto as bytes. It is generated non-extractable and
 * handed to storage as a `CryptoKey`, which structured clone can persist in
 * IndexedDB without the page ever holding the raw material — so a script that
 * reads every byte of the local database still cannot lift the key out of it.
 *
 * The states below exist because the failures are different for the person
 * looking at the screen. `locked` is temporary and reversible. `lost` means
 * this browser's copy cannot be read again by anyone, and the honest thing to
 * say is that the server copy is the way back — not to show a decryption error
 * that reads like a bug.
 */

import type { SecureKeyStorage, SecureStorageKind, StoredLocalKey } from "./secure-key-storage.ts";

export type { SecureKeyStorage, SecureStorageKind, StoredLocalKey } from "./secure-key-storage.ts";

export type LocalKeyStatus = "absent" | "unlocked" | "locked" | "lost";

export interface LocalKeyState {
  readonly status: LocalKeyStatus;
  /** Identifies the key an envelope was sealed under. Never key material. */
  readonly keyId: string | null;
}

export class LocalKeyLockedError extends Error {
  constructor() {
    super("the local device key is locked");
    this.name = "LocalKeyLockedError";
  }
}

export class LocalKeyLostError extends Error {
  constructor() {
    super("the local device key is gone; this browser copy cannot be read");
    this.name = "LocalKeyLostError";
  }
}

/**
 * In-memory custody.
 *
 * Used by tests, and as the honest fallback when no platform store is
 * available: it reports `fallback` rather than claiming a guarantee it cannot
 * provide, and the client surfaces that to the owner.
 */
export class MemorySecureStorage implements SecureKeyStorage {
  readonly kind: SecureStorageKind = "fallback";
  #stored: StoredLocalKey | null = null;

  async load(): Promise<StoredLocalKey | null> {
    return this.#stored;
  }

  async save(stored: StoredLocalKey): Promise<void> {
    this.#stored = stored;
  }

  async clear(): Promise<void> {
    this.#stored = null;
  }
}

export interface EstablishOptions {
  /**
   * Refuse to mint a replacement when nothing is stored.
   *
   * The caller uses this after records already exist locally: minting a fresh
   * key there would report a healthy `unlocked` state over a database nothing
   * can read any more.
   */
  readonly reuseExistingOnly?: boolean;
}

export class LocalKeyManager {
  readonly #storage: SecureKeyStorage;
  #stored: StoredLocalKey | null = null;
  #status: LocalKeyStatus = "absent";

  constructor(storage: SecureKeyStorage) {
    this.#storage = storage;
  }

  get storageKind(): SecureStorageKind {
    return this.#storage.kind;
  }

  get state(): LocalKeyState {
    return { status: this.#status, keyId: this.#stored?.keyId ?? null };
  }

  /** Loads the stored key, or mints one unless told to reuse only. */
  async establish(options: EstablishOptions = {}): Promise<LocalKeyState> {
    const existing = await this.#storage.load();
    if (existing !== null) {
      this.#stored = existing;
      this.#status = "unlocked";
      return this.state;
    }
    if (options.reuseExistingOnly === true) {
      this.#stored = null;
      this.#status = "lost";
      return this.state;
    }
    if (this.#storage.mint !== undefined) {
      const minted = await this.#storage.mint();
      this.#stored = minted;
      this.#status = "unlocked";
      return this.state;
    }
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const minted: StoredLocalKey = { keyId: crypto.randomUUID(), key };
    await this.#storage.save(minted);
    this.#stored = minted;
    this.#status = "unlocked";
    return this.state;
  }

  /** Drops the in-memory handle. The stored key is untouched. */
  lock(): void {
    this.#stored = null;
    this.#status = "locked";
  }

  /**
   * The key for a seal or open, or the reason it is unavailable.
   *
   * `keyId` is checked by the caller: an envelope sealed under a key this
   * device no longer holds is a loss, not a corrupt record.
   */
  requireKey(): StoredLocalKey {
    if (this.#status === "locked") {
      throw new LocalKeyLockedError();
    }
    if (this.#stored === null) {
      throw new LocalKeyLostError();
    }
    return this.#stored;
  }

  /**
   * Always rejects. Present so the guarantee is testable rather than assumed:
   * the key is generated non-extractable, so WebCrypto itself refuses.
   */
  async exportKeyBytes(): Promise<ArrayBuffer> {
    const { key } = this.requireKey();
    return await crypto.subtle.exportKey("raw", key);
  }
}
