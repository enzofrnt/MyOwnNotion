import { expect, type Locator, type Page } from "@playwright/test";

export async function insertCanvas(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "Page formatting" })
    .getByRole("button", { name: "Insert canvas" })
    .click();
  const canvas = page.getByTestId("canvas-block").last();
  await expect(canvas).toBeVisible();
  return canvas;
}

export async function addCanvasTextCard(canvas: Locator, text: string): Promise<Locator> {
  await canvas.getByRole("textbox", { name: "New text card" }).fill(text);
  await canvas.getByRole("button", { name: "Add text card" }).click();
  const card = canvas.getByRole("button", { name: `Text card: ${text}` });
  await expect(card).toBeVisible();
  return card;
}

export async function addCanvasPageCard(canvas: Locator, pageName: string): Promise<Locator> {
  await canvas.getByRole("combobox", { name: "Workspace page" }).selectOption({ label: pageName });
  await canvas.getByRole("button", { name: "Add page card" }).click();
  const card = canvas.getByRole("button", { name: `Page card: ${pageName}` });
  await expect(card).toBeVisible();
  return card;
}

export async function connectCanvasCards(
  canvas: Locator,
  source: string,
  target: string,
  label: string,
): Promise<void> {
  await canvas.getByRole("combobox", { name: "Connection from" }).selectOption({ label: source });
  await canvas.getByRole("combobox", { name: "Connection to" }).selectOption({ label: target });
  await canvas.getByRole("textbox", { name: "Connection label" }).fill(label);
  await canvas.getByRole("button", { name: "Connect cards" }).click();
  await expect(canvas.locator("[data-connection-id]")).toContainText(`${source} → ${target}`);
}

export async function drawCanvasStroke(
  page: Page,
  canvas: Locator,
  width: "2" | "4" | "8" = "4",
): Promise<void> {
  await canvas.getByRole("button", { name: "Draw" }).click();
  await canvas.getByRole("combobox", { name: "Stroke width" }).selectOption(width);
  const surface = canvas.getByRole("application", { name: "Freeform canvas surface" });
  await surface.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const box = await surface.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("Canvas drawing area missing");
  const visibleTop = Math.max(box.y + 20, 20);
  const visibleBottom = Math.min(box.y + box.height - 20, viewport.height - 20);
  if (visibleBottom - visibleTop < 100) throw new Error("Canvas has no drawable visible area");
  const y = visibleTop + (visibleBottom - visibleTop) * 0.72;
  const previousCount = await canvas.locator("[data-stroke-id]").count();
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y + 24, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, y - 12, { steps: 6 });
  await page.mouse.up();
  await expect(canvas.locator("[data-stroke-id]")).toHaveCount(previousCount + 1);
  await canvas.getByRole("button", { name: "Stop drawing" }).click();
}
