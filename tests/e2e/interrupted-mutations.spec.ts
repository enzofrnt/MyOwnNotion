/**
 * Browser/server interruption recovery journeys (T072, US4, SC-003/SC-013).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  closeMobileNavigation,
  createChildItem,
  createRootItem,
  ensureNavigationRowVisible,
  moveSelectedItemInto,
  openWorkspace,
  openWorkspaceDiagnostics,
  returnToWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function blockApi(page: Page): Promise<void> {
  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
}

test.describe("interrupted mutations (US4)", () => {
  test("a mutation interrupted mid-submission is neither lost nor duplicated", async ({ page }) => {
    await openWorkspace(page);
    await waitForSynchronized(page);

    // Interrupt the network before submission: the mutation stays durable.
    await blockApi(page);
    const name = uniqueName("Interrupted");
    await createRootItem(page, "folder", name);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // Simulate a process interruption: reload while the queue is pending.
    await page.reload();
    // Diagnostics now have their own durable URL. Reloading correctly keeps
    // that destination, so return through the product control before reading
    // the retained workspace projection.
    await returnToWorkspace(page);
    await ensureNavigationRowVisible(page, name);
    await openWorkspaceDiagnostics(page);
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // The recovered row is reported as retrying, not as a fresh pending
    // change: the attempt happened and was interrupted (T076).
    await expect(
      page.locator('[data-testid="pending-mutations"] [data-mutation-state="retrying"]'),
    ).toHaveCount(1, { timeout: 15_000 });

    // Recovery: reconnect and verify exactly one logical acceptance.
    await page.unroute("**/v1/**");
    await page.unroute("**/health");
    await page.reload();
    await openWorkspace(page);
    await openWorkspaceDiagnostics(page);
    await waitForSynchronized(page);
    await expect(page.getByTestId(`tree-item-${name}`)).toHaveCount(1);
    await expect(page.getByTestId("mutation-status-empty")).toBeVisible();
  });

  test("an invalid change reports an explicit rejection without partial state", async ({
    page,
  }) => {
    await openWorkspace(page);
    const parent = uniqueName("CycleParent");
    const child = uniqueName("CycleChild");
    await createRootItem(page, "folder", parent);
    await createChildItem(page, parent, "folder", child);

    // Try to move the parent into its child: rejected explicitly, tree intact.
    await selectItem(page, parent);
    await moveSelectedItemInto(page, child);
    const problem = page.getByTestId("problem-banner");
    await expect(problem).toBeVisible();
    await closeMobileNavigation(page);
    await problem.getByRole("button", { name: "Voir les détails" }).click();
    await expect(page.getByTestId("operational-problem-code")).toContainText(
      "containment.cycle-rejected",
    );
    await returnToWorkspace(page);
    await ensureNavigationRowVisible(page, parent);
    await ensureNavigationRowVisible(page, child);
    await waitForSynchronized(page);
  });
});
