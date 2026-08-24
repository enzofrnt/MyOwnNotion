/** Delete/edit remains recoverable across reconnection, restart and resolution (T129, US5). */

import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorApplyCount,
  editorChangeSequence,
  openSecondDevice,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

function editor(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function rootBlocks(page: Page): Locator {
  return editor(page).locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
}

function blockContaining(page: Page, text: string): Locator {
  return rootBlocks(page).filter({ hasText: text }).first();
}

function inlineContent(block: Locator): Locator {
  return block.locator(":scope > .bn-block > .bn-block-content > .bn-inline-content").first();
}

async function selectAllText(page: Page, content: Locator): Promise<void> {
  await content.evaluate((node) => {
    const surface = node.closest(".ProseMirror");
    if (!(surface instanceof HTMLElement)) throw new Error("the block is outside the editor");
    surface.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    if (selection === null) throw new Error("the browser did not expose a text selection");
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(editor(page)).toBeFocused();
}

async function waitForPageSync(page: Page, state: "synced" | "offline"): Promise<void> {
  await waitForEditorSettled(page);
  const status = page.getByTestId("editor-sync-status");
  await expect(status).toHaveAttribute("data-durable", "true", { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-sync", state, { timeout: 30_000 });
}

async function setOffline(context: BrowserContext, page: Page, offline: boolean): Promise<void> {
  await context.setOffline(offline);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
}

async function seedThreeBlocks(page: Page): Promise<void> {
  await waitForEditor(page);
  const before = await editorChangeSequence(page);
  const surface = editor(page);
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await surface.pressSequentially("avant");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await surface.pressSequentially("contenu partagé");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await surface.pressSequentially("après");
  await waitForEditorSettled(page, { afterSequence: before });
  await expect(rootBlocks(page)).toHaveCount(3);
}

test("delete/edit ambiguity survives restart and restores the edited block", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const second = await openSecondDevice(browser, baseURL);
  try {
    const pageName = uniqueName("DeleteEditAmbiguity");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await seedThreeBlocks(page);
    await waitForPageSync(page, "synced");

    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await waitForPageSync(second.page, "synced");

    await Promise.all([
      setOffline(context, page, true),
      setOffline(second.context, second.page, true),
    ]);

    const beforeDelete = await editorApplyCount(page);
    await blockContaining(page, "contenu partagé").click({ button: "right" });
    await page.getByTestId("context-delete").click();
    await waitForEditorSettled(page, { afterApplyCount: beforeDelete });
    await expect(blockContaining(page, "contenu partagé")).toHaveCount(0);

    const beforeEdit = await editorChangeSequence(second.page);
    await selectAllText(
      second.page,
      inlineContent(blockContaining(second.page, "contenu partagé")),
    );
    await editor(second.page).pressSequentially("contenu modifié hors ligne");
    await waitForEditorSettled(second.page, { afterSequence: beforeEdit });
    await expect(second.page.getByTestId("block-editor")).toContainText(
      "contenu modifié hors ligne",
    );

    await Promise.all([waitForPageSync(page, "offline"), waitForPageSync(second.page, "offline")]);

    // Deletion reaches the server first; editing arrives later and must create
    // one durable question instead of choosing either complete document.
    await setOffline(context, page, false);
    await waitForPageSync(page, "synced");
    await setOffline(second.context, second.page, false);
    await expect(second.page.getByTestId("ambiguity-notice")).toBeVisible({ timeout: 30_000 });
    await expect(second.page.getByTestId("editor-sync-status")).toHaveAttribute(
      "data-state",
      "attention",
    );

    // Restart the device that produced the edit. The question and both
    // intentions must come from durable local state, not transient React state.
    await second.page.close();
    second.page = await second.context.newPage();
    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await expect(second.page.getByTestId("ambiguity-notice")).toBeVisible({ timeout: 30_000 });
    await second.page.getByText("Suppression contre modification", { exact: true }).click();
    await expect(second.page.getByTestId("ambiguity-resolution")).toContainText(
      "contenu modifié hors ligne",
    );

    await second.page.getByTestId("ambiguity-restore").click();
    await expect(second.page.getByTestId("ambiguity-notice")).toHaveCount(0, { timeout: 30_000 });
    await expect(second.page.getByTestId("block-editor")).toContainText(
      "contenu modifié hors ligne",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("block-editor")).toContainText("contenu modifié hors ligne", {
      timeout: 30_000,
    });
    await waitForPageSync(second.page, "synced");
    await waitForPageSync(page, "synced");
  } finally {
    await second.context.close();
  }
});
