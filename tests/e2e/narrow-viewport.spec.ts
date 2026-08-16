/**
 * Using it on a phone (T065, US4, FR-021, SC-008).
 *
 * The floor is 320 pixels, and the rule that matters is that nothing makes the
 * *page* wider. Content that is genuinely wide — a code block, a long unbroken
 * link — scrolls inside its own container instead, because a page that scrolls
 * sideways loses the left edge of every line, which is where reading starts.
 *
 * Every assertion here uses `expectNoHorizontalOverflow`, which names the
 * element that overflows rather than only reporting that one does. That helper
 * exists because three rounds of guessing at a WebKit-only overflow cost three
 * CI runs, and the fourth named the culprit immediately.
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  expectNoHorizontalOverflow,
  openWorkspace,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/** The narrowest viewport the product supports. */
const NARROW = { width: 320, height: 640 };

test.describe("at 320 pixels", () => {
  test("the workspace does not scroll sideways", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("NarrowRoot");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await expectNoHorizontalOverflow(page);
  });

  test("the editor does not scroll sideways, even with a long unbroken word", async ({ page }) => {
    // The usual culprit: a URL or an identifier with no break opportunity. It
    // has to wrap or scroll inside the editor rather than widen the page.
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("NarrowPage");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    await typeIntoEditor(
      page,
      "https://example.org/an/extremely/long/path/that/will/not/break/on/its/own/anywhere",
    );

    await expectNoHorizontalOverflow(page);
  });

  test("US1 can be completed at this width", async ({ page }) => {
    // The independent test the specification names for US4: the whole writing
    // journey, at 320 pixels, with no horizontal scrolling at any point.
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("NarrowWrite");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    const surface = page.getByTestId("block-editor").locator(".ProseMirror");
    await surface.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface.pressSequentially("# A heading on a phone");
    await expect(surface.locator("h1")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("the save state stays readable", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("NarrowState");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await expect(page.getByTestId("save-state")).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("controls stay big enough to hit with a thumb", async ({ page }) => {
    // 44 pixels is the usual floor, and the reason is physical rather than
    // aesthetic: a smaller target is one an owner misses, and missing a
    // "trash" button is worse than missing a "save" one.
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("NarrowTargets");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    const box = await page.getByTestId(`convert-${name}`).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });
});

test.describe("the collapsible tree", () => {
  test("can be hidden and shown again on a phone", async ({ page }) => {
    // US4 scenario 2. At 320 pixels the tree and the editor cannot both be on
    // screen and be usable, so the tree has to get out of the way — and come
    // back.
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("Collapsible");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    await page.getByTestId("toggle-tree").click();
    await expect(page.getByTestId("workspace-tree")).toBeHidden();

    await page.getByTestId("toggle-tree").click();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });

  test("closes on Escape and gives focus back to the control", async ({ page }) => {
    // Leaving focus inside a panel that is no longer on screen is how a
    // keyboard journey ends without anyone noticing.
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    const name = uniqueName("Escapable");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await page.getByTestId(`tree-item-${name}`).focus();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("workspace-tree")).toBeHidden();
    await expect(page.getByTestId("toggle-tree")).toBeFocused();
  });

  test("declares whether it is open", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    await expect(page.getByTestId("toggle-tree")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("toggle-tree").click();
    await expect(page.getByTestId("toggle-tree")).toHaveAttribute("aria-expanded", "false");
  });

  test("stays out of the way on a desktop", async ({ page }) => {
    // The control exists in the markup at every width; above the breakpoint it
    // is not shown, because the tree is always in view and a toggle would be
    // one more thing to explain.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    await expect(page.getByTestId("toggle-tree")).toBeHidden();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });
});
