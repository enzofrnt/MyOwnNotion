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
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  createRootItem,
  ensureNavigationRowVisible,
  openWorkspace,
  openWorkspaceDiagnostics,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function goOffline(page: Page): Promise<void> {
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
}

async function goOnline(page: Page): Promise<void> {
  await page.unroute("**/v1/**");
  await page.unroute("**/health");
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
    await goOffline(page);
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
    await ensureNavigationRowVisible(page, offlineItem);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // 5. Reconnect: the outbox submits idempotently and drains.
    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    await waitForSynchronized(page);
    await expect(page.getByTestId("mutation-status-empty")).toBeVisible();
    await ensureNavigationRowVisible(page, offlineItem);
  });

  test("a competing server revision produces a durable conflict record", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("ConflictPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    // Select the page and note its identity.
    await selectItem(page, pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    await expect(page.getByTestId("block-editor")).toBeVisible();

    // Go offline and edit the document locally.
    await goOffline(page);
    await typeIntoEditor(page, "offline edit");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible();

    // Meanwhile the server accepts a competing revision (another device).
    const current = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": crypto.randomUUID() },
      data: {
        baseRevisionId: currentBody.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { text: "server edit" },
        },
      },
    });
    expect(competing.status()).toBe(200);

    // Reconnect: the local mutation conflicts and is captured durably.
    await page.unroute("**/v1/**");
    await page.reload();
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("conflict-records")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "conflict");
    // The conflict names the competing revision explicitly.
    await expect(page.getByTestId("conflict-records")).toContainText("competing revision");
  });
});
