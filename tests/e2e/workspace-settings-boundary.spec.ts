/**
 * Knowledge stays in the workspace; operational surfaces have their own
 * destination and returning preserves the exact reading context (T222).
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  trashItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const PARAGRAPHS = 10;

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
  await fillLongPage(page);

  const workspaceMain = page.getByTestId("workspace-main");
  await expect(workspaceMain).toBeVisible();
  await expect(workspaceMain.locator('[data-testid="storage-panel"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="mutation-status"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="item-details"]')).toHaveCount(0);
  await expect(workspaceMain.locator('[data-testid="revision-restore"]')).toHaveCount(0);
  await expect(workspaceMain.locator(`[data-testid="trash-item-${discardedName}"]`)).toHaveCount(0);

  const rememberedBlockId = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]"));
    const target = blocks.at(-2);
    if (target === undefined) return null;
    target.scrollIntoView({ block: "center" });
    return target.dataset["id"] ?? null;
  });
  expect(rememberedBlockId).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  const settingsTrigger = page.getByTestId("toggle-security-settings");
  await settingsTrigger.click();
  await expect(page.getByTestId("settings-shell")).toBeVisible();
  await expect(page.getByTestId("workspace-surface")).toBeHidden();

  await page.getByTestId("settings-nav-backups").click();
  await expect(page.getByTestId("backup-panel")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("settings-nav-local-data").click();
  await expect(page.getByTestId("storage-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mutation-status-empty")).toBeVisible();

  await page.getByTestId("settings-nav-trash").click();
  await expect(page.getByTestId(`trash-item-${discardedName}`)).toBeVisible();

  await page.getByTestId("settings-nav-page-details").click();
  await expect(page.getByTestId("item-details")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("revision-restore")).toBeVisible();

  await page.getByTestId("settings-nav-security").click();
  await expect(page.getByTestId("security-settings")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("back-to-workspace").click();
  await expect(page.getByTestId("workspace-surface")).toBeVisible();
  await expect(page.getByTestId("active-item-title")).toHaveText(pageName);
  await expect(settingsTrigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  const rememberedBlockVisible = await page.evaluate((blockId) => {
    const block = document.querySelector<HTMLElement>(`.bn-block-outer[data-id="${blockId}"]`);
    if (block === null) return false;
    const rect = block.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }, rememberedBlockId);
  expect(rememberedBlockVisible).toBe(true);
});
