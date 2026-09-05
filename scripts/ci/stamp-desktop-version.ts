/**
 * Align the desktop package version with a release tag (feature 014).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const version = (process.env["DESKTOP_VERSION"] ?? "").replace(/^v/, "");
if (!STRICT_VERSION.test(version)) {
  console.error(
    `DESKTOP_VERSION must be a strict semver triple (found: ${version || "(missing)"})`,
  );
  process.exit(1);
}

const packagePath = path.join(repoRoot, "apps/desktop/package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
manifest.version = version;
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.info(`Stamped desktop version ${version}.`);
