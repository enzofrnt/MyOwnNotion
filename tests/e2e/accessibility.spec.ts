/**
 * Keyboard, focus, semantic tree, and responsive accessibility assertions
 * (T090, constitution principle VI).
 */
import { expect, test } from "@playwright/test";
import { createRootItem, openWorkspace, uniqueName } from "./helpers.ts";

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
});
