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
  createChildItem,
  createRootItem,
  openWorkspace,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

function row(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId(`tree-item-${name}`);
}

/** Puts focus on the tree without asserting anything about which row. */
async function focusTree(page: import("@playwright/test").Page, name: string): Promise<void> {
  await row(page, name).click();
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

  test("left moves to the parent when the branch is already closed", async ({ page }) => {
    // The second half of the pattern, and the one that is usually forgotten:
    // left on a closed child is how an owner climbs back out of a deep branch.
    await openWorkspace(page);
    const parent = uniqueName("Above");
    const child = uniqueName("Below");
    await createRootItem(page, "folder", parent);
    await waitForSynchronized(page);
    await createChildItem(page, parent, "page", child);
    await waitForSynchronized(page);

    await focusTree(page, child);
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, parent)).toBeFocused();
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
  test("Tab leaves the tree rather than walking through every row", async ({ page }) => {
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
  test("F2 starts a rename", async ({ page }) => {
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

  test("Delete asks before trashing, and declining changes nothing", async ({ page }) => {
    // A destructive key with no confirmation is a key an owner presses once and
    // regrets. Declining must be a complete no-op.
    await openWorkspace(page);
    const name = uniqueName("Deletable");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    page.once("dialog", (dialog) => void dialog.dismiss());
    await focusTree(page, name);
    await page.keyboard.press("Delete");

    await expect(row(page, name)).toBeVisible();
  });
});
