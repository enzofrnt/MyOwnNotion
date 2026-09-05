/** A native macOS disk image without V8-only addons in the Bun build process. */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MakerBase, type MakerOptions } from "@electron-forge/maker-base";
import type { ForgePlatform } from "@electron-forge/shared-types";

const run = promisify(execFile);
const nativeOptions = { timeout: 600_000, maxBuffer: 1024 * 1024 };

export class MakerDMG extends MakerBase<Record<string, never>> {
  name = "dmg";
  defaultPlatforms: ForgePlatform[] = ["darwin"];
  override requiredExternalBinaries = ["ditto", "hdiutil"];

  override isSupportedOnCurrentPlatform(): boolean {
    return process.platform === "darwin";
  }

  override async make({
    dir,
    makeDir,
    appName,
    packageJSON,
    targetArch,
  }: MakerOptions): Promise<string[]> {
    const version: unknown = packageJSON.version;
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(appName) ||
      typeof version !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(version)
    ) {
      throw new Error("The DMG name and version must be safe file names.");
    }
    await mkdir(makeDir, { recursive: true });
    const staging = await mkdtemp(path.join(makeDir, ".dmg-stage-"));
    const output = path.resolve(makeDir, `${appName}-${version}-${targetArch}.dmg`);
    try {
      const contents = path.join(staging, "contents");
      await mkdir(contents);
      // ditto preserves framework symlinks, executable modes, signatures and
      // notarization attributes from the application already produced by Forge.
      await run(
        "/usr/bin/ditto",
        [path.join(dir, `${appName}.app`), path.join(contents, `${appName}.app`)],
        nativeOptions,
      );
      await symlink("/Applications", path.join(contents, "Applications"));
      const partial = path.join(staging, "image.dmg");
      await run(
        "/usr/bin/hdiutil",
        [
          "create",
          "-quiet",
          "-fs",
          "HFS+",
          "-format",
          "UDZO",
          "-volname",
          appName,
          "-srcfolder",
          contents,
          partial,
        ],
        nativeOptions,
      );
      await run("/usr/bin/hdiutil", ["verify", "-quiet", partial], nativeOptions);
      await rename(partial, output);
      return [output];
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
