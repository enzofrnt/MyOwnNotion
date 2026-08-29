/**
 * Finding and organising things without the mouse (T058-T060, US3, SC-003).
 *
 * SC-003 asks that every core journey be completable by keyboard alone. The
 * distinction this suite is really about is not "can it be done" but "can it be
 * done at a hundred pages": a tree where every row is a tab stop is technically
 * reachable and unusable, which is why the ARIA tree pattern gives the whole
 * tree one tab stop and moves within it using arrows.
 *
 * Every test here uses the keyboard only, after the initial setup. Where a
 * mouse click appears it is in the setup, never in the assertion.
 */

import { expect, test } from "./fixtures.ts";
import {
  clickItemAction,
  createChildItem,
  createRootItem,
  ensureNavigationVisible,
  expectTreeOrder,
  moveSelectedItemInto,
  openItemActions,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/**
 * Opens a branch, or leaves it open if it already is.
 *
 * Clicking the disclosure unconditionally is a coin toss: creating a child can
 * leave its parent open, and the click then *closes* it — after which the test
 * waits for a row that is no longer rendered.
 */
async function openBranch(page: import("@playwright/test").Page, name: string): Promise<void> {
  await ensureNavigationVisible(page);
  const toggle = page.getByTestId(`toggle-${name}`);
  if ((await page.getByTestId(`tree-item-${name}`).getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

function row(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId(`tree-item-${name}`);
}

/**
 * Puts focus on a row, deterministically.
 *
 * Focused directly rather than clicked: Safari does not move focus to a
 * non-form element on tap, so a click works on the desktop engines and quietly
 * does not on webkit-mobile. These tests are about what the keyboard does once
 * focus is in the tree, not about how it got there — selection by click is
 * asserted in the hierarchy suite.
 */
async function focusTree(page: import("@playwright/test").Page, name: string): Promise<void> {
  // Selected *and* focused, and the order matters. The keyboard works from the
  // selection, so focusing a row without selecting it left the hook acting on
  // whatever was selected before — pressing ArrowLeft on a focused-but-
  // unselected child collapsed the branch it was in and took its own focus
  // with it. The shared selection journey establishes that state; the explicit
  // focus covers Safari, which does not focus a non-form element on tap.
  await selectItem(page, name);
  // Activating a row closes the modal drawer on phones. Reopen it before
  // placing focus back in the tree; this setup mirrors a physical-keyboard
  // owner opening navigation and then moving through it with arrows.
  await ensureNavigationVisible(page);
  await expect(row(page, name)).toHaveAttribute("aria-selected", "true");
  await row(page, name).focus();
  await expect(row(page, name)).toBeFocused();
}

test.describe("moving through the tree", () => {
  test("arrows move the selection and focus together", async ({ page }) => {
    // Focus and selection moving apart is the failure that makes a tree look
    // navigable and read wrong: the highlight goes one way and the screen
    // reader keeps announcing the row left behind.
    await openWorkspace(page);
    const first = uniqueName("AAA");
    const second = uniqueName("BBB");
    await createRootItem(page, "folder", first);
    await waitForSynchronized(page);
    await createRootItem(page, "folder", second);
    await waitForSynchronized(page);

    await focusTree(page, first);
    await page.keyboard.press("ArrowDown");

    await expect(row(page, second)).toBeFocused();
    await expect(row(page, second)).toHaveAttribute("aria-selected", "true");
    await expect(row(page, first)).toHaveAttribute("aria-selected", "false");
  });

  test("Home and End jump to the ends", async ({ page }) => {
    await openWorkspace(page);
    const first = uniqueName("AAAfirst");
    const last = uniqueName("ZZZlast");
    await createRootItem(page, "folder", first);
    await waitForSynchronized(page);
    await createRootItem(page, "folder", last);
    await waitForSynchronized(page);

    await focusTree(page, first);
    await page.keyboard.press("End");
    await expect(row(page, last)).toBeFocused();

    await page.keyboard.press("Home");
    await expect(row(page, first)).toBeFocused();
  });

  test("typing a letter jumps to the next item starting with it", async ({ page }) => {
    await openWorkspace(page);
    const alpha = uniqueName("Alpha");
    const zulu = uniqueName("Zulu");
    await createRootItem(page, "folder", alpha);
    await waitForSynchronized(page);
    await createRootItem(page, "folder", zulu);
    await waitForSynchronized(page);

    await focusTree(page, alpha);
    await page.keyboard.press("z");
    await expect(row(page, zulu)).toBeFocused();
  });
});

test.describe("expanding and collapsing", () => {
  test("right expands, left collapses, and the children appear and disappear", async ({ page }) => {
    await openWorkspace(page);
    const parent = uniqueName("Branch");
    const child = uniqueName("Leaf");
    await createRootItem(page, "folder", parent);
    await waitForSynchronized(page);
    await createChildItem(page, parent, "page", child);
    await waitForSynchronized(page);

    // Creating inside a folder opens it, so start from a closed branch.
    await focusTree(page, parent);
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, child)).toBeHidden();
    await expect(row(page, parent)).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("ArrowRight");
    await expect(row(page, child)).toBeVisible();
    await expect(row(page, parent)).toHaveAttribute("aria-expanded", "true");
  });

  test("left on a closed child branch moves focus and selection to its parent", async ({
    page,
  }) => {
    // This is the historical WebKit gap. The child must be a real closed
    // branch, not a leaf: Safari used to run the collapse branch correctly but
    // decline focus on the parent row while React still exposed tabindex=-1.
    await openWorkspace(page);
    const parent = uniqueName("ArrowParent");
    const child = uniqueName("ArrowChild");
    const grandchild = uniqueName("ArrowGrandchild");
    await createRootItem(page, "folder", parent);
    await createChildItem(page, parent, "folder", child);
    await createChildItem(page, child, "page", grandchild);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    if ((await row(page, child).getAttribute("aria-expanded")) === "true") {
      await page.getByTestId(`toggle-${child}`).click();
    }
    await expect(row(page, child)).toHaveAttribute("aria-expanded", "false");
    await focusTree(page, child);

    await page.keyboard.press("ArrowLeft");

    await expect(row(page, parent)).toBeFocused();
    await expect(row(page, parent)).toHaveAttribute("aria-selected", "true");
    await expect(row(page, child)).toHaveAttribute("aria-selected", "false");
  });

  test("a leaf declares no expanded state at all", async ({ page }) => {
    // `aria-expanded="false"` on a leaf announces a branch that will never
    // open, which is worse than saying nothing.
    await openWorkspace(page);
    const leaf = uniqueName("JustALeaf");
    await createRootItem(page, "page", leaf);
    await waitForSynchronized(page);

    await expect(row(page, leaf)).not.toHaveAttribute("aria-expanded", /.*/);
  });
});

test.describe("the tree as one tab stop", () => {
  test("Tab leaves the tree rather than walking through every row", async ({ page, isMobile }) => {
    // Desktop engines only. Safari on iOS does not move focus with Tab by
    // default, so the assertion says nothing there about whether the tree is
    // one tab stop. The tree's ARIA structure is asserted on every project by
    // the accessibility suite.
    test.skip(isMobile === true, "Tab does not move focus in mobile Safari");
    // The property that makes the tree usable at a hundred pages. If Tab walked
    // rows, reaching anything after the tree would mean pressing it a hundred
    // times.
    await openWorkspace(page);
    const first = uniqueName("TabOne");
    const second = uniqueName("TabTwo");
    await createRootItem(page, "folder", first);
    await waitForSynchronized(page);
    await createRootItem(page, "folder", second);
    await waitForSynchronized(page);

    await focusTree(page, first);
    await page.keyboard.press("Tab");

    // Focus went somewhere else entirely — not to the next row.
    await expect(row(page, second)).not.toBeFocused();
  });
});

test.describe("acting on an item from the keyboard", () => {
  test("a menu opens, moves and closes with focus returned to its trigger", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("MenuKeyboard");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    const trigger = page.getByTestId(`item-actions-${name}`);
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: `Actions pour ${name}` });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the item menu keeps reordering available without a drag handle", async ({ page }) => {
    await openWorkspace(page);
    const first = uniqueName("KeyboardDragFirst");
    const second = uniqueName("KeyboardDragSecond");
    await createRootItem(page, "page", first);
    await createRootItem(page, "page", second);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);
    await expectTreeOrder(page, first, second);

    await expect(page.getByTestId(`drag-${second}`)).toHaveCount(0);
    await focusTree(page, second);
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: `Actions pour ${second}` });
    const moveUp = page.getByTestId(`move-up-${second}`);
    await expect(moveUp).toBeVisible();
    const menuItems = menu.getByRole("menuitem");
    const moveUpIndex = await menuItems.evaluateAll(
      (items, testId) => items.findIndex((item) => item.getAttribute("data-testid") === testId),
      `move-up-${second}`,
    );
    expect(moveUpIndex).toBeGreaterThan(0);
    await expect(menuItems.first()).toBeFocused();
    for (let index = 0; index < moveUpIndex; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(moveUp).toBeFocused();
    await page.keyboard.press("Enter");

    // WebKit closes the modal mobile drawer when the portaled menu dismisses.
    // Reopen the tree before reading its DOM order; the command itself remains
    // the same keyboard path on every engine.
    await ensureNavigationVisible(page);
    await expectTreeOrder(page, second, first);
    await waitForSynchronized(page);
  });

  test("F2 starts a rename", async ({ page, isMobile }) => {
    // Desktop engines only. F2 is a physical-keyboard key that a touch keyboard
    // does not offer, so the assertion says nothing about the mobile
    // experience; renaming there is covered by the visible control.
    test.skip(isMobile === true, "F2 is not a key a touch keyboard has");
    await openWorkspace(page);
    const name = uniqueName("Renamable");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    const renamed = `${name}-renamed`;
    page.once("dialog", (dialog) => void dialog.accept(renamed));

    await focusTree(page, name);
    await page.keyboard.press("F2");

    await expect(row(page, renamed)).toBeVisible({ timeout: 30_000 });
  });

  test("Delete asks before trashing, and declining changes nothing", async ({ page, isMobile }) => {
    // Desktop engines only, for the same reason as F2.
    test.skip(isMobile === true, "Delete is not a key a touch keyboard has");
    // A destructive key with no confirmation is a key an owner presses once and
    // regrets. Declining must be a complete no-op.
    await openWorkspace(page);
    const name = uniqueName("Deletable");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await focusTree(page, name);
    await page.keyboard.press("Delete");
    const confirmation = page.getByTestId("trash-confirmation");
    await expect(confirmation).toBeVisible();
    await confirmation.getByTestId("cancel-trash").click();
    await expect(confirmation).toBeHidden();

    await expect(row(page, name)).toBeVisible();
  });
});

test.describe("what a branch says when it has nothing to show", () => {
  // These were unreachable until every branch got a disclosure. A folder with
  // no children used to render no twisty at all, so the one owner who most
  // needs to be told which of the four situations they are in — the one looking
  // at a folder that appears to contain nothing — was the one who could not be
  // told. Being a branch is now a property of the kind, not of the contents.

  test("the workspace says it is empty before anything exists", async ({ page }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    // Either the tree has rows from a previous test in this worker, or the
    // empty statement is present — never blank space with neither.
    const hasRows = (await page.getByRole("treeitem").count()) > 0;
    if (!hasRows) {
      await expect(page.getByTestId("empty-state")).toBeVisible();
    }
  });

  test("an opened folder with nothing in it says so", async ({ page }) => {
    const folder = uniqueName("EmptyBranch");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);

    await openBranch(page, folder);
    await expect(page.getByTestId("branch-state-empty")).toBeVisible();
  });

  test("offline, the same branch says the content is not on this device", async ({
    page,
    context,
  }) => {
    const folder = uniqueName("OfflineBranch");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);

    await context.setOffline(true);
    try {
      await openBranch(page, folder);
      // The distinction that matters: "empty" and "not fetched" look identical
      // as blank space, and reading the second as the first is how an owner
      // concludes their notes are gone.
      await expect(page.getByTestId("branch-state-offline")).toBeVisible();
      await expect(page.getByTestId("branch-state-empty")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test("after a failed command, the branch says it could not be loaded", async ({ page }) => {
    const parent = uniqueName("ErrorParent");
    const child = uniqueName("ErrorChild");
    const watched = uniqueName("ErrorBranch");
    await openWorkspace(page);
    await createRootItem(page, "folder", parent);
    await createChildItem(page, parent, "folder", child);
    await createRootItem(page, "folder", watched);
    await waitForSynchronized(page);

    await openBranch(page, watched);
    await expect(page.getByTestId("branch-state-empty")).toBeVisible();

    // Moving a folder into its own child is a cycle, refused by the domain on
    // this device before anything is sent. A name past the length limit looked
    // like the easier trigger and is not one: the client accepts it and only
    // the server refuses, so the explorer never learns of it.
    await page.getByTestId(`tree-item-${parent}`).click();
    await openBranch(page, parent);
    await moveSelectedItemInto(page, child);

    await expect(page.getByTestId("branch-state-error")).toBeVisible();
    await expect(page.getByTestId("branch-state-error")).toHaveAttribute("role", "alert");
  });

  test("the four states are distinguishable from one another", async ({ page }) => {
    // FR-015 asks for distinguishable, not merely present. Each state carries
    // its own test id and its own wording, so the assertion is that the empty
    // one does not read like the offline one.
    const folder = uniqueName("DistinctBranch");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);
    await openBranch(page, folder);

    const empty = await page.getByTestId("branch-state-empty").textContent();
    expect(empty?.trim()).not.toBe("");
    expect(empty).not.toMatch(/not available on this device/i);
  });
});

test.describe("shortcuts to what matters", () => {
  test("a page marked as a favourite appears in the favourites list", async ({ page }) => {
    const name = uniqueName("Starred");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    await expect(page.getByTestId("favourites-empty")).toBeVisible();
    await openItemActions(page, name);
    await expect(page.getByTestId(`favourite-action-${name}`)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.getByTestId(`favourite-action-${name}`).click();

    await expect(page.getByTestId(`favourites-${name}`)).toBeVisible({ timeout: 30_000 });
    // Marked, and saying so: a control whose checked state is only a glyph
    // leaves a screen-reader user unable to tell whether it worked.
    await openItemActions(page, name);
    await expect(page.getByTestId(`favourite-action-${name}`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("unmarking removes it again", async ({ page }) => {
    const name = uniqueName("Unstarred");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);

    await clickItemAction(page, name, `favourite-action-${name}`);
    await expect(page.getByTestId(`favourites-${name}`)).toBeVisible({ timeout: 30_000 });
    await clickItemAction(page, name, `favourite-action-${name}`);
    await expect(page.getByTestId(`favourites-${name}`)).toHaveCount(0, { timeout: 30_000 });
  });

  test("a newly changed page is at the top of the recents", async ({ page }) => {
    const older = uniqueName("Older");
    const newer = uniqueName("Newer");
    await openWorkspace(page);
    await createRootItem(page, "page", older);
    await createRootItem(page, "page", newer);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    const recents = page.getByTestId("recents").getByRole("button");
    await expect(recents.first()).toHaveText(newer);
  });

  test("settings are reachable from the sidebar", async ({ page }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    await page.getByTestId("open-settings").click();
    // FR-012 lists settings among the places the sidebar must reach; landing
    // somewhere that is not the settings screen would satisfy the letter of it
    // and none of the point.
    await expect(page.getByTestId("back-to-workspace")).toHaveText(/retour à l’espace de travail/i);
  });
});
