import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { BROWSER_PROJECTS } from "./tests/e2e/projects.ts";

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);
const webPort = Number(process.env["MYOWNNOTION_WEB_PORT"] ?? 5173);

/**
 * Security journeys run against the loopback HTTP cookie exception: the API
 * issues the separate opaque `mn_dev_session` cookie and must never issue or
 * accept `__Host-mn_session` over HTTP. The deployment wrapping key is a
 * mounted file created by global setup; only its path is passed here.
 */
/**
 * `localhost`, not `127.0.0.1`.
 *
 * WebAuthn requires the relying-party id to be a registrable domain, and an IP
 * address is not one — a passkey ceremony against `127.0.0.1` fails with
 * `SecurityError` before it reaches the authenticator. `localhost` is both a
 * valid relying-party id and a secure context, so the bootstrap journeys can
 * drive a real ceremony. It is also loopback, which the API's HTTP-cookie
 * exception requires.
 */
const webHost = process.env["MYOWNNOTION_WEB_HOST"] ?? "localhost";
const publicOrigin = process.env["MYOWNNOTION_PUBLIC_ORIGIN"] ?? `http://${webHost}:${webPort}`;
const deploymentKeyFile =
  process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"] ?? path.resolve("secrets", "deployment-key.e2e");
const backupRoot = process.env["MYOWNNOTION_BACKUP_ROOT"] ?? path.resolve(".dev-backups-e2e");

/**
 * Browser/viewport matrix: Chromium, Firefox, and WebKit, desktop and mobile.
 *
 * Imported rather than written here, because the local parallel runner allocates
 * one isolated stack per project and must be looking at the same list.
 */

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
  // One retry absorbs genuine infrastructure noise, but `bun run test:e2e` passes
  // `--fail-on-flaky-tests`: a journey that only passes on retry still fails
  // the gate. A green run built on retries hides real defects — that is how a
  // stranded-outbox race survived several merges.
  retries: isCI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://${webHost}:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Content isolation is per test, via the auto fixture in
  // tests/e2e/fixtures.ts — Playwright project dependencies run all at once
  // up front and so cannot isolate one project from another (T106).
  // Every project is declared on every platform, deliberately. A project list
  // that changed with the host would make "CI runs all five" unverifiable from a
  // developer machine — and one of the contract tests checks exactly that.
  // Engines assigned to the pinned Linux runtime on macOS are refused at the
  // start of a raw test instead, in tests/e2e/fixtures.ts, where the failure can
  // direct the caller to the isolated local matrix.
  // Desktop Electron journeys (`tests/e2e/desktop-*.spec.ts`) skip unless
  // MYOWNNOTION_DESKTOP_E2E=1. They launch the packaged host via Playwright's
  // Electron API and stay off the five browser/viewport projects.
  projects: BROWSER_PROJECTS.map(({ name, device }) => ({
    name,
    // Linux WebKit can occasionally spend more than a minute inside its own
    // `browser.newPage()` before application code starts. Its three recycled
    // container shards bound that engine state; this wider total watchdog lets
    // the engine return without weakening the 10–30 second functional waits.
    timeout: name.startsWith("webkit-") ? 120_000 : 60_000,
    use: { ...devices[device] },
  })),
  webServer: [
    {
      command: "bun run --filter @myownnotion/api dev",
      url: `http://127.0.0.1:${apiPort}/health`,
      stdout: process.env["MYOWNNOTION_E2E_SERVER_STDOUT"] === "1" ? "pipe" : "ignore",
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        MYOWNNOTION_API_PORT: String(apiPort),
        DATABASE_URL:
          process.env["DATABASE_URL"] ??
          "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion",
        MYOWNNOTION_BLOB_ROOT: process.env["MYOWNNOTION_BLOB_ROOT"] ?? "./.dev-blobs",
        MYOWNNOTION_BACKUP_ROOT: backupRoot,
        MYOWNNOTION_PUBLIC_ORIGIN: publicOrigin,
        MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: deploymentKeyFile,
      },
    },
    {
      // The caller builds the web application once before the browser matrix.
      // Serving the production bundle keeps the journey faithful to delivery
      // and avoids a cold browser fetching hundreds of Vite source modules.
      command: "bun run --filter @myownnotion/web preview",
      url: `http://${webHost}:${webPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        MYOWNNOTION_WEB_HOST: webHost,
        MYOWNNOTION_WEB_PORT: String(webPort),
        MYOWNNOTION_API_URL: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
