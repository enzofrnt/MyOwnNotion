import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import type { ForgeConfig } from "@electron-forge/shared-types";
import MakerAppImage from "@reforged/maker-appimage";
import { materializeMacEntitlements } from "../../scripts/desktop/mac-entitlements.ts";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(desktopRoot, "../web/dist");

const linuxCategories: ["Office"] = ["Office"];

const linuxPackage = {
  name: "myownnotion",
  productName: "MyOwnNotion",
  genericName: "Knowledge Workspace",
  description: "Single-owner self-hosted knowledge workspace",
  categories: linuxCategories,
};

const macEntitlementsTemplate = path.join(desktopRoot, "entitlements.mac.plist");
const macEntitlements = process.env["APPLE_IDENTITY"]
  ? materializeMacEntitlements(macEntitlementsTemplate, process.env["APPLE_IDENTITY"])
  : macEntitlementsTemplate;
const macInheritEntitlements = path.join(desktopRoot, "entitlements.mac.inherit.plist");
const macPluginEntitlements = path.join(desktopRoot, "entitlements.mac.plugin.plist");

function entitlementsForPackagedFile(filePath: string): string {
  if (filePath.includes("Plugin")) {
    return macPluginEntitlements;
  }
  if (filePath.includes("Helper") || filePath.includes("Electron Framework.framework")) {
    return macInheritEntitlements;
  }
  return macEntitlements;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    prune: true,
    name: "MyOwnNotion",
    executableName: "MyOwnNotion",
    appBundleId: "dev.myownnotion.desktop",
    appCategoryType: "public.app-category.productivity",
    ...(process.env["APPLE_IDENTITY"]
      ? {
          osxSign: {
            identity: process.env["APPLE_IDENTITY"],
            optionsForFile: (filePath) => ({ entitlements: entitlementsForPackagedFile(filePath) }),
          },
        }
      : {}),
    ...(process.env["APPLE_API_KEY_PATH"]
      ? {
          osxNotarize: {
            appleApiKey: process.env["APPLE_API_KEY_PATH"],
            appleApiKeyId: process.env["APPLE_API_KEY_ID"] ?? "",
            appleApiIssuer: process.env["APPLE_API_ISSUER"] ?? "",
          },
        }
      : {}),
    ...(process.env["WINDOWS_CERTIFICATE_FILE"]
      ? {
          windowsSign: {
            certificateFile: process.env["WINDOWS_CERTIFICATE_FILE"],
            certificatePassword: process.env["CSC_KEY_PASSWORD"] ?? "",
          },
        }
      : {}),
    extraResource: [webDist],
    // Bun bundles every runtime import except Electron. Keep only those outputs;
    // build tools and Bun's isolated dependency links must not enter app.asar.
    ignore: (file) =>
      file !== "" && !/^\/(package\.json|\.vite(?:\/build(?:\/[^/]+\.(js|cjs|map))?)?)$/.test(file),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(
      {
        name: "MyOwnNotion",
        ...(process.env["WINDOWS_CERTIFICATE_FILE"]
          ? {
              certificateFile: process.env["WINDOWS_CERTIFICATE_FILE"],
              certificatePassword: process.env["CSC_KEY_PASSWORD"] ?? "",
            }
          : {}),
        authors: "MyOwnNotion",
        description: "Single-owner self-hosted knowledge workspace",
      },
      ["win32"],
    ),
    new MakerDMG({}, ["darwin"]),
    new MakerAppImage({ options: linuxPackage }, ["linux"]),
    new MakerDeb({ options: { ...linuxPackage, maintainer: "MyOwnNotion" } }, ["linux"]),
    new MakerRpm({ options: linuxPackage }, ["linux"]),
  ],
  hooks: {
    generateAssets: async () => {
      execFileSync("bun", ["build.ts"], { cwd: desktopRoot, stdio: "inherit" });
    },
  },
};

export default config;
