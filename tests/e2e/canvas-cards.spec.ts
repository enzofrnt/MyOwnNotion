import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addCanvasTextCard, insertCanvas } from "./canvas-helpers.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("freeform canvas spatial cards (US1)", () => {
  test("adds, edits, arranges, resizes, navigates, and reloads stable cards", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("CanvasCards");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const canvas = await insertCanvas(page);
    const canvasId = await canvas.getAttribute("data-canvas-id");
    const first = await addCanvasTextCard(canvas, "First spatial idea");
    await addCanvasTextCard(canvas, "Second spatial idea");
    const firstId = await first.getAttribute("data-card-id");
    await first.click();
    const inspector = canvas.getByRole("region", { name: "Selected canvas card editor" });
    await expect(inspector).toBeFocused();
    await first.scrollIntoViewIfNeeded();
    const beforeDrag = await first.evaluate((element) => ({
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
    }));
    const cardBox = await first.boundingBox();
    if (cardBox === null) throw new Error("Canvas card drag target missing");
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 48, cardBox.y + cardBox.height / 2 + 32, {
      steps: 4,
    });
    await page.mouse.up();
    await expect
      .poll(() =>
        first.evaluate((element) => ({
          left: Number.parseFloat(element.style.left),
          top: Number.parseFloat(element.style.top),
        })),
      )
      .toEqual({ left: beforeDrag.left + 48, top: beforeDrag.top + 32 });
    await inspector.getByRole("textbox", { name: "Card text" }).fill("Edited spatial idea");
    await inspector.getByRole("button", { name: "Move selected card left" }).click();
    await inspector.getByRole("button", { name: "Move selected card up" }).click();
    await inspector.getByRole("spinbutton", { name: "Card width" }).fill("320");
    await inspector.getByRole("spinbutton", { name: "Card height" }).fill("180");
    await canvas.getByRole("button", { name: "Pan canvas right" }).click();
    await canvas.getByRole("button", { name: "Zoom canvas in" }).click();
    await expect(canvas.getByLabel("Canvas zoom")).toHaveText("125%");
    await canvas.getByRole("button", { name: "Reset view" }).click();
    await expect(canvas.getByLabel("Canvas zoom")).toHaveText("100%");
    await canvas.getByRole("button", { name: "Pan canvas right" }).click();
    await canvas.getByRole("button", { name: "Zoom canvas in" }).click();
    await savePageAndSynchronize(page);

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    const reloaded = page.getByTestId("canvas-block");
    await expect(reloaded).toHaveAttribute("data-canvas-id", canvasId ?? "");
    await expect(reloaded.locator(`[data-card-id="${firstId}"]`)).toHaveAccessibleName(
      "Text card: Edited spatial idea",
    );
    await expect(reloaded.getByLabel("Canvas zoom")).toHaveText("125%");
    const axe = await new AxeBuilder({ page }).include(".canvas-block").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
    await attachReviewScreenshot(page, testInfo, "canvas-cards");
  });

  test("renders a bounded and accessible empty canvas", async ({ page }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("EmptyCanvas");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const canvas = await insertCanvas(page);
    await expect(canvas).toContainText("0 cards · 0 connections · 0 strokes");
    await expect(canvas).toContainText("Add a text card or workspace page");
    const axe = await new AxeBuilder({ page }).include(".canvas-block").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    await attachReviewScreenshot(page, testInfo, "canvas-empty");
  });
});
