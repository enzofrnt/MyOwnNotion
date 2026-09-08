import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { windowsProfileKeyEnvironment } from "../src/windows-profile-key.ts";

it.runIf(process.platform === "win32")(
  "boots the real native parent and child from a script entry and preserves the committed key",
  async () => {
    const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const directory = mkdtempSync(path.join(tmpdir(), "myownnotion-native-prime-"));
    try {
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
      for (const [entry, filename] of [
        ["src/bootstrap.ts", "bootstrap.js"],
        ["tests/fixtures/windows-prime-main.ts", "main.js"],
      ] as const) {
        const build = await Bun.build({
          entrypoints: [path.join(desktopRoot, entry)],
          outdir: directory,
          naming: filename,
          target: "node",
          format: "esm",
          external: ["electron"],
        });
        expect(build.success).toBe(true);
      }
      const executable: unknown = createRequire(path.join(desktopRoot, "package.json"))("electron");
      if (typeof executable !== "string") throw new Error("Missing pinned Electron executable");
      const profile = path.join(directory, "profile with spaces");
      const launch = () => {
        const result = spawnSync(
          executable,
          [path.join(directory, "bootstrap.js"), `--user-data-dir=${profile}`],
          {
            env: windowsProfileKeyEnvironment(process.env),
            encoding: "utf8",
            windowsHide: true,
            timeout: 25_000,
            maxBuffer: 64 * 1024,
          },
        );
        const diagnostic = (result.stderr ?? "").match(
          /protected-storage:(child-exit:(?:-?\d+|unavailable)|metadata-unavailable)/u,
        )?.[1];
        const errorCode =
          result.error !== undefined &&
          "code" in result.error &&
          typeof result.error.code === "string" &&
          /^E[A-Z]+$/u.test(result.error.code)
            ? result.error.code
            : result.error === undefined
              ? null
              : "spawn-error";
        expect({
          status: result.status,
          errorCode,
          diagnostic: diagnostic ?? "not-emitted",
        }).toEqual({
          status: 0,
          errorCode: null,
          diagnostic: "not-emitted",
        });
        expect((result.stdout ?? "").includes("windows-prime-parent-ready")).toBe(true);
        const state = JSON.parse(readFileSync(path.join(profile, "Local State"), "utf8")) as {
          os_crypt?: { encrypted_key?: unknown };
        };
        expect(typeof state.os_crypt?.encrypted_key === "string").toBe(true);
        return state.os_crypt?.encrypted_key;
      };
      const firstKey = launch();
      // Keep native protected bytes inside this process, including on assertion failure.
      expect(launch() === firstKey).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
