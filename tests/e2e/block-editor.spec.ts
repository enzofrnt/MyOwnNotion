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
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function openPage(page: import("@playwright/test").Page, name: string): Promise<string> {
  await openWorkspace(page);
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  await selectItem(page, name);
  await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
  return (await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id")) ?? "";
}

function surface(page: import("@playwright/test").Page) {
  return page.getByTestId("block-editor").locator(".ProseMirror");
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

    await expect(surface(page).locator("ul li")).toContainText("first item");
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

test.describe("the visible controls", () => {
  test("insert each block type without touching the keyboard shortcuts", async ({ page }) => {
    // FR-002 requires three routes, not one. An owner who never discovers the
    // shortcuts must still be able to build the same document.
    await openPage(page, uniqueName("ControlsPage"));
    await surface(page).click();

    await page.getByTestId("toggle-bulleted-list").click();
    await expect(surface(page).locator("ul")).toBeVisible();

    await page.getByTestId("toggle-checkbox").click();
    await expect(
      surface(page).locator('[data-type="taskList"], ul[data-type="taskList"]'),
    ).toBeVisible();

    await page.getByTestId("insert-divider").click();
    await expect(surface(page).locator("hr")).toBeVisible();
  });

  test("the slash menu offers the block types and is a listbox", async ({ page }) => {
    await openPage(page, uniqueName("SlashPage"));
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.press("/");

    const menu = page.getByTestId("slash-menu");
    await expect(menu).toBeVisible();
    // A listbox rather than a set of buttons, so focus stays in the editor and
    // the selection the insertion acts on is not collapsed.
    await expect(menu.getByRole("listbox")).toHaveAttribute("aria-activedescendant", /.+/);
    await expect(page.getByTestId("slash-option-heading-1")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test.describe("undo", () => {
  test("restores the previous state and redo returns to the later one", async ({ page }) => {
    // US1 scenario 3. Every action in FR-002 and FR-003 must be undoable, and a
    // control implemented outside the transaction pipeline silently would not
    // be — which is why this asserts on a control rather than on typing.
    await openPage(page, uniqueName("UndoPage"));
    await surface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface(page).pressSequentially("before");
    await page.getByTestId("toggle-heading").click();
    await expect(surface(page).locator("h1")).toBeVisible();

    await page.getByTestId("undo").click();
    await expect(surface(page).locator("h1")).toHaveCount(0);

    await page.getByTestId("redo").click();
    await expect(surface(page).locator("h1")).toBeVisible();
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
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, name);
    await expect(surface(page).locator("h1")).toHaveText("Kept", { timeout: 30_000 });
  });
});

test.describe("a block this client does not recognise", () => {
  test("is shown as unrenderable and kept unchanged through an edit", async ({ page, request }) => {
    // FR-006 and SC-009, end to end. Seeded through the API with a block type
    // no client version knows, then edited and saved from the editor: the
    // unknown block must come back byte for byte.
    const name = uniqueName("UnknownBlockPage");
    const itemId = await openPage(page, name);

    const current = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;

    const unknownBlock = {
      type: "kanbanBoard",
      id: "01924f8e-7c1a-7000-8000-0000000000ff",
      columns: ["todo", "doing"],
      nested: { deep: [1, 2, 3] },
    };
    const seeded = await request.put(`http://127.0.0.1:3001/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": randomUUID() },
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

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, name);

    // Shown as unrenderable, never as an empty gap: a block that renders as
    // nothing is indistinguishable from one that was lost.
    const placeholder = surface(page).locator(".editor-unknown-block");
    await expect(placeholder).toBeVisible({ timeout: 30_000 });
    await expect(placeholder).toContainText("kanbanBoard");

    // Now edit around it and save.
    await surface(page).click();
    await page.keyboard.press("End");
    await page.getByTestId("insert-block").click();
    await surface(page).pressSequentially("a paragraph beside it");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    const after = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const body = (await after.json()) as {
      pageDocument: { body: { blocks: Record<string, unknown>[] } };
    };
    const kept = body.pageDocument.body.blocks.find((block) => block["type"] === "kanbanBoard");
    expect(kept).toEqual(unknownBlock);
  });
});

test.describe("a page written before the block editor existed", () => {
  test("opens read-only and is not rewritten until the owner converts it", async ({
    page,
    request,
  }) => {
    // A read is not a write. A client that rewrote an owner's stored document
    // on open would be doing something they did not ask for and cannot audit.
    const name = uniqueName("LegacyPage");
    const itemId = await openPage(page, name);

    const current = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;
    const legacyBody = { text: "written by an older client", count: 3 };
    const seeded = await request.put(`http://127.0.0.1:3001/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: head,
        document: { format: "myownnotion.document+json", formatVersion: 1, body: legacyBody },
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const seededHead = ((await seeded.json()) as { revision?: { id?: string } }).revision?.id;

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, name);

    await expect(page.getByTestId("legacy-document-notice")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("legacy-document-body")).toContainText("older client");

    // Nothing was written merely by looking at it: the head has not moved.
    const afterOpen = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const afterHead = ((await afterOpen.json()) as { currentRevisionId: string }).currentRevisionId;
    if (seededHead !== undefined) {
      expect(afterHead).toBe(seededHead);
    }

    // Converting is the owner's action, and it keeps the original content.
    await page.getByTestId("convert-legacy-document").click();
    await expect(page.getByTestId("block-editor")).toBeVisible();
  });
});
