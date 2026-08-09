/**
 * Responsive relationship-diagnostic journeys (T064, US3).
 */
import { expect, test } from "@playwright/test";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

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
    const details = page.getByTestId("item-details");
    await expect(details).toBeVisible();
    await details.scrollIntoViewIfNeeded();
    await expect(details).toBeInViewport();

    const targetField = page.getByTestId("relation-target");
    await targetField.scrollIntoViewIfNeeded();
    await expect(targetField).toBeInViewport();
    await targetField.fill(targetId ?? "");

    const createButton = page.getByTestId("create-relation");
    await createButton.scrollIntoViewIfNeeded();
    await expect(createButton).toBeInViewport();
    await createButton.click();

    const list = page.getByTestId("relationship-list");
    await list.scrollIntoViewIfNeeded();
    await expect(list).toBeInViewport();
    await expect(list).toContainText(targetId ?? "");
    await expect(page.getByTestId("relation-availability")).toContainText("active");

    // The panel must not force the page to scroll sideways at any size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);

    // Rename the target: the relationship still resolves to the same item.
    page.on("dialog", (dialog) => void dialog.accept(uniqueName("Renamed")));
    await page.getByRole("button", { name: `Rename ${target}` }).click();
    await waitForSynchronized(page);
    await selectItem(page, source);
    await expect(page.getByTestId("relationship-list")).toContainText(targetId ?? "");

    // Trash the target: the reference stays diagnosable, never redirected.
    const renamedRow = page.locator(`[data-item-id="${targetId}"]`);
    const renamedName = await renamedRow.locator(".tree-name").textContent();
    await page.getByRole("button", { name: `Trash ${renamedName ?? ""}` }).click();
    await waitForSynchronized(page);
    await selectItem(page, source);
    await expect(page.getByTestId("relation-availability")).toContainText("trashed", {
      timeout: 15_000,
    });

    // The stable ID panel shows an immutable identity.
    await expect(page.getByTestId("stable-id")).not.toBeEmpty();
  });
});
