/**
 * Published desktop matrix (feature 014, US5, FR-013/014/016, SC-007).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectDesktopArtifactFailures,
  expectedArtifacts,
} from "../../scripts/ci/check-desktop-artifacts.ts";
import { stageDesktopArtifacts } from "../../scripts/ci/stage-desktop-artifacts.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("published desktop artefact names", () => {
  it("lists exactly nine installers across five OS/arch targets", () => {
    const artefacts = expectedArtifacts("1.2.3");
    expect(artefacts).toHaveLength(9);
    expect(artefacts.map((artifact) => artifact.fileName)).toEqual([
      "MyOwnNotion-1.2.3-win32-x64.exe",
      "MyOwnNotion-1.2.3-win32-arm64.exe",
      "MyOwnNotion-1.2.3-darwin-arm64.dmg",
      "MyOwnNotion-1.2.3-linux-x64.AppImage",
      "MyOwnNotion-1.2.3-linux-x64.deb",
      "MyOwnNotion-1.2.3-linux-x64.rpm",
      "MyOwnNotion-1.2.3-linux-arm64.AppImage",
      "MyOwnNotion-1.2.3-linux-arm64.deb",
      "MyOwnNotion-1.2.3-linux-arm64.rpm",
    ]);
  });

  it("refuses macOS Intel, stores, and extra files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-artifacts-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "MyOwnNotion-1.2.3-darwin-x64.dmg"), "no");
    writeFileSync(path.join(dir, "MyOwnNotion-1.2.3.snap"), "no");
    const failures = collectDesktopArtifactFailures(dir, "1.2.3");
    expect(failures.some((failure) => failure.includes("darwin-x64"))).toBe(true);
    expect(failures.some((failure) => failure.includes(".snap"))).toBe(true);
    expect(failures.some((failure) => failure.includes("missing artefact"))).toBe(true);
  });

  it("stages Forge output onto the canonical Linux names", () => {
    const makeDir = mkdtempSync(path.join(tmpdir(), "desktop-make-"));
    const outputDir = mkdtempSync(path.join(tmpdir(), "desktop-stage-"));
    dirs.push(makeDir, outputDir);
    mkdirSync(path.join(makeDir, "deb", "x64"), { recursive: true });
    mkdirSync(path.join(makeDir, "rpm", "x64"), { recursive: true });
    mkdirSync(path.join(makeDir, "AppImage", "x64"), { recursive: true });
    writeFileSync(path.join(makeDir, "deb", "x64", "myownnotion_1.2.3_amd64.deb"), "deb");
    writeFileSync(path.join(makeDir, "rpm", "x64", "myownnotion-1.2.3-1.x86_64.rpm"), "rpm");
    writeFileSync(path.join(makeDir, "AppImage", "x64", "MyOwnNotion-1.2.3.AppImage"), "app");
    const staged = stageDesktopArtifacts({
      makeDir,
      outputDir,
      version: "1.2.3",
      platform: "linux",
      architecture: "x64",
    });
    expect(staged.map((file) => path.basename(file)).sort()).toEqual([
      "MyOwnNotion-1.2.3-linux-x64.AppImage",
      "MyOwnNotion-1.2.3-linux-x64.deb",
      "MyOwnNotion-1.2.3-linux-x64.rpm",
    ]);
    expect(
      collectDesktopArtifactFailures(outputDir, "1.2.3", {
        platform: "linux",
        architecture: "x64",
      }),
    ).toEqual([]);
  });
});

describe("Forge and release workflows stay on the published matrix", () => {
  it("does not enable ZIP, Snap, or a universal macOS bundle", () => {
    const forge = read("apps/desktop/forge.config.ts");
    expect(forge).toContain("@reforged/maker-appimage");
    expect(forge).toContain("MakerDeb");
    expect(forge).toContain("MakerRpm");
    expect(forge).toContain("MakerSquirrel");
    expect(forge).toContain("MakerDMG");
    expect(forge).not.toContain("maker-zip");
    expect(forge).not.toContain("MakerZIP");
    expect(forge).not.toMatch(/osxUniversal\s*:\s*true/);
  });

  it("builds the five native targets and attaches nine GitHub files", () => {
    const workflow = read(".github/workflows/desktop-release.yml");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("windows-11-arm");
    expect(workflow).toContain("macos-14");
    expect(workflow).toContain("ubuntu-24.04");
    expect(workflow).toContain("ubuntu-24.04-arm");
    expect(workflow).toContain("uses: ./.github/workflows/ci.yml");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("Expected 9 canonical installers");
    expect(workflow).not.toMatch(/flathub|microsoft store|Mac App Store|osxUniversal/i);
    expect(workflow).not.toContain("actions/setup-node");
    expect(workflow).not.toContain("pnpm/action-setup");
  });
});
