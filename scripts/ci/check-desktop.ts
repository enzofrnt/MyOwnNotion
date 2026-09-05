/**
 * Desktop host toolchain and artefact presence (feature 014).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const REQUIRED_SPEC_FILES = [
  "specs/014-desktop-clients/spec.md",
  "specs/014-desktop-clients/plan.md",
  "specs/014-desktop-clients/tasks.md",
  "specs/014-desktop-clients/data-model.md",
  "specs/014-desktop-clients/quickstart.md",
  "specs/014-desktop-clients/contracts/desktop-runtime.md",
  "specs/014-desktop-clients/contracts/update-manifest.md",
  "specs/014-desktop-clients/validation.md",
];

const PINNED_PACKAGES = [
  "electron",
  "@electron-forge/cli",
  "@electron-forge/maker-squirrel",
  "@electron-forge/maker-dmg",
  "@electron-forge/maker-deb",
  "@electron-forge/maker-rpm",
  "@reforged/maker-appimage",
] as const;

const FORBIDDEN_PACKAGES = ["@electron-forge/maker-zip", "@electron-forge/maker-snap"] as const;

export function collectDesktopFailures(): string[] {
  const failures: string[] = [];
  const desktopPackagePath = path.join(repoRoot, "apps/desktop/package.json");
  if (!existsSync(desktopPackagePath)) {
    failures.push("apps/desktop/package.json is required");
    return failures;
  }
  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8")) as {
    name?: string;
    packageManager?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  if (desktopPackage.name !== "@myownnotion/desktop") {
    failures.push('apps/desktop/package.json name must be "@myownnotion/desktop"');
  }
  if (desktopPackage.packageManager !== undefined) {
    failures.push("apps/desktop must not declare a nested packageManager");
  }
  const deps = { ...desktopPackage.dependencies, ...desktopPackage.devDependencies };
  for (const name of PINNED_PACKAGES) {
    const version = deps[name];
    if (version === undefined || version.startsWith("^") || version.startsWith("~")) {
      failures.push(`${name} must be pinned exactly in apps/desktop/package.json`);
    }
  }
  for (const name of FORBIDDEN_PACKAGES) {
    if (deps[name] !== undefined) {
      failures.push(`${name} is not a published desktop maker`);
    }
  }
  for (const script of ["dev", "build", "package", "make", "publish"]) {
    if (typeof desktopPackage.scripts?.[script] !== "string") {
      failures.push(`apps/desktop/package.json scripts.${script} is required`);
    }
  }
  const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const script of ["desktop:dev", "desktop:build", "desktop:make", "desktop:smoke"]) {
    if (typeof rootPackage.scripts?.[script] !== "string") {
      failures.push(`package.json scripts.${script} is required`);
    }
  }
  const bunLock = readFileSync(path.join(repoRoot, "bun.lock"), "utf8");
  if (!bunLock.includes("electron@") && !bunLock.includes('"electron"')) {
    failures.push("bun.lock must include the pinned Electron package");
  }
  const forgePath = path.join(repoRoot, "apps/desktop/forge.config.ts");
  if (!existsSync(forgePath)) {
    failures.push("apps/desktop/forge.config.ts is required");
  } else {
    const forge = readFileSync(forgePath, "utf8");
    if (!forge.includes("@reforged/maker-appimage")) {
      failures.push("forge.config.ts must use @reforged/maker-appimage");
    }
    if (
      !forge.includes("MakerDeb") ||
      !forge.includes("MakerRpm") ||
      !forge.includes("MakerSquirrel")
    ) {
      failures.push("forge.config.ts must declare Squirrel, Deb and Rpm makers");
    }
    if (forge.includes("maker-zip") || forge.includes("MakerZIP")) {
      failures.push("forge.config.ts must not declare a ZIP maker");
    }
    if (/osxUniversal\s*:\s*true/.test(forge)) {
      failures.push("forge.config.ts must not enable a universal macOS bundle");
    }
    if (!/asar:\s*true/.test(forge) || !/prune:\s*true/.test(forge)) {
      failures.push("forge.config.ts must enable asar and prune");
    }
  }
  for (const file of REQUIRED_SPEC_FILES) {
    if (!existsSync(path.join(repoRoot, file))) {
      failures.push(`desktop feature artefact is missing: ${file}`);
    }
  }
  return failures;
}

if (import.meta.main) {
  const failures = collectDesktopFailures();
  if (failures.length > 0) {
    console.error("Desktop toolchain check failed:\n");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.info("Desktop toolchain check passed.");
}
