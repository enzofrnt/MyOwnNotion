/**
 * Browser/server interruption recovery journeys (T072, US4, SC-003/SC-013).
 */
import { expect, type Page, test } from "@playwright/test";
import { createRootItem, openWorkspace, uniqueName, waitForSynchronized } from "./helpers.ts";

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
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    // Simulate a process interruption: reload while the queue is pending.
    await page.reload();
    await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
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
    await page.getByLabel("Name", { exact: true }).fill(child);
    await page.getByRole("button", { name: `New folder inside ${parent}` }).click();
    await expect(page.getByTestId(`tree-item-${child}`)).toBeVisible();

    // Try to move the parent into its child: rejected explicitly, tree intact.
    await page.getByTestId(`tree-item-${parent}`).click();
    await page.getByRole("button", { name: `Move selected item into ${child}` }).click();
    await expect(page.getByTestId("problem-banner")).toContainText("containment.cycle-rejected");
    await expect(page.getByTestId(`tree-item-${parent}`)).toBeVisible();
    await expect(page.getByTestId(`tree-item-${child}`)).toBeVisible();
    await waitForSynchronized(page);
  });
});
