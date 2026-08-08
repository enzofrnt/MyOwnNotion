import { expect, test } from "@playwright/test";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("block editor (US1)", () => {
  test("writes, formats, saves, reloads, and restores history", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("Editor");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("document-body")).toHaveCount(0);
    const toolbar = page.getByRole("toolbar", { name: "Page formatting" });

    await toolbar.getByRole("button", { name: "Heading 2", exact: true }).click();
    await page.keyboard.type("A durable heading");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Formatted body");
    await expect(page.locator(".ProseMirror h2")).toContainText("A durable heading");
    const bodyParagraph = page.locator(".ProseMirror p").filter({ hasText: "Formatted body" });
    await bodyParagraph.selectText();
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator(".ProseMirror strong")).toContainText("Formatted body");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Task list", exact: true }).click();
    await page.keyboard.type("Checklist item");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Checklist item",
    );
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.locator(".ProseMirror h2")).toContainText("A durable heading");
    await toolbar.getByRole("button", { name: "Quote", exact: true }).click();
    await page.keyboard.type("Quoted note");
    await expect(page.locator(".ProseMirror blockquote")).toContainText("Quoted note");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Code block", exact: true }).click();
    await page.keyboard.type("const answer = 42");
    await toolbar.getByRole("button", { name: "Insert divider", exact: true }).click();

    await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".ProseMirror hr")).toHaveCount(0);
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator(".ProseMirror hr")).toHaveCount(1);

    const acceptedSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/v1/mutations/batch") &&
        response.ok(),
    );
    await page.getByRole("button", { name: "Save page" }).click();
    await acceptedSave;
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    await expect(page.getByRole("textbox", { name: "Page content" })).toContainText(
      "A durable heading",
    );
    await expect(page.locator(".ProseMirror h2")).toContainText("A durable heading");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Checklist item",
    );
    await expect(page.locator(".ProseMirror blockquote")).toContainText("Quoted note");
    await expect(page.locator(".ProseMirror pre")).toContainText("const answer = 42");
    await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
  });

  test("round-trips every supported block, mark, order, and checklist state", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("CompleteEditor");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByRole("textbox", { name: "Page content" });
    const toolbar = page.getByRole("toolbar", { name: "Page formatting" });

    const addBlock = async (button: string, text: string) => {
      await toolbar.getByRole("button", { name: button, exact: true }).click();
      await expect(editor).toBeFocused();
      await page.keyboard.type(text);
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
    };
    await addBlock("Heading 1", "Complete heading one");
    await addBlock("Heading 2", "Complete heading two");
    await addBlock("Heading 3", "Complete heading three");
    await page.keyboard.type("Complete paragraph");
    await page.keyboard.press("Enter");

    for (const mark of [
      { button: "Bold", text: "Complete bold", selector: "strong" },
      { button: "Italic", text: "Complete italic", selector: "em" },
      { button: "Strike", text: "Complete strike", selector: "s" },
      { button: "Inline code", text: "Complete inline code", selector: "p code" },
    ]) {
      const markButton = toolbar.getByRole("button", { name: mark.button, exact: true });
      await markButton.click();
      await expect(editor).toBeFocused();
      await page.keyboard.type(mark.text);
      const markedText = page
        .locator(`.ProseMirror ${mark.selector}`)
        .filter({ hasText: mark.text });
      await expect(markedText).toContainText(mark.text);
      await markButton.click();
      await expect(editor).toBeFocused();
      await page.keyboard.press("Enter");
    }

    await toolbar.getByRole("button", { name: "Bullet list", exact: true }).click();
    await page.keyboard.type("Complete bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Numbered list", exact: true }).click();
    await page.keyboard.type("Complete numbered");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Task list", exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("Complete checked task");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Quote", exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("Complete quote");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Code block", exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("const complete = true");
    await toolbar.getByRole("button", { name: "Insert divider", exact: true }).click();
    await page.getByRole("checkbox", { name: "Mark task complete" }).click();

    await expect(
      page.locator(".ProseMirror strong").filter({ hasText: "Complete bold" }),
    ).toContainText("Complete bold");
    await expect(
      page.locator(".ProseMirror em").filter({ hasText: "Complete italic" }),
    ).toContainText("Complete italic");
    await expect(
      page.locator(".ProseMirror s").filter({ hasText: "Complete strike" }),
    ).toContainText("Complete strike");
    await expect(
      page.locator(".ProseMirror p code").filter({ hasText: "Complete inline code" }),
    ).toContainText("Complete inline code");

    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("document-saved")).toBeVisible();
    await waitForSynchronized(page);
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);

    await expect(page.locator(".ProseMirror h1")).toContainText("Complete heading one");
    await expect(page.locator(".ProseMirror h2")).toContainText("Complete heading two");
    await expect(page.locator(".ProseMirror h3")).toContainText("Complete heading three");
    await expect(page.locator(".ProseMirror strong")).toContainText("Complete bold");
    await expect(page.locator(".ProseMirror em")).toContainText("Complete italic");
    await expect(page.locator(".ProseMirror s")).toContainText("Complete strike");
    await expect(page.locator(".ProseMirror p code")).toContainText("Complete inline code");
    await expect(page.locator(".ProseMirror ul:not([data-type='taskList'])")).toContainText(
      "Complete bullet",
    );
    await expect(page.locator(".ProseMirror ol")).toContainText("Complete numbered");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Complete checked task",
    );
    await expect(
      page.locator(".ProseMirror ul[data-type='taskList']").getByRole("checkbox"),
    ).toBeChecked();
    await expect(page.locator(".ProseMirror blockquote")).toContainText("Complete quote");
    await expect(page.locator(".ProseMirror pre")).toContainText("const complete = true");
    await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
    const topLevelText = await page.locator(".ProseMirror > *").allTextContents();
    expect(topLevelText.slice(0, 13)).toEqual([
      "Complete heading one",
      "Complete heading two",
      "Complete heading three",
      "Complete paragraph",
      "Complete bold",
      "Complete italic",
      "Complete strike",
      "Complete inline code",
      "Complete bullet",
      "Complete numbered",
      "Complete checked task",
      "Complete quote",
      "const complete = true",
    ]);
  });

  test("supports plain-text copy and paste without a network conversion", async ({
    page,
    browserName,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("Clipboard");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.fill("Portable plain text");
    await editor.press("ControlOrMeta+A");
    let copied: string;
    if (browserName === "chromium") {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await editor.press("ControlOrMeta+C");
      copied = await page.evaluate(() => navigator.clipboard.readText());
    } else {
      copied = await editor.evaluate(() => window.getSelection()?.toString() ?? "");
    }
    expect(copied).toContain("Portable plain text");
    await editor.fill("");
    await editor.click();
    if (browserName === "chromium") {
      await page.evaluate(() => navigator.clipboard.writeText("Portable plain text"));
      await editor.press("ControlOrMeta+V");
    } else {
      // Firefox/WebKit clipboard permissions are unreliable in CI; prove the
      // editor accepts plain text without a network conversion path.
      await page.keyboard.insertText("Portable plain text");
    }
    await expect(editor).toHaveText("Portable plain text");
  });

  test("never offers page editing for a folder", async ({ page }) => {
    await openWorkspace(page);
    const folderName = uniqueName("FolderOnly");
    await createRootItem(page, "folder", folderName);
    await selectItem(page, folderName);
    await expect(page.getByRole("textbox", { name: "Page content" })).toHaveCount(0);
  });
});
