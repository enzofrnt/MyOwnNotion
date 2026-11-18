// @vitest-environment jsdom
/** Feature 058: one local database per account on a shared browser. */
import { describe, expect, it } from "vitest";
import {
  localDatabaseNameFor,
  resolveRememberedLocalAccount,
  selectLocalAccount,
} from "../src/services/local-content.ts";

describe("local data per account", () => {
  it("names one database per account and keeps the legacy name before any", () => {
    expect(localDatabaseNameFor(null)).toBe("myownnotion-local");
    expect(localDatabaseNameFor("a")).toBe("myownnotion-local-a");
    expect(localDatabaseNameFor("a")).not.toBe(localDatabaseNameFor("b"));
  });

  it("finds the only account store when no record survived the crash", async () => {
    // The remembered id is a record, not the truth: a crash before it is written
    // leaves the account's own database as the only witness. jsdom has no
    // `databases()`, so the discovery list is supplied directly.
    const databases = globalThis.indexedDB as unknown as {
      databases?: () => Promise<{ name: string }[]>;
    };
    const original = databases.databases;
    try {
      selectLocalAccount(null);
      databases.databases = async () => [
        { name: "myownnotion-local" },
        { name: localDatabaseNameFor("account-still-here") },
      ];
      await expect(resolveRememberedLocalAccount()).resolves.toBe("account-still-here");
      // Two account stores are ambiguous: showing either could be somebody
      // else's content, so the answer is that this device knows none.
      databases.databases = async () => [
        { name: localDatabaseNameFor("account-a") },
        { name: localDatabaseNameFor("account-b") },
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
