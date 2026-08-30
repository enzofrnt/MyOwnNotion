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
  clickEditorInsertBlock,
  createRootItem,
  createUnopenedPage,
  editorApplyCount,
  openWorkspace,
  saveDocument,
  selectItem,
  uniqueName,
  waitForEditorSettled,
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
  await editor.evaluate((root) => {
    const visibleBlocks = root.querySelectorAll(
      ":scope > .bn-block-group > .bn-block-outer[data-id]",
    );
    const first = visibleBlocks.item(visibleBlocks.length - 2).querySelector(".bn-inline-content");
    const last = visibleBlocks.item(visibleBlocks.length - 1).querySelector(".bn-inline-content");
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      throw new Error("Les deux blocs doivent être visibles.");
    }
    (root as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain("second");
}

async function applyEditorHistory(page: Page, action: "undo" | "redo"): Promise<void> {
  await waitForEditorSettled(page);
  // A selected range owns BlockNote's transient formatting toolbar. Finish
  // that interaction before starting the independent history action, then put
  // the target in the unobscured middle of a narrow viewport: WebKit otherwise
  // aligns it underneath the sticky page header while trying to click it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".bn-formatting-toolbar")).toBeHidden();
  const control = page.getByTestId(action);
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(control).toBeEnabled();
  await control.click();
  // The sequence identifies local activity bursts, not every action. The
  // assertions after each call prove the actual undo/redo result.
  await waitForEditorSettled(page);
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
    await waitForEditorSettled(page);

    // One click on the contextual plus opens the adjacent insertion point and
    // its localized choices. An existing empty trailing block is reused.
    await editor.locator(".bn-block-outer[data-id]").last().hover();
    await clickEditorInsertBlock(page);
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
    await saveDocument(page, { until: "synced" });
    await contextualBlock.hover();
    await page.getByRole("button", { name: "Ouvrir le menu du bloc" }).click();
    // Opening a menu can overlap the tail of another local burst. The sequence
    // deliberately does not increment twice inside that same quiet window, so
    // the authoritative apply count is the specific witness for duplication.
    const beforeDuplicate = await editorApplyCount(page);
    await page.getByTestId("side-menu-duplicate").click();
    await waitForEditorSettled(page, { afterApplyCount: beforeDuplicate });
    await expect(editor.getByText("À transformer", { exact: true })).toHaveCount(2);
    await applyEditorHistory(page, "undo");
    await expect(editor.getByText("À transformer", { exact: true })).toHaveCount(1);
  });

  test("formats a selection and creates a durable internal page link in two actions", async ({
    page,
  }) => {
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (error) => uncaughtErrors.push(error.message));
    const targetName = uniqueName("LinkTarget");
    await openPage(page, targetName);
    const sourceName = uniqueName("FormattingPage");
    await openPage(page, sourceName);
    const editor = surface(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await editor.pressSequentially("Texte à relier");
    // The synthetic typing above deliberately runs much faster than a person
    // can type. Let its local commits become durable before starting the
    // separate selection gesture, so a late projection cannot collapse it.
    await saveDocument(page);
    await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("relier");

    const toolbar = page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Gras" }).click();
    await expect(editor.locator("strong")).toContainText("relier");

    // The selected range remains active after formatting: open the dedicated
    // internal-page picker, then choose the target with the keyboard. Web
    // bookmarks deliberately use a separate full-line action.
    await toolbar.getByTestId("open-page-link-picker").click();
    const picker = page.getByTestId("page-link-picker");
    await expect(picker).toBeVisible();
    const search = picker.getByLabel("Rechercher une page");
    await search.fill(targetName);
    await expect(picker.getByRole("option").filter({ hasText: targetName })).toHaveCount(1);
    await search.press("Enter");
    await expect(picker).toBeHidden();
    await expect(editor.locator('a[href^="#page="] .page-link__label')).toHaveText(targetName);

    // The internal reference becomes target-owned content and survives the
    // complete operational persistence path. Formatting history itself is
    // covered independently below; it must not dictate an editable alias for
    // a canonical page reference.
    await saveDocument(page, { until: "synced" });
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, sourceName);
    await expect(surface(page).locator('a[href^="#page="] .page-link__label')).toHaveText(
      targetName,
    );
    expect(uncaughtErrors).toEqual([]);
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

    await applyEditorHistory(page, "undo");
    await expect(editor.locator("h1")).toHaveCount(0);
    await expect(editor.locator("p")).toContainText("avant");

    await applyEditorHistory(page, "redo");
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
    await saveDocument(page);

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
    // no client version knows — before the first open, so the seed cannot race
    // the editor — then edited from the editor: the unknown block must come
    // back byte for byte through conversion, synchronization and canonical
    // materialization.
    const name = uniqueName("UnknownBlockPage");
    await openWorkspace(page);
    const unknownBlock = {
      type: "kanbanBoard",
      id: "01924f8e-7c1a-7000-8000-0000000000ff",
      columns: ["todo", "doing"],
      nested: { deep: [1, 2, 3] },
    };
    const { itemId } = await createUnopenedPage(request, name, {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: { blocks: [unknownBlock] },
    });

    // The page was prepared outside the browser and has never mounted an
    // editor. Reloading pulls it into the local projection before first open.
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
  test("opens editable with its content intact and activates before the first gesture", async ({
    page,
    request,
  }) => {
    // An API read is not a rewrite. The connected editable surface is the
    // protocol boundary instead: before it mounts, a historical client may
    // still write v2; once it mounts, the same page is operational and a whole
    // document replacement can no longer overwrite it (plan §6, FR-064).
    const name = uniqueName("LegacyPage");
    await openWorkspace(page);
    const seededBody = {
      blocks: [
        {
          type: "paragraph",
          id: "01924f8e-7c1a-7000-8000-0000000000aa",
          content: [{ type: "text", text: "written by an older client" }],
        },
      ],
    };
    const { itemId, revisionId: seededHead } = await createUnopenedPage(request, name, {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: seededBody,
    });

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);

    // Reading the item without opening its editor leaves the old write path
    // available and does not move the canonical head.
    const afterRead = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const afterHead = ((await afterRead.json()) as { currentRevisionId: string }).currentRevisionId;
    expect(afterHead).toBe(seededHead);
    const stillPlain = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: afterHead,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            blocks: [
              ...seededBody.blocks,
              {
                type: "paragraph",
                id: "01924f8e-7c1a-7000-8000-0000000000ab",
                content: [{ type: "text", text: "appended without activating" }],
              },
            ],
          },
        },
      },
    });
    expect(stillPlain.ok(), await stillPlain.text()).toBe(true);

    const afterPlainWrite = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const plainHead = ((await afterPlainWrite.json()) as { currentRevisionId: string })
      .currentRevisionId;
    await selectItem(page, name);

    // Activation happens before the editor accepts its first gesture and
    // preserves every historical block.
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await expect(surface(page)).toContainText("written by an older client", { timeout: 30_000 });
    await expect(surface(page)).toContainText("appended without activating", { timeout: 30_000 });
    const blindReplacement = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: plainHead,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: seededBody,
        },
      },
    });
    expect(blindReplacement.status()).toBe(426);
    expect((await blindReplacement.json()) as { code: string }).toMatchObject({
      code: "page-operations.protocol-read-only",
    });

    // The first real edit already goes through the operational path.
    const editor = surface(page);
    // Clicking the retained paragraph focuses the surface — after a reload,
    // mobile browsers do not hand focus to the editor on selection alone.
    await blockContent(rootBlocks(editor).last()).click();
    const continued = await appendParagraph(editor);
    await typeIntoBlock(editor, continued, "continued today after activation");
    await saveDocument(page, { until: "synced" });
    await expect(surface(page)).toContainText("appended without activating");
    await expect(surface(page)).toContainText("continued today after activation");

    const afterEdit = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    const edited = (await afterEdit.json()) as {
      pageDocument: { body: { blocks: Record<string, unknown>[] } };
    };
    const durableBody = JSON.stringify(edited.pageDocument.body);
    expect(durableBody).toContain("written by an older client");
    expect(durableBody).toContain("appended without activating");
    expect(durableBody).toContain("continued today after activation");
  });
});
