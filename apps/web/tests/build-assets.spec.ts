import path from "node:path";
import { describe, expect, it } from "vitest";
import { requireWebAssetClasses } from "../build-assets";

const assets = [
  "assets/app-123.css",
  "assets/loro-123.wasm",
  "assets/manifest-123.webmanifest",
  "assets/search.worker-123.js",
  "assets/knowledge-graph.worker-123.js",
];

describe("web production asset validation", () => {
  it.each([path.posix, path.win32])("accepts complete native glob paths", (filesystem) => {
    expect(() =>
      requireWebAssetClasses(assets.map((asset) => filesystem.normalize(asset))),
    ).not.toThrow();
  });

  it.each(assets)("refuses a missing asset even when its source map exists: %s", (missing) => {
    const emitted = assets.filter((asset) => asset !== missing);
    emitted.push(`${missing}.map`);
    expect(() => requireWebAssetClasses(emitted)).toThrow("missing a required asset class:");
  });

  it("refuses an unbundled worker outside the expected asset directory", () => {
    expect(() =>
      requireWebAssetClasses(
        assets.map((asset) => asset.replace("assets/search", "source/search")),
      ),
    ).toThrow("search worker");
  });
});
