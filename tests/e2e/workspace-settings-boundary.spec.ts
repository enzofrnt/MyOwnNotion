/**
 * Knowledge stays in the workspace; operational surfaces have their own
 * destination and returning preserves the exact reading context (T222).
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openSettings,
  openWorkspace,
  selectItem,
  trashItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const PARAGRAPHS = 20;

async function fillLongPage(page: import("@playwright/test").Page): Promise<void> {
  const editor = page.getByTestId("block-editor").locator(".ProseMirror");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  for (let index = 1; index <= PARAGRAPHS; index += 1) {
    if (index > 1) await editor.press("ControlOrMeta+Alt+Enter");
    await editor.pressSequentially(`Contexte de lecture ${index}`);
  }
  await expect(editor.locator(".bn-block-outer[data-id]")).toHaveCount(PARAGRAPHS);
  await waitForSynchronized(page);
}

test("settings stay outside the document and returning restores item, focus and scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openWorkspace(page);

  const pageName = uniqueName("PageFocalisee");
  const discardedName = uniqueName("AClasser");
  await createRootItem(page, "page", pageName);
  await createRootItem(page, "folder", discardedName);
  await trashItem(page, discardedName);
  await selectItem(page, pageName);
  const noteUrl = page.url();
  const itemId = new URL(noteUrl).pathname.split("/").at(-1);
  expect(itemId).toBeTruthy();
  await fillLongPage(page);

  const workspaceMain = page.getByTestId("workspace-main");
  await expect(workspaceMain).toBeVisible();
  await expect(workspaceMain.locator('[data-testid="storage-panel"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="mutation-status"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="item-details"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="revision-restore"]')).toHaveCount(0);
  await expect(workspaceMain.locator(`[data-testid="trash-item-${discardedName}"]`)).toHaveCount(0);

  const rememberedBlockId = await workspaceMain.evaluate((scroller) => {
    const blocks = Array.from(scroller.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]"));
    const target = blocks.at(-2);
    if (target === undefined) return null;
    const viewport = scroller.getBoundingClientRect();
    const top = target.getBoundingClientRect().top - viewport.top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight / 2) });
    return target.dataset["id"] ?? null;
  });
  expect(rememberedBlockId).not.toBeNull();
  await expect
    .poll(() => workspaceMain.evaluate((scroller) => scroller.scrollTop))
    .toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);

  const settingsTrigger = page.getByTestId("open-settings");
  await openSettings(page);
  await expect(page).toHaveURL(/\/settings\/security$/u);
  await expect(page.getByTestId("workspace-surface")).toBeHidden();

  await page.getByTestId("settings-nav-backups").click();
  await expect(page).toHaveURL(/\/settings\/backups$/u);
  await expect(page.getByTestId("backup-panel")).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/security$/u);
  await expect(page.getByTestId("security-settings")).toBeVisible({ timeout: 30_000 });
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/backups$/u);
  await expect(page.getByTestId("backup-panel")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("settings-nav-local-data").click();
  await expect(page).toHaveURL(/\/settings\/storage-sync$/u);
  await expect(page.getByTestId("storage-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mutation-status-empty")).toBeVisible();

  await page.getByTestId("settings-nav-trash").click();
  await expect(page).toHaveURL(/\/settings\/trash$/u);
  await expect(page.getByTestId(`trash-item-${discardedName}`)).toBeVisible();

  await page.getByTestId("settings-nav-page-details").click();
  await expect(page).toHaveURL(`/settings/page/${itemId}`);
  await expect(page.getByTestId("item-details")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("revision-restore")).toBeVisible();

  await page.getByTestId("settings-nav-security").click();
  await expect(page).toHaveURL(/\/settings\/security$/u);
  await expect(page.getByTestId("security-settings")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("back-to-workspace").click();
  await expect(page).toHaveURL(noteUrl);
  await expect(page.getByTestId("workspace-surface")).toBeVisible();
  await expect(page.getByTestId("active-item-title")).toHaveValue(pageName);
  await expect(settingsTrigger).toBeFocused();
  await expect
    .poll(() => workspaceMain.evaluate((scroller) => scroller.scrollTop))
    .toBeGreaterThan(100);

  const rememberedBlockVisible = await workspaceMain.evaluate((scroller, blockId) => {
    const block = scroller.querySelector<HTMLElement>(`.bn-block-outer[data-id="${blockId}"]`);
    if (block === null) return false;
    const rect = block.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  }, rememberedBlockId);
  expect(rememberedBlockVisible).toBe(true);
});
