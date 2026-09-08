import { parseArgs } from "node:util";
import type { ForgeAPI } from "@electron-forge/core";
import type { ForgeArch, ForgePlatform } from "@electron-forge/shared-types";

type PackagingAPI = Pick<ForgeAPI, "package" | "make" | "publish">;

/** Keep Forge's packaging/signing pipeline without its npm-only CLI startup check. */
export async function runForgeCommand(
  args: readonly string[],
  api: PackagingAPI,
  directory: string,
  host: { readonly platform: string; readonly arch: string } = process,
): Promise<unknown> {
  const [command, ...trailing] = args;
  if (command !== "package" && command !== "make" && command !== "publish") {
    throw new Error("Expected package, make or publish");
  }
  const { values } = parseArgs({
    args: trailing[0] === "--" ? trailing.slice(1) : trailing,
    options: { platform: { type: "string" }, arch: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const platform = values.platform ?? host.platform;
  const arch = values.arch ?? host.arch;
  if (
    !["win32", "darwin", "linux"].includes(platform) ||
    !["x64", "arm64"].includes(arch) ||
    (platform === "darwin" && arch !== "arm64")
  ) {
    throw new Error("Unsupported desktop target; use one of the five maintained release targets");
  }
  const options = {
    dir: directory,
    interactive: false,
    platform: platform as ForgePlatform,
    arch: arch as ForgeArch,
  };
  if (command === "publish") {
    return api.publish({ dir: directory, interactive: false, makeOptions: options });
  }
  return api[command](options);
}
