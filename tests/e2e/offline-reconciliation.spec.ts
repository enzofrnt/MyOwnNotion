/**
 * Reload-offline, mutate-offline, reconnect, and conflict Playwright
 * journeys (T038, US6, SC-012/SC-014).
 *
 * API unavailability is simulated with browser offline mode plus aborted
 * /v1 and /health routes so the PWA service worker cannot bypass the outage.
 */
import { expect, test } from "@playwright/test";
import {
  createRootItem,
  goOffline,
  goOnline,
  openWorkspace,
  reloadWhileOffline,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

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
    await reloadWhileOffline(page);
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible();
    // Loaded hierarchy remains readable from the durable projection.
    await expect(page.getByTestId(`tree-item-${loaded}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");

    // 3. Mutations offline: create and rename with durable pending entries.
    const offlineItem = uniqueName("CreatedOffline");
    await createRootItem(page, "folder", offlineItem);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // 4. Restart the client while still offline: state and queue survive.
    await page.reload();
    await expect(page.getByTestId(`tree-item-${offlineItem}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // 5. Reconnect: the outbox submits idempotently and drains.
    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await expect(page.getByTestId(`tree-item-${offlineItem}`)).toBeVisible();
    await expect(page.getByTestId("mutation-status-empty")).toBeVisible();
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
    await expect(page.getByRole("textbox", { name: "Page content" })).toBeVisible();

    // Go offline and edit the document locally.
    await goOffline(page);
    await page.getByRole("textbox", { name: "Page content" }).fill("Offline edit");
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });

    // Meanwhile the server accepts a competing revision (another device).
    const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${itemId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(`http://127.0.0.1:${apiPort}/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        baseRevisionId: currentBody.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Server edit" }] }],
          },
        },
      },
    });
    expect(competing.status()).toBe(200);

    // Reconnect: the local mutation conflicts and is captured durably.
    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId("conflict-records")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "conflict");
    // The conflict names the competing revision explicitly.
    await expect(page.getByTestId("conflict-records")).toContainText("competing revision");
  });
});
