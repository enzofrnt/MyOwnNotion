import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRootFromHost } from "../src/paths.ts";
import { FileProfileStore, persistUpsert } from "../src/profile-store.ts";

describe("desktop smoke", () => {
  it("reaches a persisted workspace profile after first launch", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-smoke-"));
    try {
      const store = new FileProfileStore(path.join(dir, "profiles.json"));
      const first = persistUpsert(store, { serverUrl: "http://127.0.0.1:3001", label: "Local" });
      expect(first.result.ok).toBe(true);
      const again = new FileProfileStore(path.join(dir, "profiles.json")).loadAll();
      expect(again[0]?.serverUrl).toBe("http://127.0.0.1:3001");
      expect(again[0]?.active).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the repository root from the host layout", () => {
    expect(existsSync(path.join(repositoryRootFromHost(), "apps", "desktop", "package.json"))).toBe(
      true,
    );
  });
});
