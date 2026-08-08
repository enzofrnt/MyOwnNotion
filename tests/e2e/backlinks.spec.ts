import { expect, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

async function insertLink(
  page: import("@playwright/test").Page,
  targetName: string,
): Promise<void> {
  await page.keyboard.type(`[[${targetName.slice(0, 10)}`);
  await page.getByRole("option", { name: new RegExp(targetName) }).click();
}

test.describe("backlinks and outgoing links (US2)", () => {
  test("aggregates occurrences, navigates by keyboard, and labels unavailable targets", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const sourceName = uniqueName("BacklinkSource");
    const targetName = uniqueName("BacklinkTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await selectItem(page, sourceName);

    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.focus();
    await insertLink(page, targetName);
    await page.keyboard.type("and again ");
    await insertLink(page, targetName);
    await savePageAndSynchronize(page);

    await selectItem(page, targetName);
    const backlinks = page.getByRole("region", { name: "Backlinks" });
    await expect(backlinks).toContainText("2 links");
    await attachReviewScreenshot(page, testInfo, "backlinks");
    const sourceButton = backlinks.getByRole("button", { name: sourceName });
    await sourceButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`tree-item-${sourceName}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const outgoing = page.getByRole("region", { name: "Outgoing links" });
    await expect(outgoing).toContainText("2 links");
    await page.getByRole("button", { name: `Trash ${targetName}` }).click();
    await selectItem(page, sourceName);
    await expect(outgoing).toContainText("trashed");
    await expect(outgoing.getByRole("button", { name: targetName })).toBeDisabled();
  });
});
