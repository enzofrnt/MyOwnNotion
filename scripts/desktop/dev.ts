/**
 * Desktop development loop: watch-build main/preload/bootstrap, restart Electron.
 *
 * Renderer HMR comes from the dev stack (`bun run dev:stack`) when the profile
 * points at https://localhost:8443 (recommended) or http://localhost:8080.
 * This script only rebuilds and restarts the Electron host.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { prepareDevElectronHost } from "./prepare-dev-electron.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktopRoot = path.join(repoRoot, "apps/desktop");
const srcDir = path.join(desktopRoot, "src");

let electron: ChildProcess | null = null;
let srcWatcher: ReturnType<typeof watch> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let electronDistOverride: string | undefined;
let electronExtraEnv: Record<string, string> = { MYOWNNOTION_DESKTOP_DEV: "1" };

function buildElectronEnv(): NodeJS.ProcessEnv {
  const electronEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...electronExtraEnv,
  };
  if (electronDistOverride !== undefined) {
    electronEnv["ELECTRON_OVERRIDE_DIST_PATH"] = electronDistOverride;
  }
  return electronEnv;
}

function buildHost(): void {
  const result = spawnSync("bun", ["build.ts"], { cwd: desktopRoot, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Desktop Bun build failed");
}

function startElectron(): void {
  if (electron !== null) {
    electron.removeAllListeners("exit");
    electron.kill("SIGTERM");
    electron = null;
  }
  const electronEnv = buildElectronEnv();
  electron = spawn("bun", ["electron", "."], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: electronEnv,
  });
  electron.on("exit", (code, signal) => {
    electron = null;
    if (shuttingDown) return;
    if (signal === "SIGTERM" || signal === "SIGINT") {
      shutdown(0);
      return;
    }
    if (code !== 0 && code !== null) {
      console.error(
        `Electron exited (${String(code)}). Save a file under apps/desktop/src to relaunch, or restart desktop:dev.`,
      );
    }
  });
}

function scheduleElectronRestart(): void {
  if (shuttingDown) return;
  if (restartTimer !== null) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    console.info("[desktop:dev] Restarting Electron after host source change…");
    try {
      buildHost();
      startElectron();
    } catch {
      console.error("Desktop rebuild failed; the current host stays available.");
    }
  }, 300);
}

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer !== null) clearTimeout(restartTimer);
  srcWatcher?.close();
  electron?.kill("SIGTERM");
  process.exit(code);
}

async function probeDevStack(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  buildHost();

  const host = await prepareDevElectronHost();
  electronDistOverride = host.overrideDistPath ?? undefined;
  electronExtraEnv = { MYOWNNOTION_DESKTOP_DEV: "1" };
  if (host.touchIdReady) {
    electronExtraEnv["MYOWNNOTION_DESKTOP_TOUCH_ID"] = "1";
  }

  srcWatcher = watch(srcDir, { recursive: true }, (_event, filename) => {
    if (filename === null || !/\.tsx?$/i.test(filename)) return;
    scheduleElectronRestart();
  });

  startElectron();

  const devOrigin = process.env["MYOWNNOTION_DESKTOP_DEV_URL"] ?? "https://localhost:8443";
  const stackReady = await probeDevStack(devOrigin);
  if (stackReady) {
    console.info(
      `[desktop:dev] UI HMR active via dev:stack at ${devOrigin} (same as the browser).`,
    );
  } else {
    console.warn(
      `[desktop:dev] dev:stack not reachable at ${devOrigin}. Run \`bun run dev:stack\` in another terminal for UI hot reload.`,
    );
  }
  console.info("[desktop:dev] Host watch active. Electron restarts on apps/desktop/src changes.");
}

boot().catch((error: unknown) => {
  console.error("[desktop:dev] Failed to start.", error);
  process.exit(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
