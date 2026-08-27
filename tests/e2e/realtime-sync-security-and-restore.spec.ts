/** Security, proxy recovery and restore continuity for the persistent page channel. */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorChangeSequence,
  openSecondDevice,
  openSettings,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

const run = promisify(execFile);

function editor(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

async function appendText(page: Page, text: string): Promise<void> {
  const before = await editorChangeSequence(page);
  const surface = editor(page);
  const last = editor(page).locator(".bn-inline-content").last();
  if (await last.isVisible()) await last.click();
  else await surface.click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await surface.pressSequentially(text);
  await waitForEditorSettled(page, { afterSequence: before });
}

async function admin(args: readonly string[]): Promise<Record<string, unknown>> {
  const backupRoot = process.env["MYOWNNOTION_BACKUP_ROOT"] ?? path.resolve(".dev-backups-e2e");
  const deploymentKey =
    process.env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"] ?? path.resolve("secrets", "deployment-key.e2e");
  const { stdout } = await run("bun", ["apps/api/src/admin/admin-cli.ts", ...args, "--json"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion",
      MYOWNNOTION_BLOB_ROOT: process.env["MYOWNNOTION_BLOB_ROOT"] ?? ".dev-blobs",
      MYOWNNOTION_BACKUP_ROOT: backupRoot,
      MYOWNNOTION_BACKUP_DESTINATION: "filesystem",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: deploymentKey,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  const line = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (line === undefined) throw new Error(`admin command returned no JSON: ${stdout}`);
  const result = JSON.parse(line) as { ok?: boolean; data?: Record<string, unknown> };
  if (result.ok !== true) throw new Error(`admin command failed: ${line}`);
  return result.data ?? {};
}

test("revoking a device closes all of its live page sockets immediately", async ({
  page,
  browser,
  baseURL,
}) => {
  const deviceName = uniqueName("RevokedRealtimeDevice");
  const second = await openSecondDevice(browser, baseURL, deviceName);
  try {
    await Promise.all([openWorkspace(page), openWorkspace(second.page)]);
    await expect(page.getByTestId("live-connection-state")).toHaveAttribute("data-state", "live");
    await expect(second.page.getByTestId("live-connection-state")).toHaveAttribute(
      "data-state",
      "live",
    );

    await openSettings(page);
    const row = page.getByTestId("device-row").filter({ hasText: deviceName });
    await expect(row).toBeVisible();
    await row.getByTestId("revoke-device").click();
    await expect(page.getByTestId("device-message")).toContainText("no longer reach");

    await expect(second.page.getByTestId("live-connection-state")).toHaveAttribute(
      "data-state",
      "revoked",
      { timeout: 5_000 },
    );
  } finally {
    await second.context.close();
  }
});

test("the same-origin proxy reconnects the page socket after a network interruption", async ({
  page,
  context,
}) => {
  let pageSockets = 0;
  page.on("websocket", (socket) => {
    if (socket.url().endsWith("/v1/page-sync/socket")) pageSockets += 1;
  });
  await openWorkspace(page);
  await expect(page.getByTestId("live-connection-state")).toHaveAttribute("data-state", "live");
  await expect.poll(() => pageSockets).toBeGreaterThanOrEqual(1);

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);

  await expect.poll(() => pageSockets, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("live-connection-state")).toHaveAttribute("data-state", "live");
});

test("a restore accepts newer offline work instead of replacing it", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "the restore protocol is engine-independent and runs once to preserve CI resources",
  );
  const second = await openSecondDevice(browser, baseURL);
  let verifier: Awaited<ReturnType<typeof openSecondDevice>> | null = null;
  try {
    const pageName = uniqueName("RestoreOfflineBranch");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await waitForEditor(page);
    await appendText(page, "base sauvegardée");
    await waitForSynchronized(page);

    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await waitForEditorSettled(second.page);
    const backup = await admin(["backup", "run"]);
    const backupId = String(backup["backupId"] ?? "");
    expect(backupId).not.toBe("");

    await context.setOffline(true);
    await appendText(page, " — travail local après sauvegarde");
    await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-durable", "true");
    await appendText(second.page, " — version serveur à restaurer");
    await waitForSynchronized(second.page);

    await admin(["restore", "apply", "--id", backupId, "--yes"]);
    await second.context.close();
    await context.setOffline(false);
    await waitForSynchronized(page);
    await expect(page.getByTestId("block-editor")).toContainText("travail local après sauvegarde");
    await expect(page.getByTestId("conflict-notice")).toHaveCount(0);

    verifier = await openSecondDevice(browser, baseURL);
    await openWorkspace(verifier.page);
    await selectItem(verifier.page, pageName);
    await waitForEditorSettled(verifier.page);
    await expect(verifier.page.getByTestId("block-editor")).toContainText(
      "travail local après sauvegarde",
    );
    await expect(verifier.page.getByTestId("block-editor")).not.toContainText(
      "version serveur à restaurer",
    );
  } finally {
    await second.context.close().catch(() => undefined);
    await verifier?.context.close().catch(() => undefined);
  }
});
