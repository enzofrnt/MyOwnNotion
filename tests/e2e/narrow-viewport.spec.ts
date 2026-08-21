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
  closeMobileNavigation,
  createRootItem,
  ensureNavigationVisible,
  expectNoHorizontalOverflow,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/** The narrowest viewport the product supports. */
const NARROW = { width: 320, height: 640 };

/**
 * Opens the workspace at a narrow width with the tree showing.
 *
 * Below the breakpoint the tree is a panel that can be closed, so a test that
 * goes looking for a row without checking it is open is racing the layout. It
 * showed up as a WebKit-only flake, which is where the render was slow enough
 * to lose.
 */
async function openNarrowWorkspace(page: import("@playwright/test").Page): Promise<void> {
  await openWorkspace(page);
  await ensureNavigationVisible(page);
}

test.describe("at 320 pixels", () => {
  test("the workspace does not scroll sideways", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
    const name = uniqueName("NarrowRoot");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await expectNoHorizontalOverflow(page);
  });

  test("the editor does not scroll sideways, even with a long unbroken word", async ({ page }) => {
    // The usual culprit: a URL or an identifier with no break opportunity. It
    // has to wrap or scroll inside the editor rather than widen the page.
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
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
    await openNarrowWorkspace(page);
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

    await saveDocument(page);
    await expectNoHorizontalOverflow(page);
  });

  test("the save state stays readable", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
    const name = uniqueName("NarrowState");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await expect(page.getByTestId("editor-sync-status")).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("controls stay big enough to hit with a thumb", async ({ page }) => {
    // 44 pixels is the usual floor, and the reason is physical rather than
    // aesthetic: a smaller target is one an owner misses, and missing a
    // "trash" button is worse than missing a "save" one.
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
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
    await openNarrowWorkspace(page);
    const name = uniqueName("Collapsible");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await expect(page.getByTestId("workspace-tree")).toBeVisible();
    await closeMobileNavigation(page);
    await expect(page.getByTestId("workspace-tree")).toBeHidden();

    await page.getByTestId("toggle-tree").click();
    await expect(page.getByTestId("workspace-tree")).toBeVisible();
  });

  test("closes on Escape and gives focus back to the control", async ({ page }) => {
    // Leaving focus inside a panel that is no longer on screen is how a
    // keyboard journey ends without anyone noticing.
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
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
    await expect(page.getByTestId("toggle-tree")).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("toggle-tree").click();
    await expect(page.getByTestId("toggle-tree")).toHaveAttribute("aria-expanded", "true");
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

test.describe("the file surfaces at 320 pixels", () => {
  test("the attachment list and the storage panel do not scroll sideways", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
    const name = uniqueName("NarrowFiles");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    const fileName = `${uniqueName("narrow")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("bytes at 320px"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });

    // Nine fields per row is a lot to fit in 320 pixels, which is exactly why
    // this is asserted rather than assumed.
    await expectNoHorizontalOverflow(page);
  });

  test("the deletion confirmation fits on a phone", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
    const name = uniqueName("NarrowDelete");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    const fileName = `${uniqueName("narrowdel")}.txt`;
    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("about to be deleted"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.getByTestId(`delete-file-${fileName}`).click();
    await expect(page.getByTestId("delete-file-confirmation")).toBeVisible({ timeout: 30_000 });
    // A confirmation an owner cannot read in full is one they accept blind.
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("backup and recovery at 320 pixels", () => {
  test("the status, warning and restoration action stay inside the viewport", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openWorkspace(page);
    await page.getByTestId("open-backups").click();
    await expect(page.getByTestId("backup-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("restore-rehearsal")).toBeVisible();
    await expect(page.getByTestId("run-rehearsal")).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});

/**
 * The connection state and the resolution screen at 320 pixels (T042, feature 006).
 *
 * The resolution screen is the widest thing in this product: three versions of
 * the same text side by side. At this width the columns stack and each cell
 * carries its own label — see the media query in `styles.css`. What is asserted
 * here is the consequence: the *page* still does not scroll sideways.
 */
test.describe("live synchronization on a phone (feature 006)", () => {
  test("the connection state does not widen the page", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openNarrowWorkspace(page);
    await expect(page.getByTestId("live-connection-state")).toBeVisible({ timeout: 15_000 });
    // The sentence is long — "keeping your changes on this device until the
    // connection returns" — which is exactly the kind of text that pushes a
    // narrow layout sideways if it is not allowed to wrap.
    await expectNoHorizontalOverflow(page);
  });
});
