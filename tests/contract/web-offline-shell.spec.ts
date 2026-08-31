import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("offline application routing shell", () => {
  it("serves the precached index for same-origin browser navigations", () => {
    const source = read("apps/web/src/service-worker.ts");
    expect(source).toContain("createHandlerBoundToURL");
    expect(source).toContain('createHandlerBoundToURL("/index.html")');
    expect(source).toContain("new NavigationRoute");
    expect(source).toContain("registerRoute");
  });

  it("never treats API, health, worker, or immutable asset requests as app routes", () => {
    const source = read("apps/web/src/service-worker.ts");
    const readableRegexSource = source.replaceAll("\\", "");
    for (const excludedPrefix of ["/v1", "/health", "/assets", "/service-worker.js"]) {
      expect(readableRegexSource, `missing navigation exclusion for ${excludedPrefix}`).toContain(
        excludedPrefix,
      );
    }
  });
});
