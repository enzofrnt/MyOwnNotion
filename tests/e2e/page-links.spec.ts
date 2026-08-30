/** Internal page links stay distinct from hierarchy children. */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  clickEditorInsertBlock,
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

function webBookmarks(page: Page): Locator {
  return editorSurface(page).getByTestId("web-bookmark-card");
}

async function linkSelectionToPage(page: Page, targetName: string): Promise<void> {
  const toolbar = page.locator(".bn-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByTestId("open-page-link-picker").click();
  const picker = page.getByTestId("page-link-picker");
  await expect(picker).toBeVisible();
  const search = picker.getByLabel("Rechercher une page");
  await expect(search).toBeFocused();
  await search.fill(targetName);
  await expect(picker.getByRole("option").filter({ hasText: targetName })).toHaveCount(1);
  // The compact picker is completely keyboard operable: filtering and Enter
  // are enough to create the reference, without a second confirmation form.
  await search.press("Enter");
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
  await clickEditorInsertBlock(page);
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
  await selectItem(page, reference);
  const referenceIcon = page.getByTestId("item-icon-picker-trigger");
  await referenceIcon.click();
  const emojiPicker = page.getByTestId("emoji-picker-panel");
  const emojiSearch = emojiPicker.locator('em-emoji-picker input[type="search"]');
  await emojiSearch.focus();
  await emojiSearch.fill("pushpin");
  const pin = emojiPicker.getByRole("button", { name: "📌", exact: true });
  await expect(pin).toBeVisible();
  await pin.focus();
  await expect(pin).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(referenceIcon.locator('[data-item-emoji="true"]')).toHaveText("📌");
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
  await expect(pageLinks(page).first().locator(".page-link__label")).toHaveText(reference);
  await expect(pageLinks(page).first().locator('[data-item-emoji="true"]')).toHaveText("📌");
  await expect(pageLinks(page).first().locator('[data-item-reference="true"]')).toHaveCount(1);
  const childRow = page.getByTestId(`tree-item-${child}`);
  // The link insertion can reconcile the tree with the source branch
  // collapsed. Expand it before asserting placement: absence from a collapsed
  // DOM branch is not absence from the hierarchy.
  if ((await childRow.count()) === 0) {
    await page.getByRole("button", { name: `Déplier ${source}` }).click();
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
  await expect(pageLinks(page).nth(1).locator(".page-link__label")).toHaveText(child);
  await expect(pageLinks(page).nth(1).locator('[data-item-reference="true"]')).toHaveCount(0);
  await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(1);

  // Moving the target changes only its hierarchy placement.
  await selectItem(page, reference);
  await moveSelectedItemInto(page, destination);
  await waitForSynchronized(page);
  await ensureNavigationVisible(page);
  const destinationRow = page.getByTestId(`tree-item-${destination}`);
  if ((await destinationRow.getAttribute("aria-expanded")) !== "true") {
    await page.getByRole("button", { name: `Déplier ${destination}` }).click();
  }
  await ensureNavigationRowVisible(page, reference);

  await renameItem(page, reference, `${reference}-renamed`);
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toBeVisible();
  await selectItem(page, `${reference}-renamed`);
  // Conversion also preserves identity. The target is empty, so page → folder
  // is non-destructive and needs no confirmation.
  await convertItem(page, `${reference}-renamed`);
  await expect(page.getByTestId(`tree-item-${reference}-renamed`)).toHaveAttribute(
    "data-item-kind",
    "folder",
    { timeout: 30_000 },
  );
  await waitForSynchronized(page);

  await selectItem(page, source);
  await expect(pageLinks(page).first()).toHaveAttribute("href", targetHref);
  // The link stores only the target identity. Name and kind presentation are
  // resolved from the current projection and therefore follow later changes.
  await expect(pageLinks(page).first().locator(".page-link__label")).toHaveText(
    `${reference}-renamed`,
  );
  await expect(pageLinks(page).first().locator('[data-item-emoji="true"]')).toHaveText("📌");

  // Durable reload keeps the typed link separate from the tree placement.
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(pageLinks(page).first()).toHaveAttribute("href", targetHref);
  await expect(pageLinks(page).first().locator('[data-item-emoji="true"]')).toHaveText("📌");
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
  const picker = page.getByTestId("page-link-picker");
  await expect(picker).toBeVisible();
  const search = picker.getByLabel("Rechercher une page");
  await search.fill(secondTarget);
  await search.press("Enter");
  await expect(picker).toBeHidden();

  const secondTargetId = await page
    .getByTestId(`tree-item-${secondTarget}`)
    .getAttribute("data-item-id");
  if (secondTargetId === null) throw new Error("La seconde cible doit garder son identité.");
  await expect(pageLinks(page).first()).toHaveAttribute(
    "href",
    `${PAGE_LINK_PREFIX}${secondTargetId}`,
  );
  await expect(pageLinks(page).first().locator(".page-link__label")).toHaveText(secondTarget);

  await pageLinks(page).first().click({ button: "right" });
  await page.getByTestId("context-remove-link").click();
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(editor).toContainText(secondTarget);
  await expect(page.getByTestId(`tree-item-${firstTarget}`)).toHaveCount(1);
  await expect(page.getByTestId(`tree-item-${secondTarget}`)).toHaveCount(1);

  await saveDocument(page, { until: "synced" });
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(editorSurface(page)).toContainText(secondTarget);
});

test("creates, validates, edits, and removes a full-line Web bookmark", async ({ page }) => {
  await openWorkspace(page);
  const source = uniqueName("Web bookmark lifecycle");
  await createRootItem(page, "page", source);
  await waitForSynchronized(page);
  await selectItem(page, source);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/lien web");
  const slashMenu = page.getByRole("listbox");
  await slashMenu.getByRole("option", { name: /^Lien Web/u }).click();

  const dialog = page.getByTestId("web-bookmark-dialog");
  await expect(dialog).toBeVisible();
  const address = dialog.getByLabel("Adresse Web");
  await expect(address).toBeFocused();
  await address.fill("pas un lien");
  await address.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("Saisissez un lien Web valide.");
  await address.fill("example.com/initial");
  await address.press("Enter");
  await expect(dialog).toBeHidden();

  const card = webBookmarks(page).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("link")).toHaveAttribute("href", "https://example.com/initial");
  await expect(card).toContainText("example.com");
  await expect(card.locator("iframe")).toHaveCount(0);
  await expect
    .poll(async () => {
      const cardBox = await card.boundingBox();
      const editorBox = await editor.boundingBox();
      return cardBox !== null && editorBox !== null ? cardBox.width / editorBox.width : 0;
    })
    .toBeGreaterThan(0.75);
  await waitForSynchronized(page);
  await expect(card).toBeVisible();

  await card.click({ button: "right" });
  await page.getByTestId("context-edit-web-bookmark").click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Adresse Web").fill("https://example.com/documentation");
  await dialog.getByLabel("Adresse Web").press("Enter");
  await expect(dialog).toBeHidden();
  await expect(card.getByRole("link")).toHaveAttribute("href", "https://example.com/documentation");

  await card.click({ button: "right" });
  await page.getByTestId("context-remove-web-bookmark").click();
  await expect(webBookmarks(page)).toHaveCount(0);

  await saveDocument(page, { until: "synced" });
  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  await expect(webBookmarks(page)).toHaveCount(0);
});

test("keeps page and Web actions separate and shows a caret on an empty line", async ({ page }) => {
  await openWorkspace(page);
  const source = uniqueName("Link action boundary");
  const target = uniqueName("Keyboard target");
  await createRootItem(page, "page", source);
  await createRootItem(page, "page", target);
  await waitForSynchronized(page);
  await selectItem(page, source);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/lien");
  const slashMenu = page.getByRole("listbox");
  await expect(slashMenu.getByRole("option", { name: /^Lien vers une page/u })).toHaveCount(1);
  await expect(slashMenu.getByRole("option", { name: /^Lien Web/u })).toHaveCount(1);
  await slashMenu.getByRole("option", { name: /^Lien vers une page/u }).click();

  const picker = page.getByTestId("page-link-picker");
  const search = picker.getByLabel("Rechercher une page");
  await expect(search).toBeFocused();
  await search.fill(target);
  await search.press("Enter");
  await expect(pageLinks(page)).toHaveCount(1);
  await expect(webBookmarks(page)).toHaveCount(0);

  await pageLinks(page).first().click({ button: "right" });
  await page.getByTestId("context-remove-link").click();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  const emptyLine = editor.locator(".bn-inline-content").first();
  await emptyLine.click();
  await expect
    .poll(() => emptyLine.evaluate((line) => getComputedStyle(line).caretColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        return selection !== null && selection.rangeCount > 0 && selection.isCollapsed;
      }),
    )
    .toBe(true);
  await editor.pressSequentially("Nouveau texte");
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(webBookmarks(page)).toHaveCount(0);
  await expect(editor).toContainText("Nouveau texte");
  await expect
    .poll(() => editor.evaluate((surface) => getComputedStyle(surface as HTMLElement).caretColor))
    .not.toBe("rgba(0, 0, 0, 0)");
});

test("never resurrects a page link after its whole line is deleted and rewritten", async ({
  page,
}) => {
  await openWorkspace(page);
  const source = uniqueName("Deleted link source");
  const target = uniqueName("Deleted link target");
  await createRootItem(page, "page", source);
  await createRootItem(page, "page", target);
  await waitForSynchronized(page);
  await selectItem(page, source);

  const editor = editorSurface(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("ancienne référence");
  await selectPreviousWord(page, "référence");
  await linkSelectionToPage(page, target);
  await saveDocument(page, { until: "synced" });
  await expect(pageLinks(page)).toHaveCount(1);

  // This is the reported gesture: remove the line while its internal node is
  // still present, then immediately reuse that same empty line for plain text.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("texte entièrement neuf");
  await expect(pageLinks(page)).toHaveCount(0);
  await expect(editor).toContainText("texte entièrement neuf");

  await saveDocument(page, { until: "synced" });
  await waitForSynchronized(page);
  const afterSynchronization = {
    links: await pageLinks(page).count(),
    text: await editor.innerText(),
  };

  await page.reload();
  await openWorkspace(page);
  await selectItem(page, source);
  expect(
    {
      afterSynchronization,
      afterReload: {
        links: await pageLinks(page).count(),
        text: await editorSurface(page).innerText(),
      },
    },
    "the deleted internal node must stay absent both live and after reopening",
  ).toMatchObject({
    afterSynchronization: { links: 0, text: expect.stringContaining("texte entièrement neuf") },
    afterReload: { links: 0, text: expect.stringContaining("texte entièrement neuf") },
  });
  await expect(editorSurface(page)).toContainText("texte entièrement neuf");
  await expect(editorSurface(page)).not.toContainText(target);
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

  const childTitle = page.getByTestId("active-item-title");
  await expect(childTitle).toBeFocused({ timeout: 15_000 });
  await expect(childTitle).toHaveValue("");
  const childName = uniqueName("Sous-page créée");
  await childTitle.fill(childName);
  await childTitle.press("Enter");
  await ensureNavigationVisible(page);
  const child = page.locator(`[role="treeitem"][data-item-id="${sourceBlockId}"]`);
  await expect(child).toHaveAttribute("aria-selected", "true");
  await selectItem(page, parent);

  const link = pageLinks(page).first();
  await expect(link.locator(".page-link__label")).toHaveText(childName);
  // This is the canonical child created by /page, not a reference to an item
  // elsewhere in the hierarchy, so it keeps the page identity without the
  // small reference badge.
  await expect(link.locator('[data-item-reference="true"]')).toHaveCount(0);
  const href = await link.getAttribute("href");
  if (href === null || !href.startsWith(PAGE_LINK_PREFIX)) {
    throw new Error("La sous-page doit conserver une identité de lien interne.");
  }
  const childId = href.slice(PAGE_LINK_PREFIX.length);
  expect(childId).toBe(sourceBlockId);
  const parentRow = page.getByTestId(`tree-item-${parent}`);
  if ((await parentRow.getAttribute("aria-expanded")) !== "true") {
    await page.getByRole("button", { name: `Déplier ${parent}` }).click();
  }
  await expect(child).toHaveCount(1);
  await expect(child).toContainText(childName);
  await waitForSynchronized(page);

  await page.reload();
  await openWorkspace(page);
  await selectItem(page, parent);
  await expect(pageLinks(page)).toHaveCount(1);
  await expect(page.locator(`[role="treeitem"][data-item-id="${childId}"]`)).toHaveCount(1);
});
