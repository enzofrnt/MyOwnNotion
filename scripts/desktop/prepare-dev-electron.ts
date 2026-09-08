/**
 * Prepares a signed Electron dev host for Touch ID WebAuthn on macOS.
 *
 * Never re-signs the stock `node_modules/electron` bundle (that breaks launch).
 * Copies Electron.app into `apps/desktop/.dev-host`, sets the desktop bundle id,
 * and signs with Apple Development.
 *
 * Touch ID needs `keychain-access-groups`, which macOS only accepts when a matching
 * provisioning profile is embedded. Without it we sign with `allow-jit` only so the
 * host still launches; passkeys then work via Safari or a packaged build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCodesignIdentity, printCodesignIdentityHelp } from "./codesign-diagnostics.ts";
import { materializeMacEntitlements } from "./mac-entitlements.ts";

/** Must match `packagerConfig.appBundleId` and `webauthn-config.ts`. */
const DESKTOP_BUNDLE_ID = "dev.myownnotion.desktop";
const SIGN_RECIPE_VERSION = "dev-host-v3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktopRoot = path.join(repoRoot, "apps/desktop");
const devHostRoot = path.join(desktopRoot, ".dev-host");
const devElectronApp = path.join(devHostRoot, "Electron.app");
const versionStamp = path.join(devHostRoot, "electron-version.txt");
const runtimeEntitlements = path.join(desktopRoot, "entitlements.mac.inherit.plist");
const touchIdEntitlements = path.join(desktopRoot, "entitlements.mac.plist");

export type DevElectronHost = {
  readonly overrideDistPath: string | null;
  readonly touchIdReady: boolean;
};

function stockElectronApp(): string {
  const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
  const electronBinary = requireFromDesktop("electron") as string;
  return path.resolve(electronBinary, "../../..");
}

function stockElectronVersion(): string {
  const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
  const pkg = requireFromDesktop("electron/package.json") as { version: string };
  return pkg.version;
}

function stockElectronWasResigned(stockApp: string): boolean {
  const mainBinary = path.join(stockApp, "Contents/MacOS/Electron");
  const details = spawnSync("codesign", ["-d", "--entitlements", "-", mainBinary], {
    encoding: "utf8",
  });
  return `${details.stdout}${details.stderr}`.includes("dev.myownnotion.desktop.webauthn");
}

function restoreStockElectron(stockApp: string): void {
  console.warn("[desktop:dev] Restoring stock Electron.app after local WebAuthn signing…");
  const distDir = path.dirname(stockApp);
  rmSync(distDir, { recursive: true, force: true });
  const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
  const installScript = requireFromDesktop.resolve("electron/install.js");
  const restore = spawnSync(process.execPath, [installScript], {
    cwd: desktopRoot,
    stdio: "inherit",
  });
  if ((restore.status ?? 1) !== 0) {
    console.error("[desktop:dev] Could not restore stock Electron.app. Run from repo root:");
    console.error("  bun run desktop:dev");
    console.error("If it still fails:");
    console.error("  cd apps/desktop && bun install electron@44.1.1");
    process.exit(restore.status ?? 1);
  }
}

function restoreStockElectronIfNeeded(stockApp: string): void {
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", stockApp], {
    encoding: "utf8",
  });
  if (!stockElectronWasResigned(stockApp) && (verify.status ?? 1) === 0) {
    return;
  }
  restoreStockElectron(stockApp);
}

function resolveProvisioningProfile(): string | null {
  const fromEnv = process.env["MYOWNNOTION_DESKTOP_PROVISIONING_PROFILE"];
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
    return fromEnv;
  }
  const profileDir = path.join(
    process.env["HOME"] ?? "",
    "Library/MobileDevice/Provisioning Profiles",
  );
  if (!existsSync(profileDir)) {
    return null;
  }
  for (const entry of readdirSync(profileDir)) {
    if (!entry.endsWith(".provisionprofile")) {
      continue;
    }
    const profilePath = path.join(profileDir, entry);
    const decoded = spawnSync("security", ["cms", "-D", "-i", profilePath], { encoding: "utf8" });
    if (`${decoded.stdout}${decoded.stderr}`.includes(DESKTOP_BUNDLE_ID)) {
      return profilePath;
    }
  }
  return null;
}

function patchBundleIdentifier(appPath: string): void {
  const infoPlist = path.join(appPath, "Contents/Info.plist");
  const setId = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :CFBundleIdentifier ${DESKTOP_BUNDLE_ID}`, infoPlist],
    { encoding: "utf8" },
  );
  if ((setId.status ?? 1) !== 0) {
    throw new Error(`Could not set CFBundleIdentifier: ${setId.stderr}`);
  }
  spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleName MyOwnNotion`, infoPlist], {
    stdio: "ignore",
  });
  spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleDisplayName MyOwnNotion`, infoPlist], {
    stdio: "ignore",
  });
}

function syncDevHostCopy(stockApp: string, version: string, signMode: string): void {
  const stampValue = `${version}:${SIGN_RECIPE_VERSION}:${signMode}`;
  const stampedVersion = existsSync(versionStamp)
    ? readFileSync(versionStamp, "utf8").trim()
    : null;
  const needsCopy = !existsSync(devElectronApp) || stampedVersion !== stampValue;
  if (!needsCopy) {
    return;
  }
  rmSync(devHostRoot, { recursive: true, force: true });
  mkdirSync(devHostRoot, { recursive: true });
  const copy = spawnSync("cp", ["-R", "-a", stockApp, devElectronApp], { encoding: "utf8" });
  if ((copy.status ?? 1) !== 0) {
    throw new Error(`Could not copy Electron.app: ${copy.stderr}${copy.stdout}`.trim());
  }
  writeFileSync(versionStamp, `${stampValue}\n`, "utf8");
  patchBundleIdentifier(devElectronApp);
}

function codesignDevHost(identityName: string, entitlements: string): void {
  const result = spawnSync(
    "codesign",
    ["--force", "--sign", identityName, "--entitlements", entitlements, "--deep", devElectronApp],
    { encoding: "utf8" },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${result.stderr}${result.stdout}`.trim());
  }
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", devElectronApp], {
    encoding: "utf8",
  });
  if ((verify.status ?? 1) !== 0) {
    throw new Error(`${verify.stderr}${verify.stdout}`.trim());
  }
}

function electronLaunchProbe(): boolean {
  const binary = path.join(devElectronApp, "Contents/MacOS/Electron");
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return probe.status === 0 && probe.signal === null;
}

function embedProvisioningProfile(profilePath: string): void {
  const target = path.join(devElectronApp, "Contents/embedded.provisionprofile");
  const copy = spawnSync("cp", [profilePath, target], { encoding: "utf8" });
  if ((copy.status ?? 1) !== 0) {
    throw new Error(`Could not embed provisioning profile: ${copy.stderr}${copy.stdout}`.trim());
  }
}

function signDevHostCopy(identityName: string): { touchIdReady: boolean } {
  const provisioningProfile = resolveProvisioningProfile();
  if (provisioningProfile !== null) {
    syncDevHostCopy(stockElectronApp(), stockElectronVersion(), "touchid");
    embedProvisioningProfile(provisioningProfile);
    try {
      codesignDevHost(identityName, materializeMacEntitlements(touchIdEntitlements, identityName));
      if (electronLaunchProbe()) {
        return { touchIdReady: true };
      }
    } catch (error) {
      console.warn(
        "[desktop:dev] Touch ID signing failed; falling back to runtime-only entitlements.",
        error,
      );
    }
    rmSync(devHostRoot, { recursive: true, force: true });
  }

  syncDevHostCopy(stockElectronApp(), stockElectronVersion(), "runtime");
  codesignDevHost(identityName, runtimeEntitlements);
  return { touchIdReady: false };
}

export async function prepareDevElectronHost(): Promise<DevElectronHost> {
  if (process.platform !== "darwin") {
    return { overrideDistPath: null, touchIdReady: false };
  }
  if (process.env["MYOWNNOTION_DESKTOP_STOCK_ELECTRON"] === "1") {
    return { overrideDistPath: null, touchIdReady: false };
  }

  const stockApp = stockElectronApp();
  restoreStockElectronIfNeeded(stockApp);

  const codesignStatus = inspectCodesignIdentity();
  if (codesignStatus.kind !== "ready") {
    printCodesignIdentityHelp(codesignStatus);
    return { overrideDistPath: null, touchIdReady: false };
  }

  try {
    const signed = signDevHostCopy(codesignStatus.identityName);
    if (signed.touchIdReady) {
      console.info(
        `[desktop:dev] Signed dev Electron host with Touch ID entitlements (${codesignStatus.identityName}).`,
      );
    } else {
      console.info(
        `[desktop:dev] Signed dev Electron host for launch (${codesignStatus.identityName}). Touch ID passkeys need Safari on https://localhost:8443 or a packaged build.`,
      );
    }
    return { overrideDistPath: devHostRoot, touchIdReady: signed.touchIdReady };
  } catch (error) {
    rmSync(devHostRoot, { recursive: true, force: true });
    console.warn("[desktop:dev] Could not prepare a signed dev Electron host.", error);
    console.warn(
      "[desktop:dev] Launching stock Electron. Use Safari on https://localhost:8443 for passkey bootstrap.",
    );
    return { overrideDistPath: null, touchIdReady: false };
  }
}
