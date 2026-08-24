/**
 * Responsive relationship-diagnostic journeys (T064, US3).
 */
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openSettingsSection,
  openWorkspace,
  renameItem,
  returnToWorkspace,
  selectItem,
  trashItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/**
 * Keep scrolling while late editor layout settles. WebKit can finish sizing
 * the editor after the first scroll and push a lower panel out of view again.
 */
async function expectReachable(locator: Locator): Promise<void> {
  await expect(async () => {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport({ timeout: 1_000 });
  }).toPass({
    intervals: [100, 250, 500],
    timeout: 15_000,
  });
}

test.describe("stable identity and relationships (US3)", () => {
  test("relates two items; the relation survives rename and reports trash diagnostics", async ({
    page,
  }) => {
    await openWorkspace(page);
    const source = uniqueName("RelSource");
    const target = uniqueName("RelTarget");
    await createRootItem(page, "page", source);
    await createRootItem(page, "page", target);
    await waitForSynchronized(page);

    const targetId = await page.getByTestId(`tree-item-${target}`).getAttribute("data-item-id");

    // Select the source and link it to the target by stable ID. The panel and
    // each control must also be reachable at the current viewport — this suite
    // runs on desktop and mobile-sized projects, so a diagnostic that renders
    // but cannot be reached still fails (T101).
    await selectItem(page, source);
    await openSettingsSection(page, "page-details");
    const details = page.getByTestId("item-details");
    await expect(details).toBeVisible();
    await expectReachable(details);

    const targetField = page.getByTestId("relation-target");
    await expectReachable(targetField);
    await targetField.fill(targetId ?? "");

    const createButton = page.getByTestId("create-relation");
    await expectReachable(createButton);
    await createButton.click();

    const list = page.getByTestId("relationship-list");
    await expectReachable(list);
    await expect(list).toContainText(targetId ?? "");
    await expect(page.getByTestId("relation-availability")).toContainText("active");

    // The panel must not force the page to scroll sideways at any size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);

    // Rename the target: the relationship still resolves to the same item.
    await returnToWorkspace(page);
    await renameItem(page, target, uniqueName("Renamed"));
    await waitForSynchronized(page);
    await selectItem(page, source);
    await openSettingsSection(page, "page-details");
    await expect(page.getByTestId("relationship-list")).toContainText(targetId ?? "");

    // Trash the target: the reference stays diagnosable, never redirected.
    await returnToWorkspace(page);
    const renamedRow = page.locator(`[data-item-id="${targetId}"]`);
    const renamedName = await renamedRow.locator(".tree-name").textContent();
    await trashItem(page, renamedName ?? "");
    await waitForSynchronized(page);
    await selectItem(page, source);
    await openSettingsSection(page, "page-details");
    await expect(page.getByTestId("relation-availability")).toContainText("trashed", {
      timeout: 15_000,
    });

    // The stable ID panel shows an immutable identity.
    await expect(page.getByTestId("stable-id")).not.toBeEmpty();
  });
});
