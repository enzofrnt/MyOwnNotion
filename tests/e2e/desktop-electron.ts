import { type ChildProcess, execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const bootstrapJs = path.join(desktopRoot, ".vite", "build", "bootstrap.js");
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

export interface DesktopElectronSession {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly userData: string;
  crash(): Promise<void>;
  close(options?: { readonly keepUserData?: boolean }): Promise<void>;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function crashProcess(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return;
  const pid = child.pid;
  if (pid === undefined) throw new Error("Missing native test process identity");
  // Windows does not terminate descendants when ChildProcess.kill kills the
  // host. Chromium children can retain the profile lock and survive a restart.
  if (process.platform === "win32") {
    await promisify(execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000,
    }).catch((error: unknown) => {
      if (!hasExited(child)) throw error;
    });
  } else child.kill("SIGKILL");
  if (hasExited(child)) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("exit", done);
      reject(new Error("Native test process did not exit after forced termination"));
    }, 10_000);
    child.once("exit", done);
  });
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
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [bootstrapPath, `--user-data-dir=${userData}`],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MYOWNNOTION_DESKTOP_DEV: "0",
      MYOWNNOTION_DESKTOP_TEST_USER_DATA: userData,
      MYOWNNOTION_REPO_ROOT: repoRoot,
      MYOWNNOTION_WEB_DIST: path.join(repoRoot, "apps", "web", "dist"),
    },
  });
  const child = app.process();
  const window = await app.firstWindow();
  return {
    app,
    window,
    userData,
    crash: () => crashProcess(child),
    close: async (options) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const closed = await Promise.race([
          app.close().then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 5000);
          }),
        ]);
        if (!closed || !hasExited(child)) await crashProcess(child);
      } catch {
        // The host may already have exited after a forced restart.
        await crashProcess(child);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (options?.keepUserData !== true) {
        // Windows may release native file handles just after process exit.
        await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  };
}
