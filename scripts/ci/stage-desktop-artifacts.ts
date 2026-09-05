/**
 * Copy Forge maker output to the canonical published filenames (feature 014).
 */
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  type ArtifactFilter,
  expectedArtifactsFor,
  sha512File,
} from "./check-desktop-artifacts.ts";

export interface StageRequest {
  readonly makeDir: string;
  readonly outputDir: string;
  readonly version: string;
  readonly platform: "win32" | "darwin" | "linux";
  readonly architecture: "x64" | "arm64";
}

function listFilesRecursive(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      collected.push(...listFilesRecursive(full));
    } else {
      collected.push(full);
    }
  }
  return collected;
}

function extensionFor(fileName: string): string {
  if (fileName.endsWith(".AppImage")) {
    return ".AppImage";
  }
  return path.extname(fileName);
}

function isInstaller(filePath: string, platform: StageRequest["platform"]): boolean {
  const name = path.basename(filePath);
  const lower = name.toLowerCase();
  if (lower === "releases" || lower.endsWith(".nupkg") || lower.endsWith(".delta")) {
    return false;
  }
  const extension = extensionFor(name);
  if (platform === "win32") {
    return extension === ".exe";
  }
  if (platform === "darwin") {
    return extension === ".dmg";
  }
  return extension === ".AppImage" || extension === ".deb" || extension === ".rpm";
}

function pickInstaller(files: readonly string[], expectedExtension: string): string | undefined {
  const matches = files.filter((file) => extensionFor(path.basename(file)) === expectedExtension);
  if (matches.length === 0) {
    return undefined;
  }
  const preferred = matches.find((file) => /setup/i.test(path.basename(file)));
  return preferred ?? matches[0];
}

export function stageDesktopArtifacts(request: StageRequest): string[] {
  const expected = expectedArtifactsFor(request.version, {
    platform: request.platform,
    architecture: request.architecture,
  } satisfies ArtifactFilter);
  mkdirSync(request.outputDir, { recursive: true });
  const installers = listFilesRecursive(request.makeDir).filter((file) =>
    isInstaller(file, request.platform),
  );
  const staged: string[] = [];
  for (const artifact of expected) {
    const extension = extensionFor(artifact.fileName);
    const source = pickInstaller(installers, extension);
    if (source === undefined) {
      throw new Error(`no ${extension} installer found for ${artifact.fileName}`);
    }
    const destination = path.join(request.outputDir, artifact.fileName);
    copyFileSync(source, destination);
    writeFileSync(`${destination}.sha512`, `${sha512File(destination)}\n`);
    staged.push(destination);
  }
  return staged;
}

if (import.meta.main) {
  const version = (process.env["DESKTOP_VERSION"] ?? "").replace(/^v/, "");
  const platform = process.env["DESKTOP_PLATFORM"];
  const architecture = process.env["DESKTOP_ARCH"];
  const makeDir = process.env["DESKTOP_MAKE_DIR"];
  const outputDir = process.env["DESKTOP_STAGE_DIR"];
  if (
    version.length === 0 ||
    makeDir === undefined ||
    outputDir === undefined ||
    (platform !== "win32" && platform !== "darwin" && platform !== "linux") ||
    (architecture !== "x64" && architecture !== "arm64")
  ) {
    console.error(
      "DESKTOP_VERSION, DESKTOP_PLATFORM, DESKTOP_ARCH, DESKTOP_MAKE_DIR and DESKTOP_STAGE_DIR are required",
    );
    process.exit(1);
  }
  const staged = stageDesktopArtifacts({
    version,
    platform,
    architecture,
    makeDir,
    outputDir,
  });
  console.info(`Staged ${staged.length} desktop artefact(s).`);
}
