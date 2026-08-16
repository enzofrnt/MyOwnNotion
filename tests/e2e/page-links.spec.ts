/** Internal page links stay distinct from hierarchy children. */
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("links to another page without nesting it, including a descendant", async ({ page }) => {
  await openWorkspace(page);
  const source = uniqueName("Source");
  const child = uniqueName("Child");
  const reference = uniqueName("Reference");
  await createRootItem(page, "page", source);
  await createChildItem(page, source, "page", child);
  await createRootItem(page, "page", reference);
  await selectItem(page, source);

  const linkTarget = page.getByLabel("Page link target", { exact: true });
  await linkTarget.selectOption({ label: `${reference} (page)` });
  await page.getByRole("button", { name: "Insert page link" }).click();
  await page.getByTestId("save-document").click();
  await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
  await waitForSynchronized(page);

  const targetId = await page.locator(".page-link").getAttribute("data-page-link-target");
  expect(targetId).toBeTruthy();
  await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(1);
  await expect(page.getByTestId(`tree-item-${reference}`)).toHaveCount(1);

  await linkTarget.selectOption({ label: `${child} (page)` });
  await page.getByRole("button", { name: "Insert page link" }).click();
  await page.getByTestId("save-document").click();
  await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
  await waitForSynchronized(page);
  await expect(page.locator(".page-link")).toHaveCount(2);
  await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(1);

  await page.once("dialog", async (dialog) => dialog.accept(`${reference}-renamed`));
  await page.getByRole("button", { name: `Rename ${reference}` }).click();
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toBeVisible();
  await selectItem(page, `${reference}-renamed`);
  await selectItem(page, source);
  await expect(page.locator(".page-link").first()).toHaveAttribute(
    "data-page-link-target",
    targetId ?? "",
  );
});
