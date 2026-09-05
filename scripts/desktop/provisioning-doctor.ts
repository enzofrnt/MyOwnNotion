/**
 * Verifies macOS Touch ID prerequisites for `desktop:dev`.
 *
 * Touch ID needs:
 * - Apple Development codesign identity (private key in Keychain)
 * - Mac Development provisioning profile for `dev.myownnotion.desktop`
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCodesignIdentity, printCodesignIdentityHelp } from "./codesign-diagnostics.ts";

const DESKTOP_BUNDLE_ID = "dev.myownnotion.desktop";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const devHostApp = path.join(repoRoot, "apps/desktop/.dev-host/Electron.app");

type ProfileMatch = {
  readonly path: string;
  readonly name: string;
  readonly teamId: string | null;
};

function decodeProvisioningProfile(profilePath: string): string {
  const decoded = spawnSync("security", ["cms", "-D", "-i", profilePath], { encoding: "utf8" });
  return `${decoded.stdout}${decoded.stderr}`;
}

function parseProfileName(plistXml: string): string {
  const match = plistXml.match(/<key>Name<\/key>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ?? "(unnamed profile)";
}

function parseTeamId(plistXml: string): string | null {
  const match = plistXml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
  return match?.[1] ?? null;
}

function scanProvisioningProfiles(): ProfileMatch[] {
  const matches: ProfileMatch[] = [];
  const fromEnv = process.env["MYOWNNOTION_DESKTOP_PROVISIONING_PROFILE"];
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
    const xml = decodeProvisioningProfile(fromEnv);
    if (xml.includes(DESKTOP_BUNDLE_ID)) {
      matches.push({
        path: fromEnv,
        name: parseProfileName(xml),
        teamId: parseTeamId(xml),
      });
    }
    return matches;
  }

  const profileDir = path.join(
    process.env["HOME"] ?? "",
    "Library/MobileDevice/Provisioning Profiles",
  );
  if (!existsSync(profileDir)) {
    return matches;
  }
  for (const entry of readdirSync(profileDir)) {
    if (!entry.endsWith(".provisionprofile")) {
      continue;
    }
    const profilePath = path.join(profileDir, entry);
    const xml = decodeProvisioningProfile(profilePath);
    if (!xml.includes(DESKTOP_BUNDLE_ID)) {
      continue;
    }
    matches.push({
      path: profilePath,
      name: parseProfileName(xml),
      teamId: parseTeamId(xml),
    });
  }
  return matches;
}

function inspectDevHost(): {
  readonly exists: boolean;
  readonly embeddedProfile: boolean;
  readonly keychainEntitlement: boolean;
} {
  if (!existsSync(devHostApp)) {
    return { exists: false, embeddedProfile: false, keychainEntitlement: false };
  }
  const embedded = path.join(devHostApp, "Contents/embedded.provisionprofile");
  const mainBinary = path.join(devHostApp, "Contents/MacOS/Electron");
  const entitlements = spawnSync("codesign", ["-d", "--entitlements", "-", mainBinary], {
    encoding: "utf8",
  });
  const blob = `${entitlements.stdout}${entitlements.stderr}`;
  return {
    exists: true,
    embeddedProfile: existsSync(embedded),
    keychainEntitlement: blob.includes("keychain-access-groups"),
  };
}

function printAppleDeveloperSteps(): void {
  console.info("");
  console.info("[desktop:provisioning] Create the Mac Development profile (once):");
  console.info("  1. https://developer.apple.com/account/resources/identifiers/list");
  console.info("     → Identifiers → + → App IDs → App");
  console.info(`     → Bundle ID (Explicit): ${DESKTOP_BUNDLE_ID}`);
  console.info("     → Capabilities: enable Keychain Sharing");
  console.info("  2. https://developer.apple.com/account/resources/profiles/list");
  console.info("     → Profiles → + → macOS → Mac Development");
  console.info(`     → App ID: ${DESKTOP_BUNDLE_ID}`);
  console.info("     → Certificate: your Apple Development cert");
  console.info("     → Download the .provisionprofile");
  console.info("  3. Install: double-click the file, or:");
  console.info(
    "     export MYOWNNOTION_DESKTOP_PROVISIONING_PROFILE=~/Downloads/….provisionprofile",
  );
  console.info("  4. Reset the dev host and relaunch:");
  console.info("     rm -rf apps/desktop/.dev-host && bun run desktop:dev");
  console.info("");
  console.info("[desktop:provisioning] Success looks like:");
  console.info('  "[desktop:dev] Signed dev Electron host with Touch ID entitlements (...)"');
  console.info("");
  console.info(
    "[desktop:provisioning] Requires Apple Developer Program membership for custom App IDs.",
  );
}

function main(): void {
  if (process.platform !== "darwin") {
    console.info("[desktop:provisioning] macOS only.");
    process.exit(0);
  }

  let ok = true;

  const identity = inspectCodesignIdentity();
  printCodesignIdentityHelp(identity);
  if (identity.kind !== "ready") {
    ok = false;
  }

  const profiles = scanProvisioningProfiles();
  if (profiles.length === 0) {
    ok = false;
    console.warn(`[desktop:provisioning] No Mac Development profile for ${DESKTOP_BUNDLE_ID}.`);
    printAppleDeveloperSteps();
  } else {
    for (const profile of profiles) {
      console.info(`[desktop:provisioning] Profile: ${profile.name}`);
      console.info(`[desktop:provisioning]   path: ${profile.path}`);
      if (profile.teamId !== null) {
        console.info(`[desktop:provisioning]   team: ${profile.teamId}`);
      }
    }
  }

  const host = inspectDevHost();
  if (host.exists) {
    console.info("[desktop:provisioning] Dev host (.dev-host/Electron.app):");
    console.info(
      `[desktop:provisioning]   embedded profile: ${host.embeddedProfile ? "yes" : "no"}`,
    );
    console.info(
      `[desktop:provisioning]   keychain-access-groups: ${host.keychainEntitlement ? "yes" : "no"}`,
    );
    if (profiles.length > 0 && (!host.embeddedProfile || !host.keychainEntitlement)) {
      console.warn("[desktop:provisioning] Profile is installed but the dev host was not rebuilt.");
      console.warn(
        "[desktop:provisioning] Run: rm -rf apps/desktop/.dev-host && bun run desktop:dev",
      );
      ok = false;
    }
  } else if (profiles.length > 0) {
    console.info("[desktop:provisioning] Dev host not built yet — run bun run desktop:dev");
  }

  process.exit(ok ? 0 : 1);
}

main();
