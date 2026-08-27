/** Touch alternatives, popup edges and motion preferences (T161, US7). */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationVisible,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("touch and non-hover alternatives", () => {
  test("item actions are tappable without hover and their menu stays in the viewport", async ({
    page,
    isMobile,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openWorkspace(page);
    const name = uniqueName("TouchActions");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    const trigger = page.getByTestId(`item-actions-${name}`);
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(isMobile === true ? 44 : 24);
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(isMobile === true ? 44 : 24);

    if (isMobile === true && triggerBox !== null) {
      await page.touchscreen.tap(
        triggerBox.x + triggerBox.width / 2,
        triggerBox.y + triggerBox.height / 2,
      );
    } else {
      // The fine-pointer stylesheet intentionally hides row actions until the
      // row owns focus. Focus through the DOM so this remains a no-hover
      // journey without asking Playwright to satisfy pointer hit-testing first.
      await trigger.evaluate((element) => (element as HTMLElement).focus());
      await page.keyboard.press("Enter");
    }

    const menu = page.getByRole("menu", { name: `Actions pour ${name}` });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(321);
  });

  test("the block context menu has a keyboard alternative and restores the editor focus", async ({
    page,
  }) => {
    await openWorkspace(page);
    const name = uniqueName("ContextAlternative");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await waitForEditor(page);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await editor.click();
    await editor.pressSequentially("Actions accessibles");

    await editor.press("Shift+F10");
    const menu = page.getByRole("menu", { name: "Actions du bloc" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(editor).toBeFocused();
  });
});

test.describe("reduced motion", () => {
  test("motion is suppressed while the save status remains visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page);
    const name = uniqueName("ReducedMotion");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    // Page creation is navigation: on mobile it deliberately closes the
    // drawer and opens the new page. Reopening the drawer to select that same
    // row can race the asynchronous close on a slow WebKit runner, while also
    // testing an interaction this journey does not need.
    await expect(page.getByTestId("active-item-title")).toHaveValue(name);
    await waitForEditor(page);

    const undo = page.getByTestId("undo");
    const motion = await undo.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
        transitionDuration: style.transitionDuration,
      };
    });
    const durationInMilliseconds = (value: string): number =>
      value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1_000;
    expect(durationInMilliseconds(motion.animationDuration)).toBeLessThanOrEqual(0.011);
    expect(motion.animationIterationCount).toBe("1");
    expect(
      motion.transitionDuration
        .split(", ")
        .every((value) => durationInMilliseconds(value) <= 0.011),
    ).toBe(true);

    const status = page.getByTestId("editor-sync-status");
    await expect(status).toBeVisible();
  });
});
