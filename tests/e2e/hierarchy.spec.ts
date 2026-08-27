/**
 * Responsive keyboard hierarchy journeys (T027, US1).
 */
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  ensureNavigationVisible,
  expectTreeOrder,
  moveItemToRoot,
  moveItemUp,
  moveSelectedItemInto,
  openSettingsSection,
  openWorkspace,
  returnToWorkspace,
  selectItem,
  trashItem,
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
    await moveItemToRoot(page, pageName);
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible();
    // Descendants moved with it.
    await expect(page.getByTestId(`tree-item-${subPage}`)).toBeVisible();

    // Attempt to move the page beneath its own descendant: explicit rejection.
    await selectItem(page, pageName);
    await moveSelectedItemInto(page, subFolder);
    // The document surface explains the failure without exposing an internal
    // code; that code lives in the dedicated diagnostics destination.
    await expect(page.getByTestId("problem-banner")).toContainText(/rejected/i);
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

    // Let the creations reconcile before reordering. Without this the test
    // races itself: the reorder is applied optimistically, the creations'
    // responses arrive afterwards carrying the server's ordering, and that
    // ordering wins — so the assertion below waits fifteen seconds for a state
    // the client has already discarded. It surfaced as a webkit-mobile
    // flake, which is only where the timing was slow enough to lose reliably.
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    // Startup navigation hydration must finish before the tree becomes
    // interactive. Otherwise it can arrive here and collapse the parent after
    // createChildItem opened it, detaching the reorder control mid-click.
    await expect(page.getByTestId(`tree-item-${parent}`)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId(`tree-item-${second}`)).toBeVisible();

    // Move "second" up; order persists after reload.
    await moveItemUp(page, second);
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

  test("reorders siblings with the visible drag handle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    const first = uniqueName("Drag first");
    const second = uniqueName("Drag second");
    await createRootItem(page, "page", first);
    await createRootItem(page, "page", second);
    await waitForSynchronized(page);

    const sourceRow = page.getByTestId(`tree-item-${second}`);
    await sourceRow.hover();
    const handle = page.getByTestId(`drag-${second}`);
    const target = page.getByTestId(`drop-before-${first}`);
    const sourceBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(
      (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2,
      (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2,
      (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2 - 8,
      { steps: 2 },
    );
    await page.mouse.move(
      (targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2,
      (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2,
      { steps: 8 },
    );
    await expect(target).toHaveAttribute("data-active", "true");
    await page.mouse.up();

    await expectTreeOrder(page, second, first);
    await waitForSynchronized(page);
  });

  test("turns a page back into a leaf after its last child moves away", async ({ page }) => {
    await openWorkspace(page);
    const parent = uniqueName("Leaf parent");
    const child = uniqueName("Moved child");
    await createRootItem(page, "page", parent);
    await createChildItem(page, parent, "page", child);
    await waitForSynchronized(page);

    await moveItemToRoot(page, child);
    const parentRow = page.getByTestId(`tree-item-${parent}`);
    await expect(parentRow).not.toHaveAttribute("aria-expanded", /.+/u);
    await expect(page.getByTestId(`toggle-${parent}`)).toHaveCount(0);
    await expect(page.getByText("Cette page ne contient encore aucun élément.")).toHaveCount(0);
    await waitForSynchronized(page);
  });

  test("trashes a branch into the 30-day trash and restores it", async ({ page }) => {
    await openWorkspace(page);
    const root = uniqueName("TrashRoot");
    const child = uniqueName("TrashChild");
    await createRootItem(page, "folder", root);
    await createChildItem(page, root, "page", child);

    await trashItem(page, root);
    await openSettingsSection(page, "trash");
    await expect(page.getByTestId(`trash-item-${root}`)).toBeVisible();
    await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(0);

    await page.getByTestId(`trash-item-${root}`).getByRole("button", { name: "Restaurer" }).click();
    await returnToWorkspace(page);
    // The same 15 seconds `createChildItem` uses, and for the same reason:
    // this waits on a mutation round trip, not on a render. It was left at the
    // 10-second default and flaked in CI once the dual write added a database
    // round trip to every mutation — real added latency, not a test artefact,
    // and the reason to move sealing inside the mutation transaction.
    const restoredRoot = page.getByTestId(`tree-item-${root}`);
    await expect(restoredRoot).toHaveCount(1, { timeout: 15_000 });
    if (!(await restoredRoot.isVisible())) {
      await page.getByTestId("toggle-tree").click();
    }
    await expect(restoredRoot).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`tree-item-${root}`)).toHaveAttribute("aria-expanded", "true");
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
    // Selecting content dismisses the modal navigation on phones. Reopen it
    // before exercising the tree's keyboard contract and restore focus to the
    // selected row, just as a keyboard user would.
    if (!(await page.getByTestId(`tree-item-${a}`).isVisible())) {
      await page.getByTestId("toggle-tree").click();
      await expect(page.getByTestId(`tree-item-${a}`)).toBeVisible();
      await page.getByTestId(`tree-item-${a}`).focus();
    }
    await page.keyboard.press("ArrowDown");
    // Selection moved to some next tree item (aria-selected moves).
    await expect(page.getByTestId(`tree-item-${a}`)).toHaveAttribute("aria-selected", "false");
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId(`tree-item-${a}`)).toHaveAttribute("aria-selected", "true");
  });

  test("opens the same item actions from right click and the keyboard", async ({ page }) => {
    await openWorkspace(page);
    const item = uniqueName("Context actions");
    await createRootItem(page, "page", item);
    await waitForSynchronized(page);
    await ensureNavigationVisible(page);

    const row = page.getByTestId(`tree-item-${item}`);
    await row.click({ button: "right" });
    await expect(page.getByTestId(`rename-${item}`)).toBeVisible();
    await page.keyboard.press("Escape");

    await row.focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByTestId(`rename-${item}`)).toBeVisible();
  });
});
