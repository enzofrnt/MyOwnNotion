/**
 * Returning to a long page lands where the owner left it (T109, US4, SC-008).
 *
 * The anchor is content, not pixels: blocks above may have grown or shrunk by
 * the time the owner returns, so the assertion is about the remembered
 * paragraph being back under the viewport top — not about an identical
 * scrollY. A late jump after first paint is exactly the failure FR-009
 * forbids, so the position must already be settled when the editor appears.
 */

import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspace, selectItem, uniqueName } from "./helpers.ts";

const PARAGRAPHS = 12;

async function fillLongPage(page: import("@playwright/test").Page): Promise<void> {
  const editor = page.getByTestId("block-editor").locator(".ProseMirror");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  for (let index = 1; index <= PARAGRAPHS; index += 1) {
    if (index > 1) {
      // The editor's own « insert below » chord splits blocks identically on
      // every profile; a plain Enter does not split at all under mobile
      // browser emulation.
      await expect(editor).toBeFocused();
      await editor.press("ControlOrMeta+Alt+Enter");
    }
    await editor.pressSequentially(`Paragraphe ${index} à lire`);
  }
  const blocks = editor.locator(".bn-block-outer[data-id]");
  await expect(blocks).toHaveCount(PARAGRAPHS);
  const status = page.getByTestId("editor-sync-status");
  if (await status.count()) {
    await expect(status).toHaveAttribute("data-sync", "synced", { timeout: 30_000 });
  }
}

test.describe("scroll restoration", () => {
  test("coming back to a long page restores the remembered neighbourhood", async ({ page }) => {
    const pageName = uniqueName("LongRead");
    const otherName = uniqueName("Elsewhere");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await createRootItem(page, "folder", otherName);
    await selectItem(page, pageName);
    await fillLongPage(page);

    // Scroll deep into the document by absolute position: a session upgrade
    // can remount the surface under a kept scroll offset, leaving the
    // viewport in empty space, so the target is the last block itself.
    await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll(".bn-block-outer[data-id]"));
      const last = blocks.at(-1);
      if (last === undefined) return;
      const top = last.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - window.innerHeight / 2));
    });
    await page.waitForFunction(() => window.scrollY > 100);
    // The promise (FR-009, SC-008) is about the remembered neighbourhood,
    // not about pixels: whatever block topped the viewport when the owner
    // left must be back in view when they return.
    const rememberedBlockId = await page.evaluate(() => {
      for (const block of Array.from(document.querySelectorAll(".bn-block-outer[data-id]"))) {
        if (block.getBoundingClientRect().bottom > 0) {
          return block.getAttribute("data-id");
        }
      }
      return null;
    });
    if (rememberedBlockId === null) {
      const diagnosis = await page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        blocks: document.querySelectorAll(".bn-block-outer[data-id]").length,
        editors: document.querySelectorAll(".ProseMirror").length,
      }));
      throw new Error(`no block was visible before leaving: ${JSON.stringify(diagnosis)}`);
    }

    // Leave and come back.
    await selectItem(page, otherName);
    await selectItem(page, pageName);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(100);
    const restoredVisible = await page.evaluate((id) => {
      const element = document.querySelector(`.bn-block-outer[data-id="${id}"]`);
      if (element === null) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }, rememberedBlockId);
    expect(restoredVisible).toBe(true);
  });
});
