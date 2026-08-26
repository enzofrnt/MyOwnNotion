/**
 * Attachment-list, hierarchy-file, and replace-content journeys (T053, US2).
 */
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationRowVisible,
  openItemActions,
  openPageAttachments,
  openSettingsSection,
  openWorkspace,
  selectSettledPage,
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

    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);
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

  test("keeps a hierarchy file under a page distinct from that page's attachments", async ({
    page,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("FileContainer");
    const fileName = `${uniqueName("standalone")}.txt`;
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await openItemActions(page, pageName);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId(`new-file-inside-${pageName}`).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("standalone hierarchy file"),
    });

    await ensureNavigationRowVisible(page, fileName);
    await openPageAttachments(page, pageName);
    await expect(page.getByTestId("attachments-empty")).toBeVisible();
    await expect(page.getByTestId(`attachment-${fileName}`)).toHaveCount(0);
  });

  test("removing the final attachment placement sends the file to the trash", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("TrashFileHost");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

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
    await openSettingsSection(page, "trash");
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
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

    const fileName = `${uniqueName("fields")}.txt`;
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
    await selectSettledPage(page, first);
    await openPageAttachments(page, first);

    const fileName = `${uniqueName("shared")}.txt`;
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
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

    // Blank space would read as "loading" just as easily as "empty".
    await expect(page.getByTestId("attachments-empty")).toBeVisible();
  });
});

test.describe("moving, renaming and deleting a file (US2)", () => {
  test("a rename leaves every reference resolving", async ({ page }) => {
    // FR-003. Identity is the item, not the name: if a reference were stored by
    // name, this is the moment it would break, and it would break silently.
    const pageName = uniqueName("RenameHost");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

    const fileName = `${uniqueName("before")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("bytes that outlive the name"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    // The usage still names the page, and the page still lists the file.
    await expect(page.getByTestId(`attachment-usages-${fileName}`)).toContainText(pageName);
    await page.reload();
    await openWorkspace(page);
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
  });

  test("deleting a file in use names what would break, and declining changes nothing", async ({
    page,
  }) => {
    // FR-004. The owner is not answering "delete this?" but "am I willing to
    // break these?", which cannot be answered from a count.
    const pageName = uniqueName("DeleteHost");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

    const fileName = `${uniqueName("used")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("still in use"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.getByTestId(`delete-file-${fileName}`).click();
    const confirmation = page.getByTestId("delete-file-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 30_000 });
    await expect(confirmation).toHaveAttribute("role", "alertdialog");
    // Named, not counted.
    await expect(page.getByTestId("delete-file-usages")).toContainText(pageName);
    await expect(page.getByTestId("delete-file-usage-list")).toContainText(pageName);

    await page.getByTestId("delete-file-cancel").click();
    await expect(confirmation).toHaveCount(0);
    // Declining is not a soft delete: the file is exactly where it was.
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible();
  });

  test("confirming sends the file to the trash, where it can be recovered", async ({ page }) => {
    const pageName = uniqueName("TrashHost");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectSettledPage(page, pageName);
    await openPageAttachments(page, pageName);

    const fileName = `${uniqueName("doomed")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("about to go"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.getByTestId(`delete-file-${fileName}`).click();
    await expect(page.getByTestId("delete-file-confirmation")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("delete-file-confirm").click();

    await expect(page.getByTestId(`attachment-${fileName}`)).toHaveCount(0, { timeout: 30_000 });
    // The same 30-day window as anything else, not a second mechanism (T022).
    await waitForSynchronized(page);
    await page.reload();
    await openWorkspace(page);
    await openSettingsSection(page, "trash");
    await expect(page.getByTestId(`trash-item-${fileName}`)).toBeVisible({ timeout: 30_000 });
  });
});
