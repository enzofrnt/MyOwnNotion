/** Internal page links stay distinct from hierarchy children. */
import { expect, test } from "./fixtures.ts";
import {
  convertItem,
  createChildItem,
  createRootItem,
  ensureNavigationRowVisible,
  ensureNavigationVisible,
  moveSelectedItemInto,
  openWorkspace,
  renameItem,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("links to another page without nesting it, including a descendant", async ({ page }) => {
  await openWorkspace(page);
  const source = uniqueName("Source");
  const child = uniqueName("Child");
  const reference = uniqueName("Reference");
  const destination = uniqueName("Destination");
  await createRootItem(page, "page", source);
  await createChildItem(page, source, "page", child);
  await createRootItem(page, "page", reference);
  await createRootItem(page, "folder", destination);
  // Let the creation queue settle before interacting with editor-local state.
  // A late reconciliation remounts this control and intentionally resets its
  // selected target, which can otherwise disable the insert button mid-click.
  await waitForSynchronized(page);
  await selectItem(page, source);

  const linkTarget = page.getByLabel("Page link target", { exact: true });
  await linkTarget.selectOption({ label: `${reference} (page)` });
  await page.getByRole("button", { name: "Insert page link" }).click();
  await page.getByTestId("save-document").click();
  await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
  await waitForSynchronized(page);

  const targetId = await page.locator(".page-link").getAttribute("data-page-link-target");
  expect(targetId).toBeTruthy();
  const childRow = page.getByTestId(`tree-item-${child}`);
  // The link insertion can reconcile the tree with the source branch
  // collapsed. Expand it before asserting placement: absence from a collapsed
  // DOM branch is not absence from the hierarchy.
  if ((await childRow.count()) === 0) {
    await page.getByRole("button", { name: `Expand ${source}` }).click();
  }
  await expect(childRow).toHaveCount(1);
  await expect(page.getByTestId(`tree-item-${reference}`)).toHaveCount(1);

  // A page link is usable navigation, not merely decorated text.
  await page.locator(".page-link").click();
  await expect(page.getByTestId(`tree-item-${reference}`)).toHaveAttribute("aria-selected", "true");
  await selectItem(page, source);

  await linkTarget.selectOption({ label: `${child} (page)` });
  await page.getByRole("button", { name: "Insert page link" }).click();
  await page.getByTestId("save-document").click();
  await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
  await waitForSynchronized(page);
  await expect(page.locator(".page-link")).toHaveCount(2);
  await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(1);

  // Moving the target changes only its hierarchy placement.
  await selectItem(page, reference);
  await moveSelectedItemInto(page, destination);
  await waitForSynchronized(page);
  await ensureNavigationVisible(page);
  const destinationRow = page.getByTestId(`tree-item-${destination}`);
  if ((await destinationRow.getAttribute("aria-expanded")) !== "true") {
    await page.getByRole("button", { name: `Expand ${destination}` }).click();
  }
  await ensureNavigationRowVisible(page, reference);

  await renameItem(page, reference, `${reference}-renamed`);
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toBeVisible();
  await selectItem(page, `${reference}-renamed`);
  // Conversion also preserves identity. The target is empty, so page → folder
  // is non-destructive and needs no confirmation.
  await convertItem(page, `${reference}-renamed`);
  await expect(page.getByTestId(`convert-${reference}-renamed`)).toHaveText("to page", {
    timeout: 30_000,
  });
  await waitForSynchronized(page);

  await selectItem(page, source);
  await expect(page.locator(".page-link").first()).toHaveAttribute(
    "data-page-link-target",
    targetId ?? "",
  );

  // Durable reload keeps the typed link separate from the tree placement.
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(page.locator(".page-link").first()).toHaveAttribute(
    "data-page-link-target",
    targetId ?? "",
  );
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toHaveCount(1);

  // Once both endpoints are in the local projection, following the link does
  // not require the server. The converted folder is selected by the same ID.
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.locator(".page-link").first().click();
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.unroute("**/v1/**");
});
