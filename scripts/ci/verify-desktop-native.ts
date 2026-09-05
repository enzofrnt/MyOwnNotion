/** Verify signatures and native package metadata before producing release evidence. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expectedArtifactsFor, sha512File } from "./check-desktop-artifacts.ts";

const version = (process.env["DESKTOP_VERSION"] ?? "").replace(/^v/, "");
const platform = process.platform;
const architecture = process.arch;
if (
  (platform !== "win32" && platform !== "darwin" && platform !== "linux") ||
  (architecture !== "x64" && architecture !== "arm64")
)
  throw new Error("Unsupported release host");
const directory = path.resolve(process.env["DESKTOP_ARTIFACT_DIR"] ?? "staged-desktop");
const packaged = path.resolve(`apps/desktop/out/MyOwnNotion-${platform}-${architecture}`);
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const proofs: { name: string; sha512: string }[] = [];
if (platform === "darwin") {
  const app = path.join(packaged, "MyOwnNotion.app");
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("spctl", ["--assess", "--type", "execute", app]);
  run("xcrun", ["stapler", "validate", app]);
  if (run("lipo", ["-archs", `${app}/Contents/MacOS/MyOwnNotion`]) !== "arm64")
    throw new Error("Incorrect macOS runtime architecture");
}
for (const artifact of expectedArtifactsFor(version, { platform, architecture })) {
  const file = path.join(directory, artifact.fileName);
  if (platform === "win32") {
    // Paths enter through the environment, never PowerShell source interpolation.
    for (const target of [file, path.join(packaged, "MyOwnNotion.exe")]) {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$s = Get-AuthenticodeSignature -LiteralPath $env:DESKTOP_VERIFY_FILE; if ($s.Status -ne 'Valid') { exit 1 }",
        ],
        { env: { ...process.env, DESKTOP_VERIFY_FILE: target }, stdio: "pipe" },
      );
    }
    const executable = readFileSync(path.join(packaged, "MyOwnNotion.exe"));
    const pe = executable.readUInt32LE(0x3c);
    if (executable.readUInt16LE(pe + 4) !== (architecture === "arm64" ? 0xaa64 : 0x8664))
      throw new Error("Incorrect Windows runtime architecture");
  } else if (platform === "darwin") {
    // DMG integrity plus assessment of the notarized application inside it.
    run("hdiutil", ["verify", file]);
  } else if (file.endsWith(".deb")) {
    if (
      run("dpkg-deb", ["--field", file, "Architecture"]) !==
      (architecture === "x64" ? "amd64" : "arm64")
    )
      throw new Error("Incorrect deb architecture");
  } else if (file.endsWith(".rpm")) {
    if (
      run("rpm", ["-qp", "--qf", "%{ARCH}", file]) !==
      (architecture === "x64" ? "x86_64" : "aarch64")
    )
      throw new Error("Incorrect rpm architecture");
  } else {
    const binary = readFileSync(file);
    if (
      binary.toString("ascii", 1, 4) !== "ELF" ||
      binary.readUInt16LE(18) !== (architecture === "x64" ? 62 : 183)
    )
      throw new Error("Incorrect AppImage architecture");
  }
  proofs.push({ name: artifact.fileName, sha512: sha512File(file) });
}
writeFileSync(
  path.join(directory, `verification-${platform}-${architecture}.json`),
  JSON.stringify(
    {
      version,
      platform,
      architecture,
      commit: process.env["GITHUB_SHA"],
      checks: "native-signatures-and-architecture",
      artifacts: proofs,
    },
    null,
    2,
  ),
);
console.info(`Verified ${proofs.length} native release artifacts.`);
