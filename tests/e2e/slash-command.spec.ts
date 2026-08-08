import { expect, type Page, test } from "@playwright/test";
import { createRootItem, openWorkspace, selectItem, uniqueName } from "./helpers.ts";

async function openSlashMenu(page: Page, query = ""): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Page content" });
  await editor.scrollIntoViewIfNeeded();
  await editor.click();
  await expect(editor).toBeFocused({ timeout: 5_000 });
  // Character-by-character input is required so TipTap Suggestion sees "/".
  await page.keyboard.type(`/${query}`, { delay: 40 });
  await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible({ timeout: 15_000 });
}

test.describe("slash block commands (US2)", () => {
  test("inserts every catalogue block through the command menu", async ({ page }) => {
    await openWorkspace(page);
    const cases = [
      { query: "paragraph", selector: ".ProseMirror p", text: "Slash paragraph" },
      { query: "h1", selector: ".ProseMirror h1", text: "Slash heading one" },
      { query: "h2", selector: ".ProseMirror h2", text: "Slash heading two" },
      { query: "h3", selector: ".ProseMirror h3", text: "Slash heading three" },
      {
        query: "bullets",
        selector: ".ProseMirror ul:not([data-type='taskList'])",
        text: "Slash bullet",
      },
      { query: "number", selector: ".ProseMirror ol", text: "Slash numbered" },
      {
        query: "task",
        selector: ".ProseMirror ul[data-type='taskList']",
        text: "Slash task",
      },
      { query: "quotation", selector: ".ProseMirror blockquote", text: "Slash quote" },
      { query: "fence", selector: ".ProseMirror pre", text: "Slash code" },
      { query: "separator", selector: ".ProseMirror hr", text: null },
    ] as const;

    for (const command of cases) {
      const pageName = uniqueName(`Slash-${command.query.replaceAll(" ", "-")}`);
      await createRootItem(page, "page", pageName);
      await selectItem(page, pageName);
      await openSlashMenu(page, command.query);
      const menu = page.getByRole("listbox", { name: "Insert block" });
      await expect(menu.getByRole("option")).toHaveCount(1);
      await page.keyboard.press("Enter");
      await expect(menu).toHaveCount(0);
      if (command.text === null) {
        await expect(page.locator(command.selector)).toHaveCount(1);
      } else {
        await page.keyboard.type(command.text, { delay: 15 });
        await expect(page.locator(command.selector)).toContainText(command.text);
      }
    }
  });

  test("filters, selects by keyboard, reports no results, and dismisses", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("SlashCommands");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByRole("textbox", { name: "Page content" });
    const menu = page.getByRole("listbox", { name: "Insert block" });

    await editor.click();
    await page.keyboard.type("New block", { delay: 15 });
    await editor.press("Enter");
    await openSlashMenu(page);
    await expect(menu.getByRole("option")).toHaveCount(12);
    await page.keyboard.type("task", { delay: 20 });
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu.getByRole("option", { name: /Task list/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await editor.press("Enter");
    await expect(menu).toHaveCount(0);
    await page.keyboard.type("Created from the slash menu", { delay: 10 });
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Created from the slash menu",
    );

    await editor.click();
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await openSlashMenu(page, "nothing-matches");
    await expect(menu).toContainText("No matching blocks");
    await editor.press("Escape");
    await expect(menu).toHaveCount(0);

    await editor.click();
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await page.keyboard.type("Outside dismissal", { delay: 15 });
    await editor.press("Enter");
    await editor.click();
    await expect(editor).toBeFocused();
    await openSlashMenu(page);
    await editor.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("keeps the command menu inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    const pageName = uniqueName("SlashMobile");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await openSlashMenu(page);

    const bounds = await page.evaluate(() => {
      const node = document.querySelector('[role="listbox"][aria-label="Insert block"]');
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: window.innerWidth,
      };
    });
    expect(bounds).not.toBeNull();
    expect(bounds?.left ?? -1).toBeGreaterThanOrEqual(-1);
    expect(bounds?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((bounds?.width ?? 0) + 1);
  });
});
