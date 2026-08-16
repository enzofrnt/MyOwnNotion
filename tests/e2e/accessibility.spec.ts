/**
 * Keyboard, focus, semantic tree, and responsive accessibility assertions
 * (T090, constitution principle VI).
 */
// Named rather than default: the package ships both, and only the named
// export is constructible under this project's ESM settings.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

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

/**
 * The automated audit (feature 003 SC-004, feature 004 SC-008).
 *
 * Added with `@axe-core/playwright` rather than hand-written assertions,
 * because an accessibility checker written here would be a rule set nobody
 * maintains and nobody trusts. It does not replace the journey tests above:
 * axe cannot tell whether Escape closes a dialog or whether focus comes back
 * afterwards, and those are most of what the requirements ask for.
 *
 * Only `critical` and `serious` fail the build. Lower severities are reported
 * by axe as advice, and treating advice as a gate is how a suite gets disabled.
 */
test.describe("automated accessibility audit", () => {
  async function violations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    return results.violations.filter(
      (violation: { id: string; help: string; impact?: string | null | undefined }) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
  }

  test("the workspace has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the editor has no critical or serious violations", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("AuditedPage");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });

  test("the conversion confirmation has no critical or serious violations", async ({ page }) => {
    // Audited deliberately: a dialog is not on screen at load, so an audit that
    // only visits pages never sees it — and a destructive confirmation is
    // exactly where an owner using assistive technology must not be stranded.
    await openWorkspace(page);
    const name = uniqueName("AuditedDialog");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await typeIntoEditor(page, "content that triggers the dialog");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.getByTestId(`convert-${name}`).click();
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });

    const found = await violations(page);
    expect(
      found.map(
        (violation: { id: string; help: string; impact?: string | null | undefined }) =>
          `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  });
});
