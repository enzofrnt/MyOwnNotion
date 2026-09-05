import { expect, test } from "./fixtures.ts";
import { createRootItem, openWorkspace, selectItem, uniqueName } from "./helpers.ts";

for (const theme of ["light", "dark"] as const) {
  test(`keeps an empty editable line visible and focused with the active ${theme} styles`, async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const name = uniqueName("Empty caret");
    await createRootItem(page, "page", name);
    await selectItem(page, name);
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible();
    const line = editor.locator(".bn-inline-content").first();
    await line.click();
    const state = await line.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: bounds.width,
        height: bounds.height,
        caret: style.caretColor,
        color: style.color,
        focused: element.closest(".ProseMirror") === document.activeElement,
      };
    });
    expect(state.width).toBeGreaterThanOrEqual(2);
    expect(state.height).toBeGreaterThan(0);
    expect(state.caret).toBe(state.color);
    expect(state.caret).not.toBe("rgba(0, 0, 0, 0)");
    expect(state.focused).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`active-editor-${theme}.png`) });
    await page.keyboard.type("Visible input");
    await expect(line).toHaveText("Visible input");
  });
}
