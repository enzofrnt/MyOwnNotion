import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspace, saveDocument, selectItem, uniqueName } from "./helpers.ts";

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`keeps slash options reachable by keyboard and pointer at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 664 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await openWorkspace(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const name = uniqueName("Menu blocks");
      await createRootItem(page, "page", name);
      await selectItem(page, name);
      const editor = page.locator('[data-testid="block-editor"]:visible .ProseMirror');
      await expect(editor).toBeVisible();
      await editor.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      await page.keyboard.type(
        "Première ligne. Le contenu reste disponible pendant le choix du prochain bloc. ".repeat(3),
      );
      await saveDocument(page);
      await expect(editor).toBeFocused();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("/tab");
      const menu = page.getByRole("listbox");
      const table = menu.getByRole("option", { name: /^Tableau simple/u });
      await expect(table).toBeVisible();
      await expect
        .poll(async () => {
          const box = await menu.boundingBox();
          return (
            box !== null &&
            box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= width + 1 &&
            box.y + box.height <= 665
          );
        })
        .toBe(true);

      // Keyboard selection must reveal the last option in the bounded menu.
      const options = await menu.getByRole("option").count();
      for (let index = 1; index < options; index += 1) await page.keyboard.press("ArrowDown");
      await expect(table).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() =>
          table.evaluate((item) => {
            const bounds = item.getBoundingClientRect();
            const viewport = item.closest('[role="listbox"]')?.getBoundingClientRect();
            return (
              viewport !== undefined &&
              bounds.top >= viewport.top &&
              bounds.bottom <= viewport.bottom
            );
          }),
        )
        .toBe(true);
      await expect(menu.locator("..")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: testInfo.outputPath("bounded-slash-menu.png") });
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(editor).toBeFocused();

      // Reopen with the first option selected, then let the normal pointer
      // action reveal and activate the last one. No forced click or pre-scroll.
      for (let index = 0; index < 4; index += 1) await page.keyboard.press("Backspace");
      await page.keyboard.type("/tab");
      await expect(table).toBeVisible();
      await expect(table).not.toHaveAttribute("aria-selected", "true");
      await table.click();
      await expect(menu).toBeHidden();
      await expect(editor.locator(".editor-table-cell")).toHaveCount(6);
      await expect(editor).toContainText("Première ligne");
    });
  }
}
