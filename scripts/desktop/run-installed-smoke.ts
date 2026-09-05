/** Launch the packaged executable with a disposable profile; never use owner data. */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packageRoot = path.join(
  repoRoot,
  "apps/desktop/out",
  `MyOwnNotion-${process.platform}-${process.arch}`,
);
const defaultExecutable =
  process.platform === "darwin"
    ? path.join(packageRoot, "MyOwnNotion.app/Contents/MacOS/MyOwnNotion")
    : path.join(packageRoot, process.platform === "win32" ? "MyOwnNotion.exe" : "MyOwnNotion");
const executablePath = process.env["MYOWNNOTION_DESKTOP_SMOKE_EXECUTABLE"] ?? defaultExecutable;
const profile = await mkdtemp(path.join(os.tmpdir(), "myownnotion-installed-smoke-"));
let host: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  host = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    timeout: 30_000,
  });
  const window = await host.firstWindow();
  await expect(window.getByTestId("desktop-connection-page")).toBeVisible();
  const isolation = await host.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Missing packaged window");
    return {
      packaged: app.isPackaged,
      version: app.getVersion(),
      architecture: process.arch,
      profile: app.getPath("userData"),
      preferences: (
        window.webContents as unknown as {
          getLastWebPreferences(): {
            nodeIntegration: boolean;
            contextIsolation: boolean;
            sandbox: boolean;
          };
        }
      ).getLastWebPreferences(),
    };
  });
  if (
    isolation.architecture !== process.arch ||
    !isolation.packaged ||
    isolation.profile !== profile ||
    isolation.preferences?.nodeIntegration !== false ||
    isolation.preferences.contextIsolation !== true ||
    isolation.preferences.sandbox !== true
  ) {
    throw new Error("Packaged host isolation failed");
  }
  expect(
    await window.evaluate(() => typeof (globalThis as unknown as { require?: unknown }).require),
  ).toBe("undefined");
  await window.keyboard.press("Tab");
  await expect(window.getByLabel("Adresse du serveur")).toBeFocused();
  console.info(
    JSON.stringify({
      ok: true,
      platform: process.platform,
      architecture: process.arch,
      version: isolation.version,
      packaged: true,
    }),
  );
} finally {
  if (host !== undefined) {
    const app = host;
    const timer = setTimeout(() => app.process().kill("SIGKILL"), 5000);
    try {
      await app.close();
    } finally {
      clearTimeout(timer);
    }
  }
  await rm(profile, { recursive: true, force: true });
}
