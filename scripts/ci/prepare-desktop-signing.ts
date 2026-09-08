/** Materialize CI secrets in the disposable runner directory, never the package. */
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing release configuration: ${name}`);
  return value;
}
const temporary = required("RUNNER_TEMP");
const environment = required("GITHUB_ENV");
required("DESKTOP_UPDATE_PUBLIC_KEY");
function secretFile(name: string, filename: string, base64 = true): string {
  const target = path.join(temporary, filename);
  writeFileSync(target, base64 ? Buffer.from(required(name), "base64") : required(name), {
    mode: 0o600,
  });
  return target;
}
function expose(name: string, value: string): void {
  appendFileSync(environment, `${name}=${value}\n`);
}
if (process.platform === "win32") {
  required("CSC_KEY_PASSWORD");
  expose("WINDOWS_CERTIFICATE_FILE", secretFile("CSC_LINK", "desktop-signing.pfx"));
} else if (process.platform === "darwin") {
  if (!required("APPLE_IDENTITY").startsWith("Developer ID Application:"))
    throw new Error("A distribution identity is required");
  const certificate = secretFile("APPLE_CERTIFICATE", "desktop-signing.p12");
  const keychain = path.join(temporary, "desktop-signing.keychain-db");
  const password = crypto.randomUUID();
  const security = (args: string[]) => execFileSync("security", args, { stdio: "pipe" });
  try {
    security(["create-keychain", "-p", password, keychain]);
    security(["set-keychain-settings", "-lut", "21600", keychain]);
    security(["unlock-keychain", "-p", password, keychain]);
    security([
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      required("APPLE_CERTIFICATE_PASSWORD"),
      "-T",
      "/usr/bin/codesign",
    ]);
    security([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      password,
      keychain,
    ]);
    security(["list-keychains", "-d", "user", "-s", keychain]);
  } catch {
    throw new Error("Distribution keychain preparation failed");
  }
  expose("APPLE_API_KEY_PATH", secretFile("APPLE_API_KEY", "desktop-notarization.p8", false));
  required("APPLE_API_KEY_ID");
  required("APPLE_API_ISSUER");
}
console.info("Native signing configuration is ready in the disposable runner directory.");
