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

/**
 * Reads the durable record of which local account this device opened last.
 *
 * Feature 058 names each account's local store after the account id. The DOM
 * store is only its fast copy: Chromium commits `localStorage` on its own
 * schedule, so a process killed between the write and the commit restarts with
 * no remembered id — the exact state this journey reproduces on purpose. The
 * record the next boot reads must therefore be committed before the fast copy
 * is removed; this reads it as the application wrote it.
 */
async function durableLocalAccount(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const opened = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open("myownnotion-local-accounts", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (opened === null) return null;
    try {
      return await new Promise<string | null>((resolve) => {
        let remembered: string | null = null;
        const transaction = opened.transaction("meta", "readonly");
        const request = transaction.objectStore("meta").get("last-account");
        request.onsuccess = () => {
          remembered = typeof request.result === "string" ? request.result : null;
        };
        transaction.oncomplete = () => resolve(remembered);
        transaction.onabort = transaction.onerror = () => resolve(null);
      });
    } finally {
      opened.close();
    }
  });
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
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.().getSnapshot().syncState ?? null,
        ),
      )
      .toBe("offline");

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

  /**
   * Feature 058 regression: an offline start must open the account's local
   * store, not the empty legacy one.
   *
   * The account was remembered in `localStorage`, which is a cache: Chromium
   * commits it on its own schedule, and the packaged desktop crash journey
   * (`desktop-offline-restart.spec.ts`) restarts after a `SIGKILL` with that
   * write gone. This journey produces the same post-death state without a
   * native host — the durable projection and queue stay, the remembered id is
   * removed — and proves the offline workspace still finds the content.
   */
  test("an offline reload resumes the account's local content when the remembered id was not committed", async ({
    page,
  }) => {
    await openWorkspace(page);
    const loaded = uniqueName("ResumedOffline");
    await createRootItem(page, "folder", loaded);
    await waitForSynchronized(page);

    // Precondition: the device committed which account owns the local content.
    const accountId = await page.evaluate(() => localStorage.getItem("myownnotion-last-account"));
    expect(accountId, "the account is remembered for this device").not.toBeNull();
    await expect
      .poll(() => durableLocalAccount(page), {
        message: "the device records its local account durably",
        timeout: 15_000,
      })
      .toBe(accountId);

    // Simulate a process that died before DOM storage reached disk.
    await page.evaluate(() => localStorage.removeItem("myownnotion-last-account"));
    await blockWorkspaceApi(page);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();

    // An empty fallback store renders its offline state instead of the tree.
    await ensureNavigationRowVisible(page, loaded);
    await expect(page.getByTestId("workspace-state-offline")).toHaveCount(0);
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
      await expect(page.locator('[data-testid="block-editor"]:visible')).toContainText(
        "offline device",
        {
          timeout: 30_000,
        },
      );
      await expect(page.locator('[data-testid="block-editor"]:visible')).toContainText(
        "online device",
      );

      await second.page.reload();
      await openWorkspace(second.page);
      await selectItem(second.page, pageName);
      await expect(second.page.locator('[data-testid="block-editor"]:visible')).toContainText(
        "offline device",
        {
          timeout: 30_000,
        },
      );
      await expect(second.page.locator('[data-testid="block-editor"]:visible')).toContainText(
        "online device",
      );
    } finally {
      await second.context.close();
    }
  });
});
