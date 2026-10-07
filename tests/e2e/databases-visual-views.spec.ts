import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  chooseEntryOptions,
  createDatabaseEntry,
  createDatabaseView,
  createRootDatabase,
  databaseViewButton,
  ensureNavigationVisible,
  entryTrigger,
  openSecondDevice,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

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
  await chooseEntryOptions(page, "Status", ["To do"]);
  await expect(status).toContainText("To do");
  const summary = panel.getByLabel("Summary", { exact: true });
  await summary.fill(values.summary);
  await expect(summary).toHaveValue(values.summary);
  if (values.due !== undefined) {
    const due = panel.getByLabel("Due", { exact: true });
    await due.fill(values.due);
    await expect(due).toHaveValue(values.due);
  }
  await waitForEntryAutosave(page);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await expect(trigger).toBeFocused({ timeout: 15_000 });
}

async function createView(page: Page, buttonName: string, tabName: RegExp): Promise<void> {
  await createDatabaseView(
    page,
    (
      {
        "Nouvelle vue liste": "Liste",
        "Nouvelle vue Kanban": "Kanban",
        "Nouvelle vue galerie": "Galerie",
        "Nouvelle vue calendrier": "Calendrier",
      } as Record<string, string>
    )[buttonName] ?? buttonName,
  );
  const tab = databaseViewButton(page, tabName);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(tab).toHaveAttribute("aria-current", "page");
  await waitForDatabaseDefinitionSaved(page);
}

test("preserves native property input across a remote projection before input delivery", async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  await openWorkspace(page);
  const databaseName = uniqueName("Draft projection");
  const title = uniqueName("Draft entry");
  await ensureNavigationVisible(page);
  await createRootDatabase(page, databaseName);
  await waitForSynchronized(page);
  await addDatabaseProperty(page, "Summary", "text");
  const trigger = await createDatabaseEntry(page, title);
  await waitForSynchronized(page);
  await trigger.click();
  const summary = page.locator(".entry-panel").getByLabel("Summary", { exact: true });
  await expect(summary).toBeVisible();
  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await selectItem(second.page, databaseName);
    await summary.evaluate((element) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        element,
        "Native pending summary",
      );
    });
    await addDatabaseProperty(second.page, "Extra", "text");
    await expect(page.locator(".entry-panel").getByLabel("Extra", { exact: true })).toBeVisible();
    await expect(summary).toHaveValue("Native pending summary");
    await summary.dispatchEvent("input");
    await waitForEntryAutosave(page);
    await page.getByRole("button", { name: "Fermer le volet" }).click();
    await trigger.click();
    await expect(summary).toHaveValue("Native pending summary");
  } finally {
    await second.context.close();
  }
});

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
  await createRootDatabase(page, databaseName);
  await waitForSynchronized(page);
  await addDatabaseProperty(page, "Status", "select", ["To do", "Done"]);
  await addDatabaseProperty(page, "Due", "date");
  await addDatabaseProperty(page, "Summary", "text");
  await createEntry(page, alpha, { summary: "Alpha gallery summary", due: firstDate });
  await createEntry(page, beta, { summary: "Beta gallery summary" });

  await createView(page, "Nouvelle vue liste", /Liste/);
  await createView(page, "Nouvelle vue Kanban", /Kanban/);
  const alphaBoardTrigger = entryTrigger(page, alpha).first();
  const canonicalEntryId = await alphaBoardTrigger.getAttribute("data-entry-trigger");
  expect(canonicalEntryId).not.toBeNull();

  const doneColumn = page
    .locator("[data-board-column]")
    .filter({ has: page.getByRole("heading", { name: /^Done ·/ }) });
  await page.getByRole("button", { name: `Déplacer ${alpha} dans une autre colonne` }).click();
  await page.getByRole("menuitem", { name: "Done", exact: true }).click();
  await expect(doneColumn.locator(".database-card").filter({ hasText: alpha })).toBeVisible({
    timeout: 15_000,
  });
  await waitForSynchronized(page);

  const betaMove = page.getByRole("button", {
    name: `Déplacer ${beta} dans une autre colonne`,
  });
  await betaMove.press("Enter");
  await page.getByRole("menuitem", { name: "Done", exact: true }).press("Enter");
  await expect(doneColumn.locator(".database-card").filter({ hasText: beta })).toBeVisible({
    timeout: 15_000,
  });

  await createView(page, "Nouvelle vue galerie", /Galerie/);
  const alphaGalleryCard = page.locator(".database-gallery__card").filter({ hasText: alpha });
  await expect(alphaGalleryCard).toContainText("Alpha gallery summary");
  await expect(alphaGalleryCard).toContainText("Aucun aperçu sûr disponible");
  await expect(alphaGalleryCard.locator("[data-entry-trigger]")).toHaveAttribute(
    "data-entry-trigger",
    canonicalEntryId as string,
  );
  await alphaGalleryCard.locator("[data-entry-trigger]").click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(alpha);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await expect(page.locator(`[data-entry-trigger="${canonicalEntryId as string}"]`)).toBeFocused();

  await createView(page, "Nouvelle vue calendrier", /Calendrier/);
  const alphaCalendarCard = page.locator(".database-calendar__card").filter({ hasText: alpha });
  await expect(alphaCalendarCard).toBeVisible();
  await page.getByRole("button", { name: `Déplacer ${alpha} au jour suivant` }).click();
  await expect(page.getByLabel(`Planifier ${alpha}`)).toHaveValue(secondDate, {
    timeout: 15_000,
  });

  const betaSchedule = page.getByLabel(`Planifier ${beta}`);
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

  await databaseViewButton(page, /Table/).click();
  const alphaRow = page.locator(".database-grid tbody tr").filter({ hasText: alpha });
  await expect(alphaRow.getByRole("gridcell", { name: "Status, Done" })).toBeVisible();
  await expect(alphaRow.getByRole("gridcell", { name: `Due, ${secondDate}` })).toBeVisible();
  await expect(alphaRow.locator("[data-entry-trigger]")).toHaveAttribute(
    "data-entry-trigger",
    canonicalEntryId as string,
  );

  await databaseViewButton(page, /Galerie/).click();
  await expect(databaseViewButton(page, /Galerie/)).toHaveAttribute("aria-current", "page");
  // 200% zoom on a 640px viewport produces the same 320 CSS-pixel reflow
  // target without accidentally testing an unsupported effective width of
  // 160px.
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  await expect(databaseViewButton(page, /Galerie/)).toBeVisible();
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
  await expect(page.getByTestId("active-item-title")).toHaveValue(alpha);
});
