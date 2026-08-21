/**
 * Writing a page that reads like a document (T032-T034, US1).
 *
 * The journey the whole feature exists for. Until this suite passed, a page was
 * a title and a JSON textarea; an owner who could not write a structured note
 * had no reason to use the product whatever else it did correctly.
 *
 * Three things are asserted here that no lower level can reach.
 *
 * **The Markdown shortcut consumes its own characters.** `# ` must become a
 * heading and leave no `# ` behind. That is a browser-level behaviour — input
 * rules fire on real keystrokes — and it is the first thing an owner tries.
 *
 * **The document survives a reload exactly as it was left.** The property tests
 * prove the conversion is lossless in memory; this proves the whole path,
 * through the outbox, the server, the sealed envelope, and back.
 *
 * **An unrecognised block is visible and preserved.** The one requirement that
 * cannot be checked by looking at the screen alone: the block must still be in
 * the stored document after an unrelated edit was saved.
 */

import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  createRootItem,
  openWorkspace,
  saveDocument,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function openPage(page: Page, name: string): Promise<string> {
  await openWorkspace(page);
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  await selectItem(page, name);
  await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
  return (await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id")) ?? "";
}

function surface(page: Page) {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function rootBlocks(editor: Locator): Locator {
  return editor.locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
}

function inlineContent(block: Locator): Locator {
  return block.locator(":scope > .bn-block > .bn-block-content > .bn-inline-content").first();
}

function blockContent(block: Locator): Locator {
  return block.locator(":scope > .bn-block > .bn-block-content").first();
}

async function typeIntoBlock(editor: Locator, block: Locator, text: string): Promise<void> {
  const content = inlineContent(block);
  // Empty ProseMirror paragraphs have no box of their own in every engine.
  // Their BlockNote content wrapper is the actual visible insertion target.
  await blockContent(block).click();
  await expect(editor).toBeFocused();
  await editor.pressSequentially(text);
  await expect(content).toContainText(text);
}

async function appendParagraph(editor: Locator): Promise<Locator> {
  const blocks = rootBlocks(editor);
  const previousCount = await blocks.count();
  await expect(editor).toBeFocused();
  // The explicit keyboard alternative is handled by the editor itself and is
  // therefore identical on hardware keyboards and mobile browser emulation.
  await editor.press("ControlOrMeta+Alt+Enter");
  await expect(blocks).toHaveCount(previousCount + 1);
  const block = blocks.nth(previousCount);
  await expect(blockContent(block)).toBeVisible();
  await expect(blockContent(block)).toHaveAttribute("data-content-type", "paragraph");
  return block;
}

async function typeParagraphs(editor: Locator, values: readonly string[]): Promise<void> {
  for (const [index, value] of values.entries()) {
    const block = rootBlocks(editor).last();
    await typeIntoBlock(editor, block, value);
    if (index < values.length - 1) await appendParagraph(editor);
  }
}

async function selectLastTwoBlocks(page: Page, editor: Locator): Promise<void> {
  const blocks = rootBlocks(editor);
  const count = await blocks.count();
  const earlier = inlineContent(blocks.nth(count - 2));
  const later = inlineContent(blocks.nth(count - 1));
  await earlier.scrollIntoViewIfNeeded();
  await later.scrollIntoViewIfNeeded();
  const earlierBox = await earlier.boundingBox();
  const laterBox = await later.boundingBox();
  if (earlierBox === null || laterBox === null)
    throw new Error("Les deux blocs doivent être visibles.");

  await page.mouse.move(laterBox.x + laterBox.width - 2, laterBox.y + laterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(earlierBox.x + 2, earlierBox.y + earlierBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain("second");
}

test.describe("writing with Markdown-style shortcuts", () => {
  test("`# ` becomes a heading and leaves no shortcut characters behind", async ({ page }) => {
    // US1 scenario 1, and the first thing an owner tries. A heading that keeps
    // its `# ` is worse than no shortcut at all.
    await openPage(page, uniqueName("HeadingPage"));
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface(page).pressSequentially("# A title");

    await expect(surface(page).locator("h1")).toHaveText("A title");
    await expect(surface(page)).not.toContainText("# A title");
  });

  test("`- ` becomes a bulleted list item", async ({ page }) => {
    await openPage(page, uniqueName("ListPage"));
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface(page).pressSequentially("- first item");

    await expect(surface(page).locator('[data-content-type="bulletListItem"]')).toContainText(
      "first item",
    );
  });

  test("`> ` becomes a quote", async ({ page }) => {
    await openPage(page, uniqueName("QuotePage"));
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface(page).pressSequentially("> said so");

    await expect(surface(page).locator("blockquote")).toContainText("said so");
  });
});

test.describe("the contextual BlockNote controls", () => {
  test("inserts and transforms five durable block types through distinct paths", async ({
    page,
  }) => {
    await openPage(page, uniqueName("ControlsPage"));
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");

    // Markdown is the zero-dialog route.
    await editor.pressSequentially("# Titre principal");
    await expect(editor.locator("h1")).toHaveText("Titre principal");
    await page.keyboard.press("End");
    const slashBlock = await appendParagraph(editor);

    // The slash menu remains in the editor, is filtered and is localized.
    await typeIntoBlock(editor, slashBlock, "/cit");
    const slashMenu = page.getByRole("listbox");
    await expect(slashMenu).toBeVisible();
    await slashMenu.getByRole("option", { name: /^Citation/u }).click();
    await expect(slashMenu).toBeHidden();
    const quoteBlock = rootBlocks(editor).last();
    await typeIntoBlock(editor, quoteBlock, "Une citation");
    await expect(inlineContent(quoteBlock)).toHaveJSProperty("tagName", "BLOCKQUOTE");
    const paragraphAfterQuote = await appendParagraph(editor);

    await typeIntoBlock(editor, paragraphAfterQuote, "/div");
    const dividerMenu = page.getByRole("listbox");
    await dividerMenu.getByRole("option", { name: /^Diviseur/u }).click();
    await expect(dividerMenu).toBeHidden();
    await expect(editor.locator("hr")).toBeVisible();

    // One click on the contextual plus opens the adjacent insertion point and
    // its localized choices. An existing empty trailing block is reused.
    await editor.locator(".bn-block-outer[data-id]").last().hover();
    await page.getByRole("button", { name: "Ajouter un bloc" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const addMenu = page.getByRole("listbox");
    await addMenu.getByRole("option", { name: /^Liste de tâches/u }).click();
    await expect(addMenu).toBeHidden();
    const checkBlock = rootBlocks(editor).last();
    await typeIntoBlock(editor, checkBlock, "À faire");
    await expect(checkBlock.locator('[data-content-type="checkListItem"]')).toContainText(
      "À faire",
    );

    const paragraphAfterCheck = await appendParagraph(editor);
    await typeIntoBlock(editor, paragraphAfterCheck, "À transformer");
    const contextualBlock = rootBlocks(editor).filter({ hasText: "À transformer" }).last();
    await contextualBlock.click({ button: "right" });
    await page.getByTestId("context-transform-heading").click();
    await expect(contextualBlock.locator("h1")).toContainText("À transformer");

    // The handle itself exposes the same durable actions without requiring a
    // secondary click or a global toolbar.
    await contextualBlock.hover();
    await page.getByRole("button", { name: "Ouvrir le menu du bloc" }).click();
    await page.getByRole("menuitem", { name: "Dupliquer" }).click();
    await expect(editor.getByText("À transformer", { exact: true })).toHaveCount(2);
    await page.getByTestId("undo").click();
    await expect(editor.getByText("À transformer", { exact: true })).toHaveCount(1);
  });

  test("formats a selection and creates a durable internal page link in two actions", async ({
    page,
  }) => {
    const targetName = uniqueName("LinkTarget");
    await openPage(page, targetName);
    const sourceName = uniqueName("FormattingPage");
    await openPage(page, sourceName);
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await editor.pressSequentially("Texte à relier");
    await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");

    const toolbar = page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Gras" }).click();
    await expect(editor.locator("strong")).toContainText("relier");

    // The selected range remains active after formatting: open the shared
    // picker, then choose the target. No global form or technical ID is shown.
    await toolbar.getByRole("button", { name: "Lien vers une page" }).click();
    const picker = page.locator(".editor-page-link-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("option", { name: targetName }).click();
    await expect(editor.locator(`a[href^="myownnotion:page:"]`)).toContainText("relier");

    // Formatting and page-link creation are two independent local gestures.
    // Undo removes only the latest one, then the preceding style; redo restores
    // both without touching unrelated content.
    await page.getByTestId("undo").click();
    await expect(editor.locator(`a[href^="myownnotion:page:"]`)).toHaveCount(0);
    await expect(editor.locator("strong")).toContainText("relier");
    await page.getByTestId("undo").click();
    await expect(editor.locator("strong")).toHaveCount(0);
    await page.getByTestId("redo").click();
    await page.getByTestId("redo").click();
    await expect(editor.locator("strong")).toContainText("relier");
    await expect(editor.locator(`a[href^="myownnotion:page:"]`)).toContainText("relier");
  });
});

test.describe("operational undo", () => {
  test("undoes and redoes one contextual block transaction", async ({ page }) => {
    await openPage(page, uniqueName("UndoPage"));
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await editor.pressSequentially("avant");
    const block = editor.locator(".bn-block-outer[data-id]").filter({ hasText: "avant" }).last();
    await block.click({ button: "right" });
    await page.getByTestId("context-transform-heading").click();
    await expect(editor.locator("h1")).toContainText("avant");

    await page.getByTestId("undo").click();
    await expect(editor.locator("h1")).toHaveCount(0);
    await expect(editor.locator("p")).toContainText("avant");

    await page.getByTestId("redo").click();
    await expect(editor.locator("h1")).toContainText("avant");
  });

  test("moves a contiguous multi-block selection as one undoable gesture", async ({ page }) => {
    await openPage(page, uniqueName("MoveGroupPage"));
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await typeParagraphs(editor, ["premier", "second", "troisième"]);
    await expect(rootBlocks(editor)).toHaveCount(3);
    await expect(page.getByTestId("editor-error")).toHaveCount(0);

    // A native range spanning two blocks is the same group the drag handle
    // uses. Move it through the keyboard-equivalent DnD path.
    await selectLastTwoBlocks(page, editor);
    await page.keyboard.press("Alt+Shift+ArrowUp");
    const blocks = rootBlocks(editor);
    await expect(blocks.nth(0)).toContainText("second");
    await expect(blocks.nth(1)).toContainText("troisième");
    await expect(blocks.nth(2)).toContainText("premier");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(blocks.nth(0)).toContainText("premier");
    await expect(blocks.nth(1)).toContainText("second");
    await expect(blocks.nth(2)).toContainText("troisième");
  });

  test("duplicates a contiguous multi-block selection as one undoable gesture", async ({
    page,
  }) => {
    await openPage(page, uniqueName("DuplicateGroupPage"));
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await typeParagraphs(editor, ["premier", "second", "troisième"]);
    await expect(rootBlocks(editor)).toHaveCount(3);
    await expect(page.getByTestId("editor-error")).toHaveCount(0);

    // The fresh native range avoids depending on selection restoration after
    // undo, which differs between editing engines while the document does not.
    await selectLastTwoBlocks(page, editor);
    await page.keyboard.press("ControlOrMeta+d");
    await expect(editor.getByText("second", { exact: true })).toHaveCount(2);
    await expect(editor.getByText("troisième", { exact: true })).toHaveCount(2);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor.getByText("second", { exact: true })).toHaveCount(1);
    await expect(editor.getByText("troisième", { exact: true })).toHaveCount(1);
  });
});

test.describe("the document survives", () => {
  test("a reload, exactly as it was left", async ({ page }) => {
    // US1 scenario 2 and 4 together: the round trip through the outbox, the
    // server, and the sealed envelope, not only through the converter.
    const name = uniqueName("ReloadPage");
    await openPage(page, name);
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface(page).pressSequentially("# Kept");
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    // The document was written straight to the server, so the client has to
    // pull it before the editor can render it. Without this the test races the
    // reconciler: it passed on a fast machine, failed on a loaded CI runner,
    // and reported itself flaky rather than wrong.
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(surface(page).locator("h1")).toHaveText("Kept", { timeout: 30_000 });
  });
});

test.describe("a block this client does not recognise", () => {
  test("is shown as unrenderable and kept unchanged through an edit", async ({ page, request }) => {
    // FR-030 and FR-070, end to end. Seeded through the API with a block type
    // no client version knows — before the first open, because opening is
    // what activates a page onto the operational protocol — then edited from
    // the editor: the unknown block must come back byte for byte through
    // activation, synchronization and canonical materialization.
    const name = uniqueName("UnknownBlockPage");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    const itemId = (await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id")) ?? "";
    const current = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;

    const unknownBlock = {
      type: "kanbanBoard",
      id: "01924f8e-7c1a-7000-8000-0000000000ff",
      columns: ["todo", "doing"],
      nested: { deep: [1, 2, 3] },
    };
    const seeded = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: head,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { blocks: [unknownBlock] },
        },
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);

    // The document was written straight to the server, so the client has to
    // pull it before the editor can render it. Without this the test races
    // the reconciler: it passed on a fast machine, failed on a loaded CI
    // runner, and reported itself flaky rather than wrong.
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    // Shown as unrenderable, never as an empty gap: a block that renders as
    // nothing is indistinguishable from one that was lost.
    const placeholder = surface(page).locator(".editor-unknown-block");
    await expect(placeholder).toBeVisible({ timeout: 30_000 });
    await expect(placeholder).toContainText("kanbanBoard");

    // Now edit beside it; autosave makes the edit durable and synchronized.
    await placeholder.click({ button: "right" });
    await page.getByTestId("context-insert-after").click();
    await surface(page).pressSequentially("a paragraph beside it");
    await saveDocument(page, { until: "synced" });

    const after = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const body = (await after.json()) as {
      pageDocument: { body: { blocks: Record<string, unknown>[] } };
    };
    const kept = body.pageDocument.body.blocks.find((block) => block["type"] === "kanbanBoard");
    expect(kept).toEqual(unknownBlock);
  });
});

test.describe("a page written before the block editor existed", () => {
  test("opens editable with its content intact and migrates only on first use", async ({
    page,
    request,
  }) => {
    // A read is not a rewrite. Opening a legacy page activates it onto the
    // operational protocol (the documented v3 transition), but the owner's
    // text must arrive intact and no revision may be created by looking —
    // history moves when they write, not when they read.
    const name = uniqueName("LegacyPage");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    const itemId = (await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id")) ?? "";
    const current = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;
    const legacyBody = { text: "written by an older client", count: 3 };
    const seeded = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: head,
        document: { format: "myownnotion.document+json", formatVersion: 1, body: legacyBody },
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const seededHead = ((await seeded.json()) as { revision?: { id?: string } }).revision?.id;

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    // The legacy text survives the transition and is immediately editable:
    // the old read-only gate made conversion a second, lossy-feeling step.
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await expect(surface(page)).toContainText("written by an older client", { timeout: 30_000 });

    // Nothing was written merely by looking at it: the head has not moved.
    const afterOpen = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const afterHead = ((await afterOpen.json()) as { currentRevisionId: string }).currentRevisionId;
    if (seededHead !== undefined) {
      expect(afterHead).toBe(seededHead);
    }

    // The first real edit goes through the operational path and keeps what
    // was already there.
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await surface(page).pressSequentially(" — continued today");
    await saveDocument(page, { until: "synced" });
    await expect(surface(page)).toContainText("written by an older client — continued today");

    const afterEdit = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const editedHead = ((await afterEdit.json()) as { currentRevisionId: string })
      .currentRevisionId;
    expect(editedHead).not.toBe(seededHead);
  });
});
