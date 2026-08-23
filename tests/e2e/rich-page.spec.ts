/**
 * A page that carries real work (T088, US3).
 *
 * The minimal editor journey proves gestures; this one proves composition.
 * The V1 promise is a page holding every mandatory block and mark, surviving a
 * reload with order and references intact — the difference between a demo
 * surface and a tool an owner can entrust with notes.
 *
 * Advanced blocks go through the localized `/` menu exactly as an owner would,
 * and the stored document is read back through the API so the assertion covers
 * the durable canonical form, not just pixels. Every gesture starts from the
 * editor focus the previous one left behind — the same assumption the minimal
 * journey's `appendParagraph` makes — and no assertion depends on where a
 * menu insertion leaves the cursor.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspace, saveDocument, selectItem, uniqueName } from "./helpers.ts";

interface StoredPageDocument {
  readonly pageDocument?: { readonly body?: { readonly blocks?: unknown[] } };
}

async function readStoredBlocks(page: Page, itemId: string): Promise<unknown[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/v1/items/${id}`);
    if (!response.ok) throw new Error(`item read failed: ${response.status}`);
    const body = (await response.json()) as StoredPageDocument;
    return body.pageDocument?.body?.blocks ?? [];
  }, itemId);
}

test.describe("rich page composition", () => {
  test("composes advanced blocks, keeps them across a reload and stores them durably", async ({
    page,
  }) => {
    const pageName = uniqueName("RichPage");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");

    // Bold as a mark on a plain paragraph, selected from the keyboard like the
    // minimal-editor journey does.
    await editor.pressSequentially("Mot important");
    // The DOM input event precedes the operational editor's local commit. If a
    // projection lands between typing and selection it can restore a caret and
    // suppress the floating toolbar, especially on a constrained mobile run.
    // Cross the durability boundary before starting this distinct gesture.
    await saveDocument(page);
    await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toContain("important");
    const toolbar = page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Gras" }).click();
    // Substring rather than exact text: engines disagree on how far
    // Shift+Mod+ArrowLeft extends (line start vs word start).
    await expect(editor.locator("strong")).toContainText("important");

    // A fresh empty block below, then the encadré through its French entry.
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+Alt+Enter");
    await editor.pressSequentially("/enc");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    await menu.getByRole("option", { name: /^Encadré/u }).click();
    await expect(menu).toBeHidden();
    // Target the callout body explicitly instead of trusting cursor placement.
    const calloutBody = editor.locator(".editor-callout");
    await calloutBody.click();
    await editor.pressSequentially("Information mise en évidence");
    await expect(editor.locator(".editor-callout")).toContainText("Information mise en évidence");

    // Liste dépliable on a fresh block below the callout. The ASCII alias
    // avoids per-engine dead-key handling of « é » in slash queries.
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+Alt+Enter");
    await editor.pressSequentially("/tog");
    const toggleMenu = page.getByRole("listbox");
    await toggleMenu.getByRole("option", { name: /^Liste dépliable/u }).click();
    await expect(toggleMenu).toBeHidden();
    // BlockNote 0.54 renders its toggle as a wrapper with a disclosure button.
    const toggleBody = editor.locator('[data-content-type="toggleListItem"]').first();
    await toggleBody.click();
    await editor.pressSequentially("Section repliée");
    await expect(editor.locator('[data-content-type="toggleListItem"]')).toContainText(
      "Section repliée",
    );

    // Tableau simple from the cursor inside the toggle: the table joins as a
    // sibling below, and the toggle keeps its text.
    await editor.pressSequentially("/tab");
    const tableMenu = page.getByRole("listbox");
    await tableMenu.getByRole("option", { name: /^Tableau simple/u }).click();
    await expect(tableMenu).toBeHidden();
    await expect(editor.locator(".editor-table-toolbar")).toBeVisible();

    // Reload only once every transaction is durable and accepted: the
    // assertions target the stored document, not a mid-flight draft.
    const status = page.getByTestId("editor-sync-status");
    if (await status.count()) {
      await expect(status).toHaveAttribute("data-sync", "synced", { timeout: 30_000 });
    } else {
      await page.getByTestId("save-document").click();
      await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 15_000 });
    }

    // Reload: every block still carries its content.
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    const reloaded = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(reloaded).toBeVisible({ timeout: 30_000 });
    await expect(reloaded.locator("strong")).toContainText("important");
    await expect(reloaded.locator(".editor-callout")).toContainText("Information mise en évidence");
    await expect(reloaded.locator('[data-content-type="toggleListItem"]')).toContainText(
      "Section repliée",
    );
    await expect(reloaded.locator(".editor-table-toolbar")).toBeVisible();

    // The durable document holds what the screen shows (FR-025).
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (itemId === null) throw new Error("tree item lost its data-item-id");
    const blocks = (await readStoredBlocks(page, itemId)) as Array<{ type?: string }>;
    const types = new Set(blocks.map((block) => block.type));
    expect(types.has("callout")).toBe(true);
    expect(types.has("table")).toBe(true);
    expect(types.has("toggle")).toBe(true);
    expect(JSON.stringify(blocks)).toContain('"bold"');
  });
});
