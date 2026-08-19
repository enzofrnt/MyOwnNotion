/**
 * Where the device key lives between sessions (T121, FR-012, FR-024).
 *
 * IndexedDB, holding a **non-extractable** `CryptoKey`. That combination is the
 * whole point of the file.
 *
 * A non-extractable key cannot be read back as bytes by any script, including
 * the one that created it. It can only be handed to `crypto.subtle` to encrypt
 * and decrypt. So an attacker who achieves script execution in this origin can
 * *use* the key while they are running, and cannot take a copy — the difference
 * between "they can read what they can reach right now" and "they have your
 * notes forever".
 *
 * `localStorage` would have been three lines and would have stored the key as a
 * string, which is exactly the property being avoided. There is no version of
 * this that keeps the key in `localStorage` safely.
 */

import type { SecureKeyStorage, SecureStorageKind, StoredLocalKey } from "@myownnotion/client-core";

const DATABASE = "myownnotion-device-key";
const STORE = "key";
const RECORD = "device";
const clearedListeners = new Set<() => void | Promise<void>>();

export function subscribeLocalKeyStorageCleared(listener: () => void | Promise<void>): () => void {
  clearedListeners.add(listener);
  return () => clearedListeners.delete(listener);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("device key store unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error("device key operation failed"));
    });
  } finally {
    db.close();
  }
}

export class IndexedDbKeyStorage implements SecureKeyStorage {
  // `fallback` rather than `platform-secure`: the key is out of reach of
  // script, but it is not held by an OS keychain or a hardware element, and
  // saying otherwise would overstate what a browser origin can offer.
  readonly kind: SecureStorageKind = "fallback";

  async load(): Promise<StoredLocalKey | null> {
    try {
      const record = await withStore<StoredLocalKey | undefined>("readonly", (store) =>
        store.get(RECORD),
      );
      return record ?? null;
    } catch {
      // A browser that refuses IndexedDB — private mode in some engines, a
      // wiped profile — is reported as "no key" rather than as a crash. The
      // key manager's own `lost` state is the right place for that to be
      // handled, and it already distinguishes "never had one" from "had one
      // and cannot reach it".
      return null;
    }
  }

  async save(stored: StoredLocalKey): Promise<void> {
    // Structured clone stores the `CryptoKey` itself, not a serialization of
    // it. That is what keeps a non-extractable key non-extractable across a
    // reload: the browser hands back the same opaque handle.
    await withStore("readwrite", (store) => store.put(stored, RECORD));
  }

  async clear(): Promise<void> {
    await withStore("readwrite", (store) => store.delete(RECORD));
    await Promise.all([...clearedListeners].map(async (listener) => await listener()));
  }
}
