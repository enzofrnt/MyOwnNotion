import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const bootstrapJs = path.join(desktopRoot, ".vite", "build", "bootstrap.js");
const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));

export interface DesktopElectronSession {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly userData: string;
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
  const window = await app.firstWindow();
  return {
    app,
    window,
    userData,
    close: async (options) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              app.process().kill("SIGKILL");
              resolve();
            }, 5000);
          }),
        ]);
      } catch {
        // The host may already have exited after a forced restart.
      }
      if (timer !== undefined) clearTimeout(timer);
      if (options?.keepUserData !== true) {
        rmSync(userData, { recursive: true, force: true });
      }
    },
  };
}
