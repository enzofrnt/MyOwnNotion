import { describe, expect, it } from "vitest";
import { manifestMatchesHost, parseUpdateManifest } from "../src/update-manifest.ts";

const valid = {
  format: "myownnotion.desktop-update.v1",
  version: "1.2.3",
  channel: "stable",
  platform: "darwin",
  architecture: "arm64",
  artifactUrl: "https://example.invalid/releases/MyOwnNotion-1.2.3-darwin-arm64.dmg",
  artifactSha512: "a".repeat(128),
  releaseNotesUrl: "https://example.invalid/releases/1.2.3",
  minimumServerProtocol: "1",
  maximumServerProtocol: "3",
};

describe("update manifest", () => {
  it("accepts a complete HTTPS manifest", () => {
    const parsed = parseUpdateManifest(valid);
    expect(parsed.ok).toBe(true);
  });

  it("rejects HTTP artifacts, mismatched architecture, and secrets", () => {
    expect(parseUpdateManifest({ ...valid, artifactUrl: "http://example.invalid/a" }).ok).toBe(
      false,
    );
    expect(
      manifestMatchesHost(
        { ...valid, format: "myownnotion.desktop-update.v1", architecture: "x64" } as never,
        { version: "1.2.3", platform: "darwin", architecture: "arm64" },
      ).ok,
    ).toBe(false);
    expect(parseUpdateManifest({ ...valid, token: "abcdefghijklmnopqrstuvwxyz012345" }).ok).toBe(
      false,
    );
  });

  it("accepts a Linux host and refuses a Windows artefact on that host", () => {
    const linux = { ...valid, platform: "linux", architecture: "x64" };
    expect(parseUpdateManifest(linux).ok).toBe(true);
    expect(
      manifestMatchesHost({ ...linux, format: "myownnotion.desktop-update.v1" } as never, {
        version: "1.2.3",
        platform: "linux",
        architecture: "x64",
      }).ok,
    ).toBe(true);
    expect(
      manifestMatchesHost({ ...valid, format: "myownnotion.desktop-update.v1" } as never, {
        version: "1.2.3",
        platform: "linux",
        architecture: "x64",
      }).ok,
    ).toBe(false);
  });

  it("accepts Windows ARM64 and refuses macOS Intel", () => {
    expect(parseUpdateManifest({ ...valid, platform: "win32", architecture: "arm64" }).ok).toBe(
      true,
    );
    expect(parseUpdateManifest({ ...valid, platform: "darwin", architecture: "x64" }).ok).toBe(
      false,
    );
  });
});
