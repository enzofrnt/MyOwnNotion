/**
 * Reload-offline, mutate-offline, reconnect, and conflict Playwright
 * journeys (T038, US6, SC-012/SC-014).
 *
 * API unavailability is simulated by aborting every /v1 and /health route;
 * the web shell itself stays reachable, matching "the server becomes
 * unreachable" from the spec.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationRowVisible,
  openSecondDevice,
  openWorkspace,
  openWorkspaceDiagnostics,
  returnToWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function blockWorkspaceApi(page: Page): Promise<void> {
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
}

async function unblockWorkspaceApi(page: Page): Promise<void> {
  await page.unroute("**/v1/**");
  await page.unroute("**/health");
}

async function setDeviceOffline(page: Page, offline: boolean): Promise<void> {
  await page.context().setOffline(offline);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
}

test.describe("offline continuity (US6)", () => {
  test("loaded content stays readable and editable offline, then reconciles once", async ({
    page,
  }) => {
    // 1. Load online and create content.
    await openWorkspace(page);
    const loaded = uniqueName("LoadedOnline");
    await createRootItem(page, "folder", loaded);
    await waitForSynchronized(page);

    // 2. Server disappears; the client reloads.
    await blockWorkspaceApi(page);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    // Loaded hierarchy remains readable from the durable projection.
    await ensureNavigationRowVisible(page, loaded);
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");

    // 3. Mutations offline: create and rename with durable pending entries.
    const offlineItem = uniqueName("CreatedOffline");
    await createRootItem(page, "folder", offlineItem);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // 4. Restart the client while still offline: state and queue survive.
    await page.reload();
    // The diagnostics destination survives reload by design. Re-enter the
    // retained workspace explicitly before checking its offline hierarchy.
    await returnToWorkspace(page);
    await ensureNavigationRowVisible(page, offlineItem);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // 5. Reconnect: the outbox submits idempotently and drains.
    await unblockWorkspaceApi(page);
    await page.reload();
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    await waitForSynchronized(page);
    await expect(page.getByTestId("mutation-status-empty")).toBeVisible();
    await returnToWorkspace(page);
    await ensureNavigationRowVisible(page, offlineItem);
  });

  test("a legacy offline branch joins the operational page without replacing either edit", async ({
    page,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(page);
      const pageName = uniqueName("LegacyBranch");
      await createRootItem(page, "page", pageName);
      await waitForSynchronized(page);

      // Offline before the first editor open deliberately creates the migration
      // branch. Its complete local snapshot is input to a one-way conversion,
      // never a replacement request against the newer server head.
      // A page has two server paths now: ordinary HTTP and the persistent
      // operational WebSocket. Browser-context offline mode closes both and
      // emits the real lifecycle event; aborting fetches alone would leave the
      // page socket connected and would not create an offline branch at all.
      await setDeviceOffline(page, true);
      await selectItem(page, pageName);
      await typeIntoEditor(page, "words written on the offline device");
      await saveDocument(page);

      // A genuinely separate device activates the operational protocol and
      // advances the same page while the first one remains disconnected.
      await openWorkspace(second.page);
      await selectItem(second.page, pageName);
      await typeIntoEditor(second.page, "words written on the online device");
      await saveDocument(second.page, { until: "synced" });

      await setDeviceOffline(page, false);
      await page.reload();
      await openWorkspace(page);
      await selectItem(page, pageName);
      await saveDocument(page, { until: "synced" });
      await expect(page.getByTestId("block-editor")).toContainText("offline device", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("block-editor")).toContainText("online device");
      await expect(page.getByTestId("conflict-notice")).toHaveCount(0);

      await second.page.reload();
      await openWorkspace(second.page);
      await selectItem(second.page, pageName);
      await expect(second.page.getByTestId("block-editor")).toContainText("offline device", {
        timeout: 30_000,
      });
      await expect(second.page.getByTestId("block-editor")).toContainText("online device");
    } finally {
      await second.context.close();
    }
  });
});
