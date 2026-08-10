/**
 * Attachment-list, hierarchy-file, and replace-content journeys (T053, US2).
 */
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("canonical files (US2)", () => {
  test("imports an attachment, lists it discreetly, and replaces content copy-on-write", async ({
    page,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("FileHost");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await selectItem(page, pageName);
    await expect(page.getByTestId("attachment-panel")).toBeVisible();
    await expect(page.getByTestId("no-attachments")).toBeVisible();

    // Import a file into the page's attachment collection.
    const fileName = `${uniqueName("doc")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("original attachment bytes"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 15_000 });

    // The attachment does not appear in the hierarchy tree (FR-006).
    await expect(page.getByTestId(`tree-item-${fileName}`)).toHaveCount(0);

    // Replace content through this placement: feedback confirms every
    // placement now exposes the new content.
    const replaceInput = page.getByTestId(`attachment-${fileName}`).locator('input[type="file"]');
    await replaceInput.setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("replaced bytes"),
    });
    await expect(page.getByTestId("replace-feedback")).toContainText(
      "every placement of this file now shows the new content",
      { timeout: 15_000 },
    );
  });

  test("removing the final attachment placement sends the file to the trash", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("TrashFileHost");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    const fileName = `${uniqueName("gone")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("final placement bytes"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: `Remove ${fileName} from this page` }).click();
    await expect(page.getByTestId(`attachment-${fileName}`)).toHaveCount(0);

    // The canonical file entered the 30-day trash (after sync refresh).
    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId(`trash-item-${fileName}`)).toBeVisible({ timeout: 15_000 });
  });
});
