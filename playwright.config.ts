import { defineConfig, devices } from "@playwright/test";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);
const webPort = Number(process.env["MYOWNNOTION_WEB_PORT"] ?? 5173);

/**
 * Every changed interactive flow gets a journey here, executed against
 * Chromium, Firefox, and WebKit in desktop and mobile-sized projects.
 * CI forbids focused tests, uses deterministic workers, and retains
 * reports plus traces for failures.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter @myownnotion/api run dev",
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        MYOWNNOTION_API_PORT: String(apiPort),
        DATABASE_URL:
          process.env["DATABASE_URL"] ??
          "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion",
        MYOWNNOTION_BLOB_ROOT: process.env["MYOWNNOTION_BLOB_ROOT"] ?? "./.dev-blobs",
      },
    },
    {
      command: "pnpm --filter @myownnotion/web run dev",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        MYOWNNOTION_WEB_PORT: String(webPort),
        MYOWNNOTION_API_URL: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
