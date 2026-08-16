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
    await expect(page.getByTestId("attachments-empty")).toBeVisible();

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

test.describe("what a page says about its files (US1)", () => {
  /** Attaches one file to the open page and waits for it to appear. */
  async function attach(
    page: import("@playwright/test").Page,
    name: string,
    body: string,
  ): Promise<void> {
    await page.getByTestId("attachment-upload").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(body),
    });
    await expect(page.getByTestId(`attachment-${name}`)).toBeVisible({ timeout: 30_000 });
  }

  test("states type, size, location, availability and sync state for each file", async ({
    page,
  }) => {
    // FR-002 asks for nine fields, and the last three are the reason the list
    // exists: name and size make a file recognisable, but availability and sync
    // state are what make it safe to rely on.
    const pageName = uniqueName("FileFields");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    const fileName = uniqueName("fields") + ".txt";
    await attach(page, fileName, "some bytes");

    await expect(page.getByTestId(`attachment-type-${fileName}`)).toContainText("text/plain");
    await expect(page.getByTestId(`attachment-size-${fileName}`)).not.toBeEmpty();
    await expect(page.getByTestId(`attachment-location-${fileName}`)).not.toBeEmpty();
    await expect(page.getByTestId(`attachment-sync-${fileName}`)).toContainText(/synchronized/i);

    // Never "missing": content the server holds is not lost because a device
    // has not fetched it, and the three states are distinct for that reason.
    const availability = page.getByTestId(`attachment-availability-${fileName}`);
    await expect(availability).toBeVisible();
    await expect(availability).not.toContainText(/missing/i);
  });

  test("names what uses a file, and each usage opens", async ({ page }) => {
    // FR-005. A list of names that cannot be opened leaves the owner to find
    // them by hand, which is the same as not having the list.
    const first = uniqueName("UsesFileA");
    await openWorkspace(page);
    await createRootItem(page, "page", first);
    await waitForSynchronized(page);
    await selectItem(page, first);

    const fileName = uniqueName("shared") + ".txt";
    await attach(page, fileName, "shared bytes");
    await waitForSynchronized(page);

    const usages = page.getByTestId(`attachment-usages-${fileName}`);
    await expect(usages).toBeVisible();
    await expect(usages).toContainText(first);

    await page.getByTestId(`attachment-usage-${first}`).click();
    await expect(page.getByTestId(`tree-item-${first}`)).toHaveAttribute("aria-selected", "true");
  });

  test("says so plainly when a page carries no files", async ({ page }) => {
    const pageName = uniqueName("NoFiles");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    // Blank space would read as "loading" just as easily as "empty".
    await expect(page.getByTestId("attachments-empty")).toBeVisible();
  });
});
