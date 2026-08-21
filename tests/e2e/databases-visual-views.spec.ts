import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  ensureNavigationVisible,
  openWorkspace,
  saveEntryProperties,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

async function addProperty(
  page: Page,
  name: string,
  type: "status" | "date" | "text",
): Promise<void> {
  await page.getByRole("button", { name: "Add property" }).click();
  const editor = page.getByRole("form", { name: "Property editor" });
  await editor.getByLabel("Name").fill(name);
  await editor.getByLabel("Type").selectOption(type);
  if (type === "status") {
    const options = editor.getByLabel("Options, separated by commas");
    await options.fill("To do, Done");
    await expect(options).toHaveValue("To do, Done");
  }
  await editor.getByRole("button", { name: "Save property" }).click();
  await expect(editor).toBeHidden({ timeout: 15_000 });
  await waitForDatabaseDefinitionSaved(page);
}

async function createEntry(
  page: Page,
  title: string,
  values: { readonly summary: string; readonly due?: string },
): Promise<void> {
  const trigger = await createDatabaseEntry(page, title);
  await waitForSynchronized(page);
  await trigger.click();
  const panel = page.locator(".entry-panel");
  await expect(panel).toBeVisible();
  const status = panel.getByLabel("Status", { exact: true });
  await status.selectOption({ label: "To do" });
  await expect(status.locator("option:checked")).toHaveText("To do");
  const summary = panel.getByLabel("Summary", { exact: true });
  await summary.fill(values.summary);
  await expect(summary).toHaveValue(values.summary);
  if (values.due !== undefined) {
    const due = panel.getByLabel("Due", { exact: true });
    await due.fill(values.due);
    await expect(due).toHaveValue(values.due);
  }
  await saveEntryProperties(page);
  await page.getByRole("button", { name: "Close entry" }).click();
  await expect(trigger).toBeFocused({ timeout: 15_000 });
}

async function createView(page: Page, buttonName: string, tabName: RegExp): Promise<void> {
  await page.getByRole("button", { name: buttonName }).click();
  const tab = page.getByRole("tab", { name: tabName });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await waitForDatabaseDefinitionSaved(page);
}

test("uses one canonical entry across board, gallery and calendar at pointer, keyboard and narrow layouts", async ({
  page,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Visual planning");
  const alpha = uniqueName("Alpha visual");
  const beta = uniqueName("Beta visual");
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const firstDate = `${month}-10`;
  const secondDate = `${month}-11`;

  await ensureNavigationVisible(page);
  await page.getByTestId("new-root-database").click();
  const createDatabase = page.getByRole("form", { name: "Create a database" });
  await createDatabase.getByLabel("Create a database").fill(databaseName);
  const createDatabaseButton = createDatabase.getByRole("button", { name: "Create database" });
  await createDatabaseButton.click();
  await expect(createDatabase).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();
  await waitForSynchronized(page);
  await addProperty(page, "Status", "status");
  await addProperty(page, "Due", "date");
  await addProperty(page, "Summary", "text");
  await createEntry(page, alpha, { summary: "Alpha gallery summary", due: firstDate });
  await createEntry(page, beta, { summary: "Beta gallery summary" });

  await createView(page, "New list view", /List 2/);
  await createView(page, "New board view", /Board 3/);
  const alphaBoardTrigger = page.locator("[data-entry-trigger]").filter({ hasText: alpha }).first();
  const canonicalEntryId = await alphaBoardTrigger.getAttribute("data-entry-trigger");
  expect(canonicalEntryId).not.toBeNull();

  const doneColumn = page
    .locator("[data-board-column]")
    .filter({ has: page.getByRole("heading", { name: /^Done ·/ }) });
  await page.getByRole("button", { name: `Move ${alpha} to next column` }).click();
  await expect(doneColumn.locator(".database-card").filter({ hasText: alpha })).toBeVisible({
    timeout: 15_000,
  });
  await waitForSynchronized(page);

  const betaMove = page.getByRole("button", { name: `Move ${beta} to next column` });
  await betaMove.press("Enter");
  await expect(doneColumn.locator(".database-card").filter({ hasText: beta })).toBeVisible({
    timeout: 15_000,
  });

  await createView(page, "New gallery view", /Gallery 4/);
  const alphaGalleryCard = page.locator(".database-gallery__card").filter({ hasText: alpha });
  await expect(alphaGalleryCard).toContainText("Alpha gallery summary");
  await expect(alphaGalleryCard).toContainText("No safe preview available");
  await expect(alphaGalleryCard.locator("[data-entry-trigger]")).toHaveAttribute(
    "data-entry-trigger",
    canonicalEntryId as string,
  );
  await alphaGalleryCard.locator("[data-entry-trigger]").click();
  await expect(page.locator(".entry-panel").getByRole("heading", { name: alpha })).toBeVisible();
  await page.getByRole("button", { name: "Close entry" }).click();
  await expect(page.locator(`[data-entry-trigger="${canonicalEntryId as string}"]`)).toBeFocused();

  await createView(page, "New calendar view", /Calendar 5/);
  const alphaCalendarCard = page.locator(".database-calendar__card").filter({ hasText: alpha });
  await expect(alphaCalendarCard).toBeVisible();
  await page.getByRole("button", { name: `Move ${alpha} to next day` }).click();
  await expect(page.getByLabel(`Schedule ${alpha}`)).toHaveValue(secondDate, { timeout: 15_000 });

  const betaSchedule = page.getByLabel(`Schedule ${beta}`);
  await expect(betaSchedule).toBeVisible();
  await betaSchedule.fill(secondDate);
  await expect(page.locator(`[data-calendar-day="${secondDate}"]`)).toContainText(beta, {
    timeout: 15_000,
  });
  await expect(
    page
      .locator(".database-calendar__card")
      .filter({ hasText: alpha })
      .locator("[data-entry-trigger]"),
  ).toHaveAttribute("data-entry-trigger", canonicalEntryId as string);
  await waitForSynchronized(page);

  await page.getByRole("tab", { name: /Table/ }).click();
  const alphaRow = page.locator(".database-grid tbody tr").filter({ hasText: alpha });
  await expect(alphaRow.getByRole("gridcell", { name: "Status, Done" })).toBeVisible();
  await expect(alphaRow.getByRole("gridcell", { name: `Due, ${secondDate}` })).toBeVisible();
  await expect(alphaRow.locator("[data-entry-trigger]")).toHaveAttribute(
    "data-entry-trigger",
    canonicalEntryId as string,
  );

  await page.getByRole("tab", { name: /Gallery 4/ }).click();
  await expect(page.getByRole("tab", { name: /Gallery 4/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // 200% zoom on a 640px viewport produces the same 320 CSS-pixel reflow
  // target without accidentally testing an unsupported effective width of
  // 160px.
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  await expect(page.getByRole("tab", { name: /Gallery 4/ })).toBeVisible();
  await expect(page.locator(".database-gallery__card").filter({ hasText: alpha })).toBeVisible();
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBeLessThanOrEqual(24);
  const narrowCardTrigger = page
    .locator(".database-gallery__card")
    .filter({ hasText: alpha })
    .getByRole("button");
  await narrowCardTrigger.focus();
  await narrowCardTrigger.press("Enter");
  await expect(page.locator(".entry-panel").getByRole("heading", { name: alpha })).toBeVisible();
});
