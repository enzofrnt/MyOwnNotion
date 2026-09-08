/**
 * Verifies packaged desktop artefacts before publication (feature 014, US5).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

export interface DesktopArtifactExpectation {
  readonly fileName: string;
  readonly platform: "win32" | "darwin" | "linux";
  readonly architecture: "x64" | "arm64";
}

export interface ArtifactFilter {
  readonly platform?: "win32" | "darwin" | "linux";
  readonly architecture?: "x64" | "arm64";
}

const FORBIDDEN_NAME_MARKERS = [
  "darwin-x64",
  "osx-x64",
  "universal",
  "mas",
  "appx",
  ".snap",
  "flathub",
  "microsoftstore",
];

export function expectedArtifacts(version: string): readonly DesktopArtifactExpectation[] {
  return [
    { fileName: `MyOwnNotion-${version}-win32-x64.exe`, platform: "win32", architecture: "x64" },
    {
      fileName: `MyOwnNotion-${version}-win32-arm64.exe`,
      platform: "win32",
      architecture: "arm64",
    },
    {
      fileName: `MyOwnNotion-${version}-darwin-arm64.dmg`,
      platform: "darwin",
      architecture: "arm64",
    },
    {
      fileName: `MyOwnNotion-${version}-linux-x64.AppImage`,
      platform: "linux",
      architecture: "x64",
    },
    { fileName: `MyOwnNotion-${version}-linux-x64.deb`, platform: "linux", architecture: "x64" },
    { fileName: `MyOwnNotion-${version}-linux-x64.rpm`, platform: "linux", architecture: "x64" },
    {
      fileName: `MyOwnNotion-${version}-linux-arm64.AppImage`,
      platform: "linux",
      architecture: "arm64",
    },
    {
      fileName: `MyOwnNotion-${version}-linux-arm64.deb`,
      platform: "linux",
      architecture: "arm64",
    },
    {
      fileName: `MyOwnNotion-${version}-linux-arm64.rpm`,
      platform: "linux",
      architecture: "arm64",
    },
  ];
}

export function expectedArtifactsFor(
  version: string,
  filter: ArtifactFilter = {},
): readonly DesktopArtifactExpectation[] {
  return expectedArtifacts(version).filter((artifact) => {
    if (filter.platform !== undefined && artifact.platform !== filter.platform) {
      return false;
    }
    if (filter.architecture !== undefined && artifact.architecture !== filter.architecture) {
      return false;
    }
    return true;
  });
}

export function sha512File(filePath: string): string {
  return createHash("sha512").update(readFileSync(filePath)).digest("hex");
}

export function isAllowedCompanion(fileName: string, expectedNames: ReadonlySet<string>): boolean {
  if (!fileName.endsWith(".sha512")) {
    return false;
  }
  return expectedNames.has(fileName.slice(0, -".sha512".length));
}

export function collectDesktopArtifactFailures(
  artifactDir: string,
  version: string,
  filter: ArtifactFilter = {},
): string[] {
  const failures: string[] = [];
  if (!existsSync(artifactDir)) {
    failures.push(`artifact directory is missing: ${artifactDir}`);
    return failures;
  }
  const expected = expectedArtifactsFor(version, filter);
  const expectedNames = new Set(expected.map((artifact) => artifact.fileName));
  const names = readdirSync(artifactDir);
  for (const expectedArtifact of expected) {
    if (!names.includes(expectedArtifact.fileName)) {
      failures.push(`missing artefact ${expectedArtifact.fileName}`);
      continue;
    }
    const digest = sha512File(path.join(artifactDir, expectedArtifact.fileName));
    const companion = path.join(artifactDir, `${expectedArtifact.fileName}.sha512`);
    if (!existsSync(companion) || readFileSync(companion, "utf8").trim() !== digest) {
      failures.push(`missing or mismatched SHA-512 for ${expectedArtifact.fileName}`);
    }
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_NAME_MARKERS.some((marker) => lower.includes(marker))) {
      failures.push(`forbidden artefact name ${name}`);
      continue;
    }
    if (
      expectedNames.has(name) ||
      isAllowedCompanion(name, expectedNames) ||
      /^verification-(win32|darwin|linux)-(x64|arm64)\.json$/.test(name)
    ) {
      continue;
    }
    failures.push(`unexpected artefact ${name}`);
  }
  return failures;
}

const version = (process.env["DESKTOP_VERSION"] ?? "0.1.0").replace(/^v/, "");
const artifactDir = path.resolve(repoRoot, process.env["DESKTOP_ARTIFACT_DIR"] ?? "out");
const platform = process.env["DESKTOP_PLATFORM"];
const architecture = process.env["DESKTOP_ARCH"];
const filter: ArtifactFilter = {
  ...(platform === "win32" || platform === "darwin" || platform === "linux" ? { platform } : {}),
  ...(architecture === "x64" || architecture === "arm64" ? { architecture } : {}),
};

if (import.meta.main) {
  const failures = collectDesktopArtifactFailures(artifactDir, version, filter);
  if (failures.length > 0) {
    console.error("Desktop artefact check failed:\n");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.info("Desktop artefact check passed.");
}
