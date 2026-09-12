import { existsSync, mkdtempSync } from "node:fs";
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
const packagedRoot = path.join(
  desktopRoot,
  "out",
  `MyOwnNotion-${process.platform}-${process.arch}`,
);
const packagedExecutable =
  process.platform === "darwin"
    ? path.join(packagedRoot, "MyOwnNotion.app", "Contents", "MacOS", "MyOwnNotion")
    : path.join(packagedRoot, process.platform === "win32" ? "MyOwnNotion.exe" : "MyOwnNotion");
let startupProbe: Promise<string> | undefined;
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

export interface DesktopElectronSession {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly userData: string;
  readonly packaged: boolean;
  diagnoseFailure(): Promise<void>;
  crash(): Promise<void>;
  close(options?: { readonly keepUserData?: boolean }): Promise<void>;
}

export async function launchDesktopElectron(
  userDataDir?: string,
  bootstrapPath?: string,
): Promise<DesktopElectronSession> {
  const electronBinary = requireFromDesktop("electron") as unknown;
  if (typeof electronBinary !== "string" || electronBinary.length === 0) {
    throw new Error("The pinned Electron binary is not installed under apps/desktop.");
  }
  const userData = userDataDir ?? mkdtempSync(path.join(tmpdir(), "myownnotion-desktop-e2e-"));
  const packaged = bootstrapPath === undefined && existsSync(packagedExecutable);
  if (!packaged && bootstrapPath === undefined) {
    throw new Error(`Packaged desktop executable is missing: ${packagedExecutable}`);
  }
  const executablePath = packaged ? packagedExecutable : electronBinary;
  // Observe the real entry point through a preload, not a replacement bootstrap.
  const probePath = path.join(userData, "native-startup-probe.cjs");
  const tracePath = path.join(userData, "native-startup.jsonl");
  if (!packaged) {
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
    await writeFile(probePath, await startupProbe);
  }
  await writeFile(tracePath, "");
  const appArgs = packaged
    ? [`--user-data-dir=${userData}`]
    : ["--require", probePath, bootstrapPath ?? bootstrapJs, `--user-data-dir=${userData}`];
  const launchEnv = { ...process.env };
  if (packaged) {
    delete launchEnv["MYOWNNOTION_WEB_DIST"];
    delete launchEnv["MYOWNNOTION_REPO_ROOT"];
  } else {
    launchEnv["MYOWNNOTION_WEB_DIST"] = path.join(repoRoot, "apps", "web", "dist");
    launchEnv["MYOWNNOTION_REPO_ROOT"] = repoRoot;
  }
  const app = await electron
    .launch({
      executablePath,
      args: appArgs,
      cwd: packaged ? path.dirname(packagedExecutable) : desktopRoot,
      env: {
        ...launchEnv,
        MYOWNNOTION_DESKTOP_STARTUP_TRACE: tracePath,
        MYOWNNOTION_DESKTOP_DEV: "0",
        MYOWNNOTION_DESKTOP_TEST_USER_DATA: userData,
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
  const packageInfo = await app.evaluate(({ app: electronApp }) => ({
    isPackaged: electronApp.isPackaged,
    appPath: electronApp.getAppPath(),
    resourcesPath: process.resourcesPath,
    executablePath: process.execPath,
  }));
  const rejectPackagedLaunch = async (message: string): Promise<never> => {
    await closeProcess(child, () => app.close()).catch(() => {});
    await removeProfile(userData).catch(() => {});
    throw new Error(message);
  };
  if (packaged && !packageInfo.isPackaged) {
    return rejectPackagedLaunch("Packaged desktop journey launched an unpackaged Electron host");
  }
  if (packaged) {
    if (path.resolve(packageInfo.executablePath) !== path.resolve(packagedExecutable)) {
      return rejectPackagedLaunch("Packaged desktop journey launched the wrong executable");
    }
    if (!existsSync(path.join(packageInfo.resourcesPath, "dist", "index.html"))) {
      return rejectPackagedLaunch("Packaged desktop journey is missing its embedded web resources");
    }
    if (!packageInfo.appPath.endsWith("app.asar")) {
      return rejectPackagedLaunch("Packaged desktop journey did not load app.asar");
    }
  }
  let expectedExit = false;
  let unexpectedExitEvidence: Promise<void> | undefined;
  let window: Page | undefined;
  const report = async (
    stage: "unexpected-context-close" | "shutdown-failure" | "native-command-failure",
  ) => {
    const trace = await readFile(tracePath, {
      encoding: "utf8",
      signal: AbortSignal.timeout(500),
    }).catch(() => "");
    console.error(
      `[desktop-test] ${stage}:`,
      JSON.stringify({
        ...nativeShutdownEvidence(child, electronPid, trace),
        startupProbe: packaged ? "unsupported-packaged" : "applied",
        windowClosed: window?.isClosed() ?? null,
      }),
    );
  };
  app.context().once("close", () => {
    if (!expectedExit) unexpectedExitEvidence = report("unexpected-context-close");
  });
  window = await app.firstWindow();
  return {
    app,
    window,
    userData,
    packaged,
    diagnoseFailure: () => report("native-command-failure"),
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
