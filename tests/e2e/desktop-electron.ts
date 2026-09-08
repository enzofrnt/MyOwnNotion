import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

import { closeProcess, crashProcess, removeProfile } from "./desktop-process.ts";
import { nativeShutdownEvidence } from "./desktop-process-evidence.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const bootstrapJs = path.join(desktopRoot, ".vite", "build", "bootstrap.js");
let startupProbe: Promise<string> | undefined;
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

export interface DesktopElectronSession {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly userData: string;
  crash(): Promise<void>;
  close(options?: { readonly keepUserData?: boolean }): Promise<void>;
}

export async function launchDesktopElectron(
  userDataDir?: string,
  bootstrapPath = bootstrapJs,
): Promise<DesktopElectronSession> {
  const electronBinary = requireFromDesktop("electron") as unknown;
  if (typeof electronBinary !== "string" || electronBinary.length === 0) {
    throw new Error("The pinned Electron binary is not installed under apps/desktop.");
  }
  const userData = userDataDir ?? mkdtempSync(path.join(tmpdir(), "myownnotion-desktop-e2e-"));
  // Observe the real entry point through a preload, not a replacement bootstrap.
  startupProbe ??= Bun.build({
    entrypoints: [path.join(desktopRoot, "tests", "fixtures", "startup-probe.ts")],
    target: "node",
    format: "cjs",
    external: ["electron"],
  }).then(async (result) => {
    const output = result.outputs[0];
    if (!result.success || result.outputs.length !== 1 || output === undefined)
      throw new Error("Cannot build native startup probe");
    return output.text();
  });
  const probePath = path.join(userData, "native-startup-probe.cjs");
  const tracePath = path.join(userData, "native-startup.jsonl");
  await writeFile(probePath, await startupProbe);
  await writeFile(tracePath, "");
  const app = await electron
    .launch({
      executablePath: electronBinary,
      args: ["--require", probePath, bootstrapPath, `--user-data-dir=${userData}`],
      cwd: desktopRoot,
      env: {
        ...process.env,
        MYOWNNOTION_DESKTOP_STARTUP_TRACE: tracePath,
        MYOWNNOTION_DESKTOP_DEV: "0",
        MYOWNNOTION_DESKTOP_TEST_USER_DATA: userData,
        MYOWNNOTION_REPO_ROOT: repoRoot,
        MYOWNNOTION_WEB_DIST: path.join(repoRoot, "apps", "web", "dist"),
      },
    })
    .catch(async (error: unknown) => {
      const trace = await readFile(tracePath, "utf8").catch(() => "");
      // Only fixed event names/numeric exit status are written by the preload.
      console.error(
        `[desktop-test] startup trace: ${trace.slice(0, 4096) || "preload-not-reached"}`,
      );
      throw error;
    });
  const child = app.process();
  const electronPid = await app.evaluate(() => process.pid);
  let expectedExit = false;
  let unexpectedExitEvidence: Promise<void> | undefined;
  const report = async (stage: "unexpected-context-close" | "shutdown-failure") => {
    const trace = await readFile(tracePath, "utf8").catch(() => "");
    console.error(
      `[desktop-test] ${stage}:`,
      JSON.stringify(nativeShutdownEvidence(child, electronPid, trace)),
    );
  };
  app.context().once("close", () => {
    if (!expectedExit) unexpectedExitEvidence = report("unexpected-context-close");
  });
  const window = await app.firstWindow();
  return {
    app,
    window,
    userData,
    crash: () => {
      expectedExit = true;
      return crashProcess(child);
    },
    close: async (options) => {
      expectedExit = true;
      try {
        await closeProcess(child, () => app.close());
      } catch (error) {
        await report("shutdown-failure");
        throw error;
      } finally {
        await unexpectedExitEvidence;
      }
      if (options?.keepUserData !== true) {
        // Windows may release native file handles just after process exit.
        await removeProfile(userData);
      }
    },
  };
}
