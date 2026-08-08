import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DOCUMENT_BYTES, SAFE_PNG_BYTES } from "../fixtures/files-storage.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function importImage(page: Parameters<typeof openWorkspace>[0], name: string): Promise<void> {
  await page.getByTestId("attachment-upload").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(SAFE_PNG_BYTES),
  });
  await expect(page.getByTestId(`attachment-${name}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel(`Metadata for ${name}`)).toContainText("image/png", {
    timeout: 15_000,
  });
}

test.describe("private file preview, reuse, and offline revision cache", () => {
  test("previews, downloads, reuses, replaces, zooms, and remains accessible", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const firstPage = uniqueName("AttachmentSource");
    const secondPage = uniqueName("AttachmentReuse");
    const fileName = `${uniqueName("private-image")}.png`;
    const documentName = `${uniqueName("private-document")}.txt`;
    await createRootItem(page, "page", firstPage);
    await createRootItem(page, "page", secondPage);
    await waitForSynchronized(page);

    await selectItem(page, firstPage);
    await importImage(page, fileName);
    const firstAttachment = page.getByTestId(`attachment-${fileName}`);
    await firstAttachment.getByRole("button", { name: `Preview ${fileName}` }).click();
    await expect(
      firstAttachment.getByRole("img", { name: `Preview of ${fileName}` }),
    ).toBeVisible();
    await attachReviewScreenshot(page, testInfo, "files-raster-preview");

    const downloadEvent = page.waitForEvent("download");
    await firstAttachment.getByRole("link", { name: `Download ${fileName}` }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(fileName);
    const stream = await download.createReadStream();
    if (stream === null) throw new Error("download stream is unavailable");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(SAFE_PNG_BYTES));

    await page.getByTestId("attachment-upload").setInputFiles({
      name: documentName,
      mimeType: "text/plain",
      buffer: Buffer.from(DOCUMENT_BYTES),
    });
    const documentAttachment = page.getByTestId(`attachment-${documentName}`);
    await expect(documentAttachment.getByLabel(`Metadata for ${documentName}`)).toContainText(
      "text/plain",
      { timeout: 15_000 },
    );
    await expect(
      documentAttachment.getByRole("button", { name: `Preview ${documentName}` }),
    ).toHaveCount(0);
    const documentDownloadEvent = page.waitForEvent("download");
    await documentAttachment.getByRole("link", { name: `Download ${documentName}` }).click();
    const documentDownload = await documentDownloadEvent;
    expect(documentDownload.suggestedFilename()).toBe(documentName);
    const documentStream = await documentDownload.createReadStream();
    if (documentStream === null) throw new Error("document download stream is unavailable");
    const documentChunks: Buffer[] = [];
    for await (const chunk of documentStream) documentChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(documentChunks)).toEqual(Buffer.from(DOCUMENT_BYTES));

    await selectItem(page, secondPage);
    await page.getByLabel("Attach an existing file").fill(fileName);
    await expect(page.getByRole("button", { name: `Attach ${fileName}` })).toBeVisible();
    await attachReviewScreenshot(page, testInfo, "files-existing-reuse");
    await page.getByRole("button", { name: `Attach ${fileName}` }).click();
    const reused = page.getByTestId(`attachment-${fileName}`);
    await expect(reused).toBeVisible({ timeout: 15_000 });
    await expect(reused).toContainText("2 placements");

    const replaced = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes("/v1/files/") &&
        response.url().endsWith("/content") &&
        response.ok(),
    );
    await reused.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: Buffer.from(SAFE_PNG_BYTES),
    });
    await replaced;
    await selectItem(page, firstPage);
    await expect(page.getByTestId(`attachment-${fileName}`)).toContainText("2 placements");

    const originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: originalViewport?.height ?? 720 });
    await expect(page.getByLabel(`Metadata for ${fileName}`)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
    if (originalViewport !== null) await page.setViewportSize(originalViewport);
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="attachment-panel"]')
      .analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    await attachReviewScreenshot(page, testInfo, "files-attachment-metadata");
  });

  test("labels online-only and unavailable content without overflow or critical violations", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("AttachmentStates");
    const onlineOnlyName = `${uniqueName("online-only")}.bin`;
    const unavailableName = `${uniqueName("unavailable")}.bin`;
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    for (const name of [onlineOnlyName, unavailableName]) {
      await page.getByTestId("attachment-upload").setInputFiles({
        name,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(`review fixture for ${name}`),
      });
      await expect(page.getByTestId(`attachment-${name}`)).toBeVisible({ timeout: 15_000 });
    }

    const onlineHref = await page
      .getByRole("link", { name: `Download ${onlineOnlyName}` })
      .getAttribute("href");
    const unavailableHref = await page
      .getByRole("link", { name: `Download ${unavailableName}` })
      .getAttribute("href");
    const onlineItemId = /\/v1\/files\/([^/]+)\/content/.exec(onlineHref ?? "")?.[1];
    const unavailableItemId = /\/v1\/files\/([^/]+)\/content/.exec(unavailableHref ?? "")?.[1];
    if (onlineItemId === undefined || unavailableItemId === undefined) {
      throw new Error("attachment content identity is unavailable");
    }

    await page.route(`**/v1/files/${onlineItemId}/content?*`, async (route) => {
      if (route.request().method() !== "HEAD") return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-length": String(17 * 1024 * 1024),
        },
      });
    });
    await page.route(`**/v1/files/${unavailableItemId}/content?*`, async (route) => {
      if (route.request().method() !== "HEAD") return route.continue();
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://myownnotion.dev/problems/storage.unavailable",
          title: "Private file storage is unavailable",
          status: 503,
          code: "storage.unavailable",
        }),
      });
    });

    await page.reload();
    await selectItem(page, pageName);
    await expect(page.getByTestId(`attachment-${onlineOnlyName}`)).toContainText(
      "Available online only",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(`attachment-${unavailableName}`)).toContainText(
      "File content is currently unavailable",
      { timeout: 15_000 },
    );
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="attachment-panel"]')
      .analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
    await attachReviewScreenshot(page, testInfo, "files-online-only-unavailable");
  });

  test("reloads a previously opened immutable image revision while the API is offline", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
    });
    const pageName = uniqueName("AttachmentOffline");
    const fileName = `${uniqueName("cached-image")}.png`;
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await importImage(page, fileName);
    const attachment = page.getByTestId(`attachment-${fileName}`);
    await attachment.getByRole("button", { name: `Preview ${fileName}` }).click();
    await expect(attachment.getByRole("img", { name: `Preview of ${fileName}` })).toBeVisible();

    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await page.route("**/health", (route) => route.abort("connectionrefused"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible();
    await selectItem(page, pageName);
    const cached = page.getByTestId(`attachment-${fileName}`);
    await expect(cached).toContainText("Cached revision — available offline", { timeout: 15_000 });
    await expect(cached.getByRole("img", { name: `Preview of ${fileName}` })).toBeVisible();
    await attachReviewScreenshot(page, testInfo, "files-offline-cache");
  });
});
