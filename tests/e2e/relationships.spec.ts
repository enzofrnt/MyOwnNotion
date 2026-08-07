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

    // Select the source and link it to the target by stable ID.
    await selectItem(page, source);
    await expect(page.getByTestId("item-details")).toBeVisible();
    await page.getByTestId("relation-target").fill(targetId ?? "");
    await page.getByTestId("create-relation").click();
    await expect(page.getByTestId("relationship-list")).toContainText(targetId ?? "");
    await expect(page.getByTestId("relation-availability")).toContainText("active");

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
