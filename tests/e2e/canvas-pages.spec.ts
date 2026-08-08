import { expect, test } from "@playwright/test";
import {
  addCanvasPageCard,
  addCanvasTextCard,
  connectCanvasCards,
  insertCanvas,
} from "./canvas-helpers.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("freeform canvas page cards (US3)", () => {
  test("uses current page identity for navigation, backlinks, and unavailable state", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const targetName = uniqueName("CanvasTarget");
    const renamedTarget = `${targetName}-renamed`;
    const sourceName = uniqueName("CanvasSource");
    const folderName = uniqueName("CanvasFolder");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "folder", folderName);
    await createRootItem(page, "page", sourceName);
    await selectItem(page, sourceName);
    const canvas = await insertCanvas(page);
    await addCanvasTextCard(canvas, "Context card");
    const pageCard = await addCanvasPageCard(canvas, targetName);
    const pageCardId = await pageCard.getAttribute("data-card-id");
    await connectCanvasCards(canvas, "Context card", targetName, "opens");
    await savePageAndSynchronize(page);
    await selectItem(page, targetName);
    page.once("dialog", (dialog) => dialog.accept(renamedTarget));
    await page.getByRole("button", { name: `Rename ${targetName}` }).click();
    await page.getByRole("button", { name: `Move selected item into ${folderName}` }).click();
    await waitForSynchronized(page);
    await selectItem(page, sourceName);
    const renamedCard = page
      .getByTestId("canvas-block")
      .getByRole("button", { name: `Page card: ${renamedTarget}` });
    await expect(renamedCard).toHaveAttribute("data-card-id", pageCardId ?? "");
    await renamedCard.click();
    await page.getByTestId("canvas-block").getByRole("button", { name: "Open page" }).click();
    await expect(page.getByTestId(`tree-item-${renamedTarget}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("region", { name: "Backlinks" })).toContainText(sourceName);
    await page.getByRole("button", { name: `Trash ${renamedTarget}` }).click();
    await selectItem(page, sourceName);
    const reloaded = page.getByTestId("canvas-block");
    await expect(reloaded.locator(`[data-card-id="${pageCardId}"]`)).toHaveAccessibleName(
      "Page card: Unavailable page",
    );
    await reloaded.locator(`[data-card-id="${pageCardId}"]`).click();
    await expect(reloaded.getByRole("button", { name: "Open page" })).toBeDisabled();
    await attachReviewScreenshot(page, testInfo, "canvas-page-card");
  });
});
