import { expect, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("wiki links (US1)", () => {
  test("inserts, persists, renames, moves, and follows a stable page link", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const sourceName = uniqueName("WikiSource");
    const targetName = uniqueName("WikiTarget");
    const renamedTarget = `${targetName}-renamed`;
    const folderName = uniqueName("WikiFolder");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "folder", folderName);
    await createRootItem(page, "page", sourceName);
    await selectItem(page, sourceName);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.click();
    await page.keyboard.type(`[[${targetName}`);
    const picker = page.getByRole("listbox", { name: "Link to page" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("option", { name: new RegExp(targetName) })).toBeVisible();
    await page.keyboard.press("Enter");
    const link = page.locator("a[data-wiki-link]").filter({ hasText: targetName });
    await expect(link).toBeVisible();
    await expect(editor).toBeFocused();
    await page.keyboard.type("continues");

    await savePageAndSynchronize(page);
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, sourceName);
    await expect(page.locator("a[data-wiki-link]")).toContainText(targetName);
    await attachReviewScreenshot(page, testInfo, "wiki-link-editor");

    await selectItem(page, targetName);
    page.once("dialog", (dialog) => dialog.accept(renamedTarget));
    await page.getByRole("button", { name: `Rename ${targetName}` }).click();
    await expect(page.getByTestId(`tree-item-${renamedTarget}`)).toBeVisible();
    await page.getByRole("button", { name: `Move selected item into ${folderName}` }).click();
    await waitForSynchronized(page);

    await selectItem(page, sourceName);
    const persistedLink = page.locator("a[data-wiki-link]");
    await persistedLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`tree-item-${renamedTarget}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("authors and opens a link with pointer controls", async ({ page }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("WikiPointerSource");
    const targetName = uniqueName("WikiPointerTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await selectItem(page, sourceName);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.fill(`[[${targetName.slice(0, 9)}`);
    await page.getByRole("option", { name: new RegExp(targetName) }).click();
    const link = page.locator("a[data-wiki-link]").filter({ hasText: targetName });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByTestId(`tree-item-${targetName}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("shows an empty result and dismisses the picker without changing content", async ({
    page,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("WikiEmpty");
    await createRootItem(page, "page", sourceName);
    await selectItem(page, sourceName);
    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.fill("[[no-page-can-match-this-query");
    await expect(page.getByText("No matching pages")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Link to page" })).toHaveCount(0);
    await expect(editor).toContainText("[[no-page-can-match-this-query");
  });
});
