/**
 * Playwright global setup: start each end-to-end run from empty canonical
 * content and an empty, pre-bootstrap installation, so journeys are
 * deterministic.
 *
 * Global setup runs once per run, not per project. Per-test isolation comes
 * from the auto fixtures in tests/e2e/fixtures.ts (T106, T003).
 *
 * A run also needs a mounted deployment-key fixture on disk: the API refuses
 * protected reads and writes when the key is unavailable, so without one every
 * security journey would only ever observe the `degraded` state.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resetCanonicalContent } from "./reset-content.ts";
import { resetSecurityInstallation } from "./reset-installation.ts";

/** Creates the local deployment-key fixture unless one is already mounted. */
function ensureDeploymentKey(): void {
  const configured = process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"];
  if (configured !== undefined && existsSync(configured)) {
    return;
  }
  // `secrets/` is gitignored and excluded from every image build context.
  const target = configured ?? path.resolve("secrets", "deployment-key.e2e");
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, `${randomBytes(32).toString("base64")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(target, 0o600);
  process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"] = target;
}

export default async function globalSetup(): Promise<void> {
  ensureDeploymentKey();
  await resetSecurityInstallation();
  await resetCanonicalContent();
}
