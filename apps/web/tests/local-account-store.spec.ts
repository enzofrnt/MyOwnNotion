// @vitest-environment jsdom
/** Feature 058: one local database per account on a shared browser. */
import { describe, expect, it } from "vitest";
import {
  localDatabaseNameFor,
  resolveRememberedLocalAccount,
  selectLocalAccount,
} from "../src/services/local-content.ts";

/**
 * Empties the durable registry the boot reads before falling back to discovery.
 *
 * The registry write is fire-and-forget by design, so a test cannot rely on a
 * previous `selectLocalAccount(null)` having landed before the assertion.
 */
async function clearDurableRegistry(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("myownnotion-local-accounts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("meta");
    request.onerror = () => reject(request.error ?? new Error("registry unavailable"));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("meta", "readwrite");
      transaction.objectStore("meta").delete("last-account");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("registry clear failed"));
      };
    };
  });
}

describe("local data per account", () => {
  it("names one database per account and keeps the legacy name before any", () => {
    expect(localDatabaseNameFor(null)).toBe("myownnotion-local");
    expect(localDatabaseNameFor("a")).toBe("myownnotion-local-a");
    expect(localDatabaseNameFor("a")).not.toBe(localDatabaseNameFor("b"));
  });

  it("finds the only account store when no record survived the crash", async () => {
    // The remembered id is a record, not the truth: a crash before it is written
    // leaves the account's own database as the only witness. Account ids are
    // UUIDs, and the registry (`myownnotion-local-accounts`) shares the prefix,
    // so it must never be counted as an account store.
    const databases = globalThis.indexedDB as unknown as {
      databases?: () => Promise<{ name: string }[]>;
    };
    const original = databases.databases;
    const account = "2c02d1de-44ad-4c34-958c-68d673efe1e1";
    try {
      selectLocalAccount(null);
      await clearDurableRegistry();
      databases.databases = async () => [
        { name: "myownnotion-local" },
        { name: "myownnotion-local-accounts" },
        { name: localDatabaseNameFor(account) },
      ];
      await expect(resolveRememberedLocalAccount()).resolves.toBe(account);
      // Two account stores are ambiguous: showing either could be somebody
      // else's content, so the answer is that this device knows none.
      databases.databases = async () => [
        { name: "myownnotion-local-accounts" },
        { name: localDatabaseNameFor("8f14e45f-ceea-467a-9d4b-2c1c2a3f0a11") },
        { name: localDatabaseNameFor(account) },
      ];
      await expect(resolveRememberedLocalAccount()).resolves.toBeNull();
    } finally {
      if (original === undefined) delete databases.databases;
      else databases.databases = original;
    }
  });

  it("remembers the last account for an offline start, and forgets it on request", () => {
    selectLocalAccount("account-1");
    expect(localStorage.getItem("myownnotion-last-account")).toBe("account-1");
    selectLocalAccount(null);
    expect(localStorage.getItem("myownnotion-last-account")).toBeNull();
  });
});
