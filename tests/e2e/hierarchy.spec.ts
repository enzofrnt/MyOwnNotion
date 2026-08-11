/**
 * Responsive keyboard hierarchy journeys (T027, US1).
 */
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  expectTreeOrder,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("hierarchy organization (US1)", () => {
  test("creates, nests, reorders, moves, and rejects cycles", async ({ page }) => {
    await openWorkspace(page);

    const folder = uniqueName("Projects");
    const pageName = uniqueName("MyOwnNotion");
    const subFolder = uniqueName("Sub");
    const subPage = uniqueName("Deep");

    // Create a folder, a page inside it, then a folder and page beneath that page.
    await createRootItem(page, "folder", folder);
    await createChildItem(page, folder, "page", pageName);
    await createChildItem(page, pageName, "folder", subFolder);
    await createChildItem(page, subFolder, "page", subPage);

    // Move the complete page branch to the workspace root.
    await page.getByRole("button", { name: `Move ${pageName} to workspace root` }).click();
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible();
    // Descendants moved with it.
    await expect(page.getByTestId(`tree-item-${subPage}`)).toBeVisible();

    // Attempt to move the page beneath its own descendant: explicit rejection.
    await selectItem(page, pageName);
    await page.getByRole("button", { name: `Move selected item into ${subFolder}` }).click();
    await expect(page.getByTestId("problem-banner")).toContainText("containment.cycle-rejected");
    // The tree is unchanged: the page is still visible at root level.
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible();

    await waitForSynchronized(page);
  });

  test("reorders siblings with persistent explicit order", async ({ page }) => {
    await openWorkspace(page);
    const parent = uniqueName("Ordered");
    const first = uniqueName("First");
    const second = uniqueName("Second");
    await createRootItem(page, "folder", parent);
    await createChildItem(page, parent, "page", first);
    await createChildItem(page, parent, "page", second);

    // Move "second" up; order persists after reload.
    await page.getByRole("button", { name: `Move ${second} up` }).click();
    // Wait for the optimistic reorder to land before waiting for the queue to
    // drain. `waitForSynchronized` on its own can return before the click has
    // reached the outbox — the queue is empty, so it passes vacuously and the
    // reload below discards the change.
    await expectTreeOrder(page, second, first);
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);

    // The order survived the reload, so it was persisted rather than optimistic.
    await expectTreeOrder(page, second, first);
  });

  test("trashes a branch into the 30-day trash and restores it", async ({ page }) => {
    await openWorkspace(page);
    const root = uniqueName("TrashRoot");
    const child = uniqueName("TrashChild");
    await createRootItem(page, "folder", root);
    await createChildItem(page, root, "page", child);

    await page.getByRole("button", { name: `Trash ${root}` }).click();
    await expect(page.getByTestId(`trash-item-${root}`)).toBeVisible();
    await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(0);

    await page.getByRole("button", { name: `Restore ${root}` }).click();
    // The same 15 seconds `createChildItem` uses, and for the same reason:
    // this waits on a mutation round trip, not on a render. It was left at the
    // 10-second default and flaked in CI once the dual write added a database
    // round trip to every mutation — real added latency, not a test artefact,
    // and the reason to move sealing inside the mutation transaction.
    await expect(page.getByTestId(`tree-item-${root}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`tree-item-${child}`)).toBeVisible({ timeout: 15_000 });
    await waitForSynchronized(page);
  });

  test("keyboard navigation moves selection through the tree", async ({ page }) => {
    await openWorkspace(page);
    const a = uniqueName("KeyA");
    const b = uniqueName("KeyB");
    await createRootItem(page, "folder", a);
    await createRootItem(page, "page", b);

    await selectItem(page, a);
    await expect(page.getByTestId(`tree-item-${a}`)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    // Selection moved to some next tree item (aria-selected moves).
    await expect(page.getByTestId(`tree-item-${a}`)).toHaveAttribute("aria-selected", "false");
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId(`tree-item-${a}`)).toHaveAttribute("aria-selected", "true");
  });
});
