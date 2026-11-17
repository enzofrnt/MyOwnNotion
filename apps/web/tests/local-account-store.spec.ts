// @vitest-environment jsdom
/** Feature 058: one local database per account on a shared browser. */
import { describe, expect, it } from "vitest";
import { localDatabaseNameFor, selectLocalAccount } from "../src/services/local-content.ts";

describe("local data per account", () => {
  it("names one database per account and keeps the legacy name before any", () => {
    expect(localDatabaseNameFor(null)).toBe("myownnotion-local");
    expect(localDatabaseNameFor("a")).toBe("myownnotion-local-a");
    expect(localDatabaseNameFor("a")).not.toBe(localDatabaseNameFor("b"));
  });

  it("remembers the last account for an offline start, and forgets it on request", () => {
    selectLocalAccount("account-1");
    expect(localStorage.getItem("myownnotion-last-account")).toBe("account-1");
    selectLocalAccount(null);
    expect(localStorage.getItem("myownnotion-last-account")).toBeNull();
  });
});
