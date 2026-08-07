import { expect, test } from "@playwright/test";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("Markdown block shortcuts (US3)", () => {
  test("creates every documented block with keyboard input", async ({ page }) => {
    await openWorkspace(page);
    const openEmptyPage = async (name: string) => {
      const pageName = uniqueName(name);
      await createRootItem(page, "page", pageName);
      await selectItem(page, pageName);
      return page.getByRole("textbox", { name: "Page content" });
    };

    let editor = await openEmptyPage("ShortcutH1");
    await editor.type("# Heading");
    await expect(page.locator(".ProseMirror h1")).toContainText("Heading");

    editor = await openEmptyPage("ShortcutH2");
    await editor.type("## Heading");
    await expect(page.locator(".ProseMirror h2")).toContainText("Heading");

    editor = await openEmptyPage("ShortcutH3");
    await editor.type("### Heading");
    await expect(page.locator(".ProseMirror h3")).toContainText("Heading");

    editor = await openEmptyPage("ShortcutBullet");
    await editor.type("- Bullet");
    await expect(page.locator(".ProseMirror ul:not([data-type='taskList'])")).toContainText(
      "Bullet",
    );

    editor = await openEmptyPage("ShortcutNumbered");
    await editor.type("1. Numbered");
    await expect(page.locator(".ProseMirror ol")).toContainText("Numbered");

    editor = await openEmptyPage("ShortcutTask");
    await editor.type("[ ] Task");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText("Task");

    editor = await openEmptyPage("ShortcutQuote");
    await editor.type("> Quoted");
    await expect(page.locator(".ProseMirror blockquote")).toContainText("Quoted");

    editor = await openEmptyPage("ShortcutCode");
    await editor.type("``` const shortcut = true");
    await expect(page.locator(".ProseMirror pre")).toContainText("const shortcut = true");

    editor = await openEmptyPage("ShortcutDivider");
    await editor.type("---");
    await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
  });

  test("does not transform mid-block lookalikes and undo restores literal input", async ({
    page,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("MarkdownSafety");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByRole("textbox", { name: "Page content" });

    await editor.type("ordinary # text - [ ] and ``` markers");
    await expect(page.locator(".ProseMirror p")).toContainText(
      "ordinary # text - [ ] and ``` markers",
    );
    await expect(page.locator(".ProseMirror h1, .ProseMirror ul, .ProseMirror pre")).toHaveCount(0);

    const undoPageName = uniqueName("MarkdownUndo");
    await createRootItem(page, "page", undoPageName);
    await waitForSynchronized(page);
    await selectItem(page, undoPageName);
    const undoEditor = page.getByRole("textbox", { name: "Page content" });
    await undoEditor.type("# ");
    await undoEditor.press("ControlOrMeta+Z");
    await expect(page.locator(".ProseMirror p").filter({ hasText: "#" })).toHaveCount(1);
  });
});
