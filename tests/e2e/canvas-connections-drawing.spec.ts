import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  addCanvasTextCard,
  connectCanvasCards,
  drawCanvasStroke,
  insertCanvas,
} from "./canvas-helpers.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("freeform canvas connections and drawing (US2)", () => {
  test("keeps semantic connections and commits one complete freehand stroke", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("CanvasDrawing");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const canvas = await insertCanvas(page);
    await addCanvasTextCard(canvas, "Source idea");
    await addCanvasTextCard(canvas, "Target idea");
    await connectCanvasCards(canvas, "Source idea", "Target idea", "supports");
    const connectionId = await canvas
      .locator("[data-connection-id]")
      .getAttribute("data-connection-id");
    await canvas.getByRole("button", { name: "Text card: Source idea" }).click();
    await canvas.getByRole("button", { name: "Move selected card down" }).click();
    await expect(
      canvas
        .locator(`[data-connection-id="${connectionId}"]`)
        .getByRole("textbox", { name: "Connection name" }),
    ).toHaveValue("supports");

    await canvas.getByRole("button", { name: "Draw" }).click();
    await canvas.getByRole("combobox", { name: "Stroke width" }).selectOption("8");
    const surface = canvas.getByRole("application", { name: "Freeform canvas surface" });
    await surface.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const box = await surface.boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error("Canvas surface missing");
    const visibleTop = Math.max(box.y + 20, 20);
    const visibleBottom = Math.min(box.y + box.height - 20, viewport.height - 20);
    const y = visibleTop + (visibleBottom - visibleTop) * 0.72;
    await page.mouse.click(box.x + box.width * 0.55, y);
    await expect(canvas.locator("[data-stroke-id]")).toHaveCount(0);
    await page.mouse.move(box.x + box.width * 0.55, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, y + 24, { steps: 8 });
    await expect(canvas.getByTestId("canvas-draft-stroke")).toBeVisible();
    await page.mouse.move(box.x + box.width * 0.75, y - 12, { steps: 8 });
    await page.mouse.up();
    await expect(canvas.locator("[data-stroke-id]")).toContainText("thick");
    await canvas.getByRole("button", { name: "Stop drawing" }).click();
    await drawCanvasStroke(page, canvas, "2");
    await expect(canvas.locator("[data-stroke-id]")).toContainText([/thick/, /thin/]);
    const axe = await new AxeBuilder({ page }).include(".canvas-block").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    await attachReviewScreenshot(page, testInfo, "canvas-connected-drawing");
    await canvas.getByRole("button", { name: "Remove stroke 1" }).click();
    await expect(canvas.locator("[data-stroke-id]")).toHaveCount(1);
    await canvas.getByRole("button", { name: "Remove stroke 1" }).click();
    await expect(canvas.locator("[data-stroke-id]")).toHaveCount(0);
    await canvas.getByRole("button", { name: "Remove card" }).click();
    await expect(canvas.locator("[data-connection-id]")).toHaveCount(0);
  });
});
