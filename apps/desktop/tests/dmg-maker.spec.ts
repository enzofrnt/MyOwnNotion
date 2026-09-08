import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MakerOptions } from "@electron-forge/maker-base";
import { expect, it } from "vitest";
import { MakerDMG } from "../makers/dmg.ts";

const run = promisify(execFile);

it.skipIf(process.platform !== "darwin")(
  "creates a mountable image preserving the app and Applications shortcut",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-dmg-test-"));
    const source = path.join(root, "package");
    const output = path.join(root, "make");
    const mount = path.join(root, "mount");
    let mounted = false;
    try {
      const executable = path.join(source, "Fixture.app/Contents/MacOS/Fixture");
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "preserved executable fixture");
      await chmod(executable, 0o755);
      await run("/usr/bin/xattr", ["-w", "dev.myownnotion.fixture", "preserved", executable]);
      await symlink("MacOS/Fixture", path.join(source, "Fixture.app/Contents/linked"));
      const maker = new MakerDMG();
      const artifacts = await maker.make({
        dir: source,
        makeDir: output,
        appName: "Fixture",
        packageJSON: { version: "0.1.0" },
        targetArch: "arm64",
        targetPlatform: "darwin",
        forgeConfig: {},
      } as MakerOptions);
      expect(artifacts).toHaveLength(1);
      const artifact = artifacts[0];
      if (artifact === undefined) throw new Error("The maker returned no disk image.");
      expect(await readdir(output)).toEqual(["Fixture-0.1.0-arm64.dmg"]);
      await mkdir(mount);
      await run("/usr/bin/hdiutil", [
        "attach",
        "-quiet",
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mount,
        artifact,
      ]);
      mounted = true;
      const restored = path.join(mount, "Fixture.app/Contents/MacOS/Fixture");
      expect(await readFile(restored, "utf8")).toBe("preserved executable fixture");
      expect((await stat(restored)).mode & 0o111).toBe(0o111);
      expect(
        (await run("/usr/bin/xattr", ["-p", "dev.myownnotion.fixture", restored])).stdout.trim(),
      ).toBe("preserved");
      expect(await readlink(path.join(mount, "Fixture.app/Contents/linked"))).toBe("MacOS/Fixture");
      expect(await readlink(path.join(mount, "Applications"))).toBe("/Applications");
    } finally {
      if (mounted) await run("/usr/bin/hdiutil", ["detach", "-quiet", mount]);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it("refuses an output name that could leave the artifact directory", async () => {
  const maker = new MakerDMG();
  await expect(
    maker.make({ appName: "../outside", packageJSON: { version: "0.1.0" } } as MakerOptions),
  ).rejects.toThrow("safe file names");
});
