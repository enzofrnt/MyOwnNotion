import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { FileProfileStore, persistUpsert } from "../src/profile-store.ts";
import { normalizeServerUrl } from "../src/server-profile-policy.ts";

describe("desktop performance budgets", () => {
  it("normalizes a profile and IPC-shaped persistence under 50ms", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-perf-"));
    try {
      const started = performance.now();
      normalizeServerUrl("https://notes.example.org");
      persistUpsert(new FileProfileStore(path.join(dir, "p.json")), {
        serverUrl: "https://notes.example.org",
      });
      expect(performance.now() - started).toBeLessThan(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
