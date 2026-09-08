/**
 * Desktop adapter over the shared SecureKeyStorage contract (feature 014).
 *
 * Electron is reached only through the typed preload bridge.
 */

import {
  type EnvelopeStore,
  type KeyWrapPort,
  type WrappedKeyEnvelopeRecord,
  WrappingSecureKeyStorage,
} from "@myownnotion/client-core";
import type { DesktopRuntime } from "../types/desktop-runtime.d.ts";

const DATABASE = "myownnotion-desktop-key-envelope";
const STORE = "envelope";
const RECORD = "device";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("desktop key envelope store unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("desktop key envelope transaction failed"));
    });
  } finally {
    db.close();
  }
}

class IndexedDbEnvelopeStore implements EnvelopeStore {
  async load(): Promise<WrappedKeyEnvelopeRecord | null> {
    const record = await withStore<WrappedKeyEnvelopeRecord | undefined>("readonly", (store) =>
      store.get(RECORD),
    );
    return record ?? null;
  }

  async save(record: WrappedKeyEnvelopeRecord): Promise<void> {
    await withStore("readwrite", (store) => store.put(record, RECORD));
  }

  async clear(): Promise<void> {
    await withStore("readwrite", (store) => store.delete(RECORD));
  }
}

function wrapPort(desktop: DesktopRuntime): KeyWrapPort {
  return {
    async wrap(bytes) {
      const result = await desktop.wrapDeviceKey(bytes);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.envelope;
    },
    async unwrap(envelope) {
      const result = await desktop.unwrapDeviceKey(envelope);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.bytes;
    },
  };
}

export function createDesktopKeyStorage(desktop: DesktopRuntime): WrappingSecureKeyStorage {
  return new WrappingSecureKeyStorage(wrapPort(desktop), new IndexedDbEnvelopeStore());
}
