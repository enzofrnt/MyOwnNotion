import { expect, test } from "@playwright/test";
import { createRootItem, openWorkspace, selectItem, uniqueName } from "./helpers.ts";

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
      const editor = page.getByRole("textbox", { name: "Page content" });
      await editor.fill(`/${command.query}`);
      const menu = page.getByRole("listbox", { name: "Insert block" });
      await expect(menu.getByRole("option")).toHaveCount(1);
      await editor.press("Enter");
      if (command.text === null) {
        await expect(page.locator(command.selector)).toHaveCount(1);
      } else {
        await page.keyboard.type(command.text);
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

    await editor.fill("New block");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("/");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(10);
    await editor.type("task");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu.getByRole("option", { name: /Task list/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await editor.press("Enter");
    await expect(menu).toHaveCount(0);
    await editor.type("Created from the slash menu");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Created from the slash menu",
    );

    await editor.fill("/nothing-matches");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("No matching blocks");
    await editor.press("Escape");
    await expect(menu).toHaveCount(0);

    await editor.fill("Outside dismissal");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("/");
    await expect(menu).toBeVisible();
    await page.getByRole("heading", { name: "Page editor" }).click();
    await expect(menu).toHaveCount(0);
  });

  test("keeps the command menu inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    const pageName = uniqueName("SlashMobile");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await page.getByRole("textbox", { name: "Page content" }).fill("/");

    const menu = page.getByRole("listbox", { name: "Insert block" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 391)).toBeLessThanOrEqual(390);
  });
});
