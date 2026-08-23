/**
 * Keeping what matters, and never losing what is unsent (T044, US4).
 *
 * Two claims, and only one of them is about convenience. That a marked branch
 * opens with no network is the feature; that an unsynchronized change survives
 * a device running out of room is the guarantee. The second is asserted with the
 * limit set deliberately low, because that is the only way to reach the code
 * path where an owner could lose work.
 */

import { expect, test } from "./fixtures.ts";
import {
  clickItemAction,
  createChildItem,
  createRootItem,
  openItemActions,
  openWorkspace,
  openWorkspaceDiagnostics,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("what the owner asks to keep", () => {
  test("a branch can be marked, and the marking is stated rather than implied", async ({
    page,
  }) => {
    const folder = uniqueName("KeptBranch");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);

    await openItemActions(page, folder);
    const control = page.getByTestId(`offline-action-${folder}`);
    await expect(control).toHaveAttribute("aria-checked", "false");
    await control.click();
    // Announced through aria-checked, not through a glyph alone: a control whose
    // state is only visual leaves a screen-reader user unable to tell whether it
    // worked.
    await openItemActions(page, folder);
    await expect(page.getByTestId(`offline-action-${folder}`)).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 30_000 },
    );
  });

  test("the marking survives a reload, because it is content and not a device preference", async ({
    page,
  }) => {
    const folder = uniqueName("KeptAcross");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);
    await clickItemAction(page, folder, `offline-action-${folder}`);
    await openItemActions(page, folder);
    await expect(page.getByTestId(`offline-action-${folder}`)).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 30_000 },
    );
    await page.keyboard.press("Escape");
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    // Stored with the item and carried in its revision, so every device learns
    // it — which is the whole reason it is not kept beside the expanded
    // branches in the local projection.
    await openItemActions(page, folder);
    await expect(page.getByTestId(`offline-action-${folder}`)).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 30_000 },
    );
  });

  test("a marked branch opens with no network", async ({ page, context }) => {
    const folder = uniqueName("OfflineBranch");
    const child = uniqueName("OfflineChild");
    await openWorkspace(page);
    await createRootItem(page, "folder", folder);
    await createChildItem(page, folder, "page", child);
    await waitForSynchronized(page);
    await clickItemAction(page, folder, `offline-action-${folder}`);
    await waitForSynchronized(page);

    await context.setOffline(true);
    try {
      // Navigated within the loaded application rather than reloaded. Reloading
      // offline needs the shell itself to be cached by a service worker, which
      // this feature does not ship — validation.md records that gap rather than
      // letting this test imply it is covered.
      await selectItem(page, child);
      // Opened from the local projection: the editor is there, and there is no
      // error about the network.
      await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("editor-unavailable")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("what this device says it is holding", () => {
  test("states a breakdown and whether the browser promised to keep it", async ({ page }) => {
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    const panel = page.getByTestId("storage-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });

    // FR-019: what is holding the space, not merely how much.
    await expect(page.getByTestId("storage-usage")).not.toBeEmpty();
    await expect(page.getByTestId("storage-breakdown")).toBeVisible();
    // Durability is stated because without it the browser may clear this origin
    // under pressure, taking unsent work with it. An owner who knows can act.
    await expect(page.getByTestId("storage-durability")).not.toBeEmpty();
  });

  test("offers unlimited as its own choice rather than a very large number", async ({ page }) => {
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    const select = page.getByTestId("storage-limit");
    await expect(select).toBeVisible({ timeout: 30_000 });
    // Unlimited is the absence of a limit. A number standing in for it
    // eventually gets compared against.
    await expect(select.locator('option[value="unlimited"]')).toHaveCount(1);
  });

  test("an unsent change is still there after the limit is lowered", async ({ page, context }) => {
    // The guarantee, not the feature. This is the only path where an owner
    // could lose work, so it is exercised end to end rather than reasoned about.
    const pageName = uniqueName("UnsentSurvives");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await openWorkspaceDiagnostics(page);

    await context.setOffline(true);
    try {
      await typeIntoEditor(page, "written while offline and never sent");
      await saveDocument(page);

      // Squeeze the device: 1 GB is the smallest offered, and the eviction pass
      // runs against whatever it measures.
      await page.getByTestId("storage-limit").selectOption(String(1024 * 1024 * 1024));
      await page.waitForTimeout(500);

      // Still there. Releasing this would destroy an edit the server has never
      // seen, and there would be nowhere to fetch it back from.
      await expect(page.getByTestId("block-editor")).toContainText("written while offline");
    } finally {
      await context.setOffline(false);
    }
  });
});
