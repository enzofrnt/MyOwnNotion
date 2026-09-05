/**
 * Platform-wrapped device key custody (feature 014).
 *
 * Bytes cross this boundary only to wrap or unwrap. The CryptoKey handed to
 * the rest of the client is non-extractable. Electron stays out of this file.
 */

import type { SecureKeyStorage, StoredLocalKey } from "./secure-key-storage.ts";

export interface WrappedKeyEnvelopeRecord {
  readonly keyId: string;
  readonly algorithm: "os-protected-envelope-v1";
  readonly ciphertext: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface KeyWrapPort {
  wrap(bytes: Uint8Array): Promise<WrappedKeyEnvelopeRecord>;
  unwrap(envelope: WrappedKeyEnvelopeRecord): Promise<Uint8Array>;
}

export interface EnvelopeStore {
  load(): Promise<WrappedKeyEnvelopeRecord | null>;
  save(record: WrappedKeyEnvelopeRecord): Promise<void>;
  clear(): Promise<void>;
}

export class WrappingSecureKeyStorage implements SecureKeyStorage {
  readonly kind = "platform-secure" as const;
  readonly #wrap: KeyWrapPort;
  readonly #store: EnvelopeStore;

  constructor(wrap: KeyWrapPort, store: EnvelopeStore) {
    this.#wrap = wrap;
    this.#store = store;
  }

  async load(): Promise<StoredLocalKey | null> {
    const envelope = await this.#store.load();
    if (envelope === null || envelope.revokedAt !== null) {
      return null;
    }
    const bytes = await this.#wrap.unwrap(envelope);
    try {
      const material = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(material).set(bytes);
      try {
        const key = await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
          "encrypt",
          "decrypt",
        ]);
        return { keyId: envelope.keyId, key };
      } finally {
        new Uint8Array(material).fill(0);
      }
    } finally {
      bytes.fill(0);
    }
  }

  async save(stored: StoredLocalKey): Promise<void> {
    const existing = await this.#store.load();
    if (existing?.keyId === stored.keyId) {
      return;
    }
    throw new Error("platform-secure storage cannot persist an unwrapped device key");
  }

  async clear(): Promise<void> {
    await this.#store.clear();
  }

  async mint(): Promise<StoredLocalKey> {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const envelope = await this.#wrap.wrap(raw);
      await this.#store.save(envelope);
      const material = new ArrayBuffer(raw.byteLength);
      new Uint8Array(material).set(raw);
      try {
        const key = await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
          "encrypt",
          "decrypt",
        ]);
        return { keyId: envelope.keyId, key };
      } finally {
        new Uint8Array(material).fill(0);
      }
    } finally {
      raw.fill(0);
    }
  }
}
