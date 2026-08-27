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

function externalLinks(page: Page): Locator {
  return editorSurface(page).locator('a[href^="https://"]');
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
  // Word-navigation modifiers differ between macOS and the Linux browser
  // container. Select the exact suffix character by character so this setup
  // exercises the same editor selection on every supported engine.
  for (const _character of expected) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
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

test("edits and removes a page link from its context menu without deleting text or targets", async ({
  page,
}) => {
  await openWorkspace(page);
  const source = uniqueName("Link lifecycle source");
  const firstTarget = uniqueName("Link lifecycle first");
  const secondTarget = uniqueName("Link lifecycle second");
  await createRootItem(page, "page", source);
  await createRootItem(page, "page", firstTarget);
  await createRootItem(page, "page", secondTarget);
  await waitForSynchronized(page);
  await selectItem(page, source);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("Référence initiale");
  await selectPreviousWord(page, "initiale");
  await linkSelectionToPage(page, firstTarget);
  await saveDocument(page);

  await editor.press("Shift+F10");
  await expect(page.getByTestId("context-edit-link")).toBeVisible();
  await page.keyboard.press("Escape");

  const link = pageLinks(page).first();
  await link.click({ button: "right" });
  await page.getByTestId("context-edit-link").click();
  const dialog = page.getByTestId("link-editor-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Texte affiché").fill("seconde cible");
  await dialog.getByLabel("Page cible").selectOption({ label: secondTarget });
  await dialog.getByTestId("save-editor-link").click();

  const secondTargetId = await page
    .getByTestId(`tree-item-${secondTarget}`)
    .getAttribute("data-item-id");
  if (secondTargetId === null) throw new Error("La seconde cible doit garder son identité.");
  await expect(pageLinks(page).first()).toHaveAttribute(
    "href",
    `${PAGE_LINK_PREFIX}${secondTargetId}`,
  );
  await expect(pageLinks(page).first()).toHaveText("seconde cible");

  await pageLinks(page).first().click({ button: "right" });
  await page.getByTestId("context-remove-link").click();
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(editor).toContainText("seconde cible");
  await expect(page.getByTestId(`tree-item-${firstTarget}`)).toHaveCount(1);
  await expect(page.getByTestId(`tree-item-${secondTarget}`)).toHaveCount(1);

  await saveDocument(page, { until: "synced" });
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(editorSurface(page)).toContainText("seconde cible");
});

test("edits and removes an external link from its context menu without deleting its text", async ({
  page,
}) => {
  await openWorkspace(page);
  const source = uniqueName("External link lifecycle");
  await createRootItem(page, "page", source);
  await waitForSynchronized(page);
  await selectItem(page, source);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("Site initial");
  await selectPreviousWord(page, "initial");

  const toolbar = page.locator(".bn-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Créer un lien" }).click();
  const createLink = page.locator(".bn-form-popover");
  await expect(createLink).toBeVisible();
  await createLink.getByPlaceholder("Modifier l'URL").fill("https://example.com/initial");
  await createLink.getByPlaceholder("Modifier l'URL").press("Enter");
  await saveDocument(page);

  await externalLinks(page).first().click({ button: "right" });
  await page.getByTestId("context-edit-link").click();
  const dialog = page.getByTestId("link-editor-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Texte affiché").fill("documentation");
  await dialog.getByLabel("Adresse").fill("https://example.com/documentation");
  await dialog.getByTestId("save-editor-link").click();

  await expect(externalLinks(page).first()).toHaveAttribute(
    "href",
    "https://example.com/documentation",
  );
  await expect(externalLinks(page).first()).toHaveText("documentation");

  await externalLinks(page).first().click({ button: "right" });
  await page.getByTestId("context-remove-link").click();
  await expect(externalLinks(page)).toHaveCount(0);
  await expect(editor).toContainText("documentation");

  await saveDocument(page, { until: "synced" });
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(externalLinks(page)).toHaveCount(0);
  await expect(editorSurface(page)).toContainText("documentation");
});

test("/page creates one linked subpage under the current page", async ({ page }) => {
  await openWorkspace(page);
  const parent = uniqueName("Parent slash");
  await createRootItem(page, "page", parent);
  await waitForSynchronized(page);
  await selectItem(page, parent);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/page");
  const sourceBlockId = await editor
    .locator(":scope > .bn-block-group > .bn-block-outer[data-id]")
    .first()
    .getAttribute("data-id");
  if (sourceBlockId === null) throw new Error("Le bloc source doit avoir une identité stable.");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: /^Sous-page/u }).click();

  await expect(page.getByTestId("active-item-title")).toHaveValue("Sans titre");
  await ensureNavigationVisible(page);
  const child = page.locator(`[role="treeitem"][data-item-id="${sourceBlockId}"]`);
  await expect(child).toHaveAttribute("aria-selected", "true");
  await selectItem(page, parent);

  const link = pageLinks(page).first();
  await expect(link).toHaveText("Sans titre");
  const href = await link.getAttribute("href");
  if (href === null || !href.startsWith(PAGE_LINK_PREFIX)) {
    throw new Error("La sous-page doit conserver une identité de lien interne.");
  }
  const childId = href.slice(PAGE_LINK_PREFIX.length);
  expect(childId).toBe(sourceBlockId);
  const parentRow = page.getByTestId(`tree-item-${parent}`);
  if ((await parentRow.getAttribute("aria-expanded")) !== "true") {
    await page.getByRole("button", { name: `Expand ${parent}` }).click();
  }
  await expect(child).toHaveCount(1);
  await expect(child).toContainText("Sans titre");
  await waitForSynchronized(page);

  await page.reload();
  await openWorkspace(page);
  await selectItem(page, parent);
  await expect(pageLinks(page)).toHaveCount(1);
  await expect(page.locator(`[role="treeitem"][data-item-id="${childId}"]`)).toHaveCount(1);
});
