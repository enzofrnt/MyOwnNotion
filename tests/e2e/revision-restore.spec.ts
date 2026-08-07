/**
 * Retained-revision restore and stale-head conflict journeys (T080, US5).
 */
import { expect, test } from "@playwright/test";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

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
    const saved = page.waitForResponse(
      (response) => response.url().includes("/v1/mutations/batch") && response.ok(),
    );
    await page.getByRole("textbox", { name: "Page content" }).fill("Version 2 content");
    await page.getByRole("button", { name: "Save page" }).click();
    await saved;
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
    await openWorkspace(page);
    const pageName = uniqueName("StaleHeadPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await selectItem(page, pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit once so the original head is restorable history.
    const saved = page.waitForResponse(
      (response) => response.url().includes("/v1/mutations/batch") && response.ok(),
    );
    await page.getByRole("textbox", { name: "Page content" }).fill("Version two");
    await page.getByRole("button", { name: "Save page" }).click();
    await saved;
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Preview the original revision.
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible();

    // Another device advances the head between preview and restore.
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
            content: [{ type: "paragraph", content: [{ type: "text", text: "Competing edit" }] }],
          },
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
