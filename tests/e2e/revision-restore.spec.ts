/**
 * Retained-revision restore and stale-head conflict journeys (T080, US5).
 */
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("revision history (US5)", () => {
  test("restores retained content as a new descendant revision", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("HistoryPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    // Select the page; note the original head.
    await selectItem(page, pageName);
    await expect(page.getByTestId("revision-restore")).toBeVisible();
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit the document to supersede the original revision.
    await typeIntoEditor(page, "version 2");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible();
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Preview and restore the superseded revision (retained 24h).
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("revision-snapshot")).toContainText(pageName);

    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("history unchanged", {
      timeout: 15_000,
    });
  });

  test("a stale head yields an explicit conflict instead of silent overwrite", async ({
    page,
    request,
  }) => {
    // The stream is cut before anything else, because this journey is about a
    // head that is stale *in the interface*. With live synchronization a
    // connected tab hears the competing edit below within a second and stops
    // being stale, which is an improvement and not what is under test here.
    // Cutting only the stream leaves every other request working, so the restore
    // still reaches the server and is refused for the reason it should be.
    await page.route("**/v1/changes/stream", (route) => route.abort("connectionrefused"));

    await openWorkspace(page);
    const pageName = uniqueName("StaleHeadPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await selectItem(page, pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit once so the original head is restorable history.
    await typeIntoEditor(page, "v2");
    await page.getByTestId("save-document").click();
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Preview the original revision.
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible();

    // Another device advances the head between preview and restore.
    const current = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(`http://127.0.0.1:3001/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        baseRevisionId: currentBody.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { text: "competing edit" },
        },
      },
    });
    expect(competing.status()).toBe(200);

    // Restore now conflicts explicitly (the UI's head is stale).
    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText("current head changed", {
      timeout: 15_000,
    });
  });
});
