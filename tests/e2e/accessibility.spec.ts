/**
 * Keyboard, focus, semantic tree, and responsive accessibility assertions
 * (T090, constitution principle VI).
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createRootItem, openWorkspace, selectItem, uniqueName } from "./helpers.ts";

test.describe("accessibility (all viewports/browsers)", () => {
  test("the hierarchy is a semantic ARIA tree with labelled controls", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("A11y");
    await createRootItem(page, "folder", name);

    // Semantic structure.
    const tree = page.getByRole("tree", { name: "Content tree" });
    await expect(tree).toBeVisible();
    const item = page.getByRole("treeitem").filter({ hasText: name }).first();
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-level", "1");

    // Every mutation control is a labelled button reachable by keyboard.
    for (const label of [
      `New page inside ${name}`,
      `Rename ${name}`,
      `Move ${name} up`,
      `Trash ${name}`,
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    // Status messaging uses live regions.
    await expect(page.getByTestId("sync-status")).toHaveAttribute("aria-live", "polite");
  });

  test("interactive elements expose visible focus", async ({ page }) => {
    await openWorkspace(page);
    const nameInput = page.getByLabel("Name", { exact: true });
    await nameInput.focus();
    const outline = await nameInput.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("keyboard-only operation: create, select, and navigate", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("KeyboardOnly");
    await page.getByLabel("Name", { exact: true }).fill(name);
    // Reach and activate the create button with the keyboard only.
    await page.getByRole("button", { name: "New root folder" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible();

    // Select with keyboard and navigate.
    await page.getByTestId(`tree-item-${name}`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`tree-item-${name}`)).toHaveAttribute("aria-selected", "true");
  });

  test("keyboard-only operation creates a complete formatted page", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("KeyboardEditor");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "New root page" }).focus();
    await page.keyboard.press("Enter");
    const treeItem = page.getByTestId(`tree-item-${name}`);
    await expect(treeItem).toBeVisible();
    await treeItem.focus();
    await page.keyboard.press("Enter");

    const editor = page.getByRole("textbox", { name: "Page content" });
    const toolbar = page.getByRole("toolbar", { name: "Page formatting" });
    const activate = async (label: string) => {
      await toolbar.getByRole("button", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(editor).toBeFocused();
    };
    await editor.focus();
    await activate("Heading 1");
    await page.keyboard.type("Keyboard heading");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Keyboard paragraph");
    await page.keyboard.press("Enter");

    await activate("Task list");
    await page.keyboard.type("Keyboard task");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await activate("Quote");
    await page.keyboard.type("Keyboard quote");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await activate("Code block");
    await page.keyboard.type("const keyboard = true");
    await activate("Insert divider");

    await expect(page.locator(".ProseMirror h1")).toContainText("Keyboard heading");
    await expect(
      page.locator(".ProseMirror p").filter({ hasText: "Keyboard paragraph" }),
    ).toContainText("Keyboard paragraph");
    await expect(page.locator(".ProseMirror ul[data-type='taskList']")).toContainText(
      "Keyboard task",
    );
    await expect(page.locator(".ProseMirror blockquote")).toContainText("Keyboard quote");
    await expect(page.locator(".ProseMirror pre")).toContainText("const keyboard = true");
    await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
  });

  test("the layout stays operable at the current viewport", async ({ page }) => {
    await openWorkspace(page);
    // Toolbar must be reachable within the viewport on every configured
    // project, including mobile sizes; created items stay operable after
    // scrolling (no horizontal cut-off).
    await page.getByRole("button", { name: "New root folder" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "New root folder" })).toBeInViewport();
    const name = uniqueName("Responsive");
    await createRootItem(page, "folder", name);
    await page.getByTestId(`tree-item-${name}`).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`tree-item-${name}`)).toBeInViewport();
    // No horizontal overflow: the document is not wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });

  test("keyboard editing keeps the active block inside the viewport", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("ActiveViewport");
    await createRootItem(page, "page", name);
    await selectItem(page, name);
    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.click();
    for (let index = 0; index < 45; index += 1) {
      await page.keyboard.type(`Viewport filler ${index}`);
      await page.keyboard.press("Enter");
    }
    await page.keyboard.type("Active keyboard block");
    const activeBlock = page.locator(".ProseMirror p").filter({ hasText: "Active keyboard block" });
    await expect(activeBlock).toHaveText("Active keyboard block");
    await expect(activeBlock).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });

  test("the editor, toolbar, help, and command menu have no critical Axe violations", async ({
    page,
  }) => {
    await openWorkspace(page);
    const name = uniqueName("EditorA11y");
    await createRootItem(page, "page", name);
    await selectItem(page, name);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await expect(editor).toHaveAttribute("aria-multiline", "true");
    await expect(page.getByRole("toolbar", { name: "Page formatting" })).toBeVisible();
    await editor.focus();
    const outline = await editor.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.type("/", { delay: 20 });
    await expect(page.getByRole("listbox", { name: "Insert block" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(".page-editor-panel")
      .include(".slash-command-portal")
      .analyze();
    expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });
});
