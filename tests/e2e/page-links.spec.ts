/** Internal page links stay distinct from hierarchy children. */
import type { Locator, Page } from "@playwright/test";
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
  saveDocument,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const PAGE_LINK_PREFIX = "#page=";

function editorSurface(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function pageLinks(page: Page): Locator {
  return editorSurface(page).locator(`a[href^="${PAGE_LINK_PREFIX}"]`);
}

async function linkSelectionToPage(page: Page, targetName: string): Promise<void> {
  const toolbar = page.locator(".bn-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Lien vers une page" }).click();
  const picker = page.locator(".editor-page-link-picker");
  await expect(picker).toBeVisible();
  await picker.getByLabel("Lien vers une page").fill(targetName);
  await picker.getByRole("option", { name: targetName, exact: true }).click();
  await expect(picker).toBeHidden();
}

async function selectPreviousWord(page: Page, expected: string): Promise<void> {
  // `pressSequentially` has dispatched the DOM input when it returns, but the
  // BlockNote adapter may still be publishing that final change. Selecting in
  // the same task can then be replaced by the durable projection, leaving a
  // caret and no formatting toolbar. Start the selection only after the typed
  // word has crossed the local durability boundary.
  await saveDocument(page);
  await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""), {
      message: `the editor did not select ${expected}`,
    })
    .toBe(expected);
}

async function appendLinkedParagraph(page: Page, label: string, targetName: string): Promise<void> {
  const editor = editorSurface(page);
  await editor.locator(":scope > .bn-block-group > .bn-block-outer[data-id]").last().hover();
  await page.getByRole("button", { name: "Ajouter un bloc" }).click();
  const addMenu = page.getByRole("listbox");
  await expect(addMenu).toBeVisible();
  await addMenu.getByRole("option", { name: /^Paragraphe/u }).click();
  await expect(addMenu).toBeHidden();
  await expect(editor).toBeFocused();
  await editor.pressSequentially(label);
  await selectPreviousWord(page, label);
  await linkSelectionToPage(page, targetName);
}

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

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("référence");
  await selectPreviousWord(page, "référence");
  await linkSelectionToPage(page, reference);
  await saveDocument(page, { until: "synced" });
  await waitForSynchronized(page);

  const targetHref = await pageLinks(page).first().getAttribute("href");
  if (targetHref === null || !targetHref.startsWith(PAGE_LINK_PREFIX)) {
    throw new Error("Le lien de page doit conserver une cible interne stable.");
  }
  const targetId = targetHref.slice(PAGE_LINK_PREFIX.length);
  expect(targetId).not.toBe("");
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
  await pageLinks(page).first().click();
  await expect(page.getByTestId(`tree-item-${reference}`)).toHaveAttribute("aria-selected", "true");
  await selectItem(page, source);

  await appendLinkedParagraph(page, "enfant", child);
  await saveDocument(page, { until: "synced" });
  await waitForSynchronized(page);
  await expect(pageLinks(page)).toHaveCount(2);
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
  await expect(pageLinks(page).first()).toHaveAttribute("href", targetHref);

  // Durable reload keeps the typed link separate from the tree placement.
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(pageLinks(page).first()).toHaveAttribute("href", targetHref);
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toHaveCount(1);

  // Once both endpoints are in the local projection, following the link does
  // not require the server. The converted folder is selected by the same ID.
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await pageLinks(page).first().click();
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.unroute("**/v1/**");
});
