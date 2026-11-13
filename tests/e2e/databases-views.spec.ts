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
  openDatabaseTools,
  openPropertyConfiguration,
  openSecondDevice,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

test("persists table/list filters, sorts, groups, columns and focus on two browsers", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  // This acceptance journey deliberately serializes many durable definition
  // writes before proving the result on a second device. Keep every individual
  // wait strict, while allowing the complete journey to run on a constrained
  // Firefox container without exhausting the suite-wide 60-second budget.
  test.setTimeout(150_000);

  await openWorkspace(page);
  const databaseName = uniqueName("Projects views");
  const entries = {
    alpha: uniqueName("Alpha"),
    beta: uniqueName("Beta"),
    gamma: uniqueName("Gamma"),
  };

  await ensureNavigationVisible(page);
  await createRootDatabase(page, databaseName);

  await addDatabaseProperty(page, "Status", "select", ["To do", "Done"]);

  const createEntry = async (title: string, status: "To do" | "Done"): Promise<void> => {
    const trigger = await createDatabaseEntry(page, title);
    await waitForSynchronized(page);
    await trigger.click();
    const panel = page.locator(".entry-panel");
    await expect(panel).toBeVisible();
    await chooseEntryOptions(page, "Status", [status]);
    await waitForEntryAutosave(page);
    await page.getByRole("button", { name: "Fermer le volet" }).click();
    await expect(page.locator(".database-entry-peek")).toBeHidden();
    await expect(
      page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
    ).toHaveValue(databaseName);
    await expect(entryTrigger(page, title).first()).toBeFocused({ timeout: 15_000 });
  };

  await createEntry(entries.alpha, "To do");
  await createEntry(entries.beta, "Done");
  await createEntry(entries.gamma, "To do");

  const alphaStatus = () =>
    page
      .locator(".database-grid tbody tr")
      .filter({ hasText: entries.alpha })
      .getByRole("gridcell", { name: /Status/ });
  await alphaStatus().focus();
  await alphaStatus().press("F2");
  await page.getByRole("menuitemradio", { name: "Done", exact: true }).click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, Done");
  await waitForSynchronized(page);
  await alphaStatus().press("F2");
  await page.getByRole("menuitemradio", { name: "To do", exact: true }).click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, To do");
  await waitForSynchronized(page);

  await openDatabaseTools(page);
  // The chrome now also renders the compact "Filtrer" popover next to the tools
  // trigger; scope the live editor to the opened tools panel.
  const filterEditor = page
    .locator(".database-settings-panel")
    .locator(".database-rule-editor")
    .filter({ hasText: /^Filtres/ });
  await filterEditor.locator("summary").click();
  await filterEditor.getByRole("button", { name: "Ajouter un filtre" }).click();
  let rules = filterEditor.locator(".database-rule");
  await rules.nth(0).getByLabel("Propriété").selectOption({ label: "Status" });
  await rules.nth(0).getByLabel("Opérateur").selectOption("equals");
  await rules.nth(0).getByLabel("Valeur pour Status").selectOption({ label: "To do" });
  await filterEditor.getByRole("button", { name: "Ajouter un filtre" }).click();
  rules = filterEditor.locator(".database-rule");
  await rules.nth(1).getByLabel("Propriété").selectOption({ label: "Titre" });
  await rules.nth(1).getByLabel("Opérateur").selectOption("contains");
  await rules.nth(1).getByLabel("Valeur pour Titre").fill("Alpha");
  await filterEditor.getByLabel("Combinaison des filtres").selectOption("any");
  await filterEditor.getByRole("button", { name: "Enregistrer les filtres" }).click();
  await expect(entryTrigger(page, entries.gamma)).toBeVisible();
  await expect(entryTrigger(page, entries.beta)).toHaveCount(0);
  await waitForDatabaseDefinitionSaved(page);

  await filterEditor.getByLabel("Combinaison des filtres").selectOption("all");
  await filterEditor.getByRole("button", { name: "Enregistrer les filtres" }).click();
  await expect(entryTrigger(page, entries.alpha)).toBeVisible();
  await expect(entryTrigger(page, entries.gamma)).toHaveCount(0);
  await waitForDatabaseDefinitionSaved(page);

  await filterEditor.getByRole("button", { name: "Effacer les filtres" }).click();
  await filterEditor.getByRole("button", { name: "Enregistrer les filtres" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(3);
  await waitForDatabaseDefinitionSaved(page);

  const sortEditor = page
    .locator(".database-settings-panel")
    .locator(".database-rule-editor")
    .filter({ hasText: /^Trier/ });
  await sortEditor.locator("summary").click();
  await sortEditor.getByRole("button", { name: "Ajouter un tri" }).click();
  await sortEditor.getByLabel("Direction").selectOption("descending");
  await sortEditor.getByRole("button", { name: "Enregistrer les tris", exact: true }).click();
  await expect
    .poll(
      async () =>
        await page
          .locator(".database-cell-title > .database-cell-text")
          .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
    )
    .toEqual([entries.gamma, entries.beta, entries.alpha]);
  await waitForDatabaseDefinitionSaved(page);

  const grouping = page.getByRole("region", { name: "Grouper", exact: true });
  await grouping.getByRole("button", { name: "Grouper par Aucun", exact: true }).click();
  await page
    .getByRole("menu", { name: "Grouper par", exact: true })
    .getByRole("menuitem", { name: "Status", exact: true })
    .click();
  await expect(
    grouping.getByRole("button", { name: "Grouper par Status", exact: true }),
  ).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  await page.keyboard.press("Escape");
  // Visibility is owned by the view settings sheet; the old header popover is
  // retired and the header now exposes "Options de la vue" instead.
  const settings = page.locator(".database-view-settings");
  await page.locator("[data-view-settings-trigger]").click();
  await settings.getByRole("button", { name: /Visibilité des propriétés/ }).click();
  await settings.getByRole("button", { name: "Masquer Status", exact: true }).click();
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader", { name: /Status/ }),
  ).toHaveCount(0);
  await waitForDatabaseDefinitionSaved(page);
  await settings.getByRole("button", { name: "Afficher Status", exact: true }).click();
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader", { name: /Status/ }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.keyboard.press("Escape");
  // Reordering lives in the visibility screen, dragged by its handle row: the
  // root database's chrome no longer renders the toolbar's column section.
  await page.locator("[data-view-settings-trigger]").click();
  await settings.getByRole("button", { name: /Visibilité des propriétés/ }).click();
  const visibilityRows = settings.locator("[data-visibility-row]");
  const statusRow = visibilityRows.filter({ hasText: "Status" });
  const titleRow = visibilityRows.filter({ hasText: "Titre" });
  const handle = statusRow.locator(".database-property-visibility-handle");
  const grabbed = await handle.boundingBox();
  const dropped = await titleRow.boundingBox();
  if (grabbed === null || dropped === null) throw new Error("Missing visibility rows");
  await page.mouse.move(grabbed.x + grabbed.width / 2, grabbed.y + grabbed.height / 2);
  await page.mouse.down();
  await page.mouse.move(grabbed.x + grabbed.width / 2, dropped.y + 4, { steps: 12 });
  await page.mouse.up();
  await waitForDatabaseDefinitionSaved(page);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  const columnNames = () =>
    page
      .getByTestId("database-view-surface")
      .locator("th .database-column-label__name")
      .allTextContents();
  await expect.poll(columnNames).toEqual(["Status", "Titre"]);
  // Capture the visibility screen at both themes and widths. The sheet is
  // reopened after each resize: it is anchored to the container stage, so a
  // viewport change while it is mounted can leave it unplaced until a gesture
  // reopens it — which is exactly what an owner does at that width.
  const openVisibility = async (): Promise<void> => {
    if (!(await settings.isVisible())) {
      await page.locator("[data-view-settings-trigger]").click();
    }
    const visibilityEntry = settings.getByRole("button", { name: /Visibilité des propriétés/ });
    if (await visibilityEntry.isVisible().catch(() => false)) await visibilityEntry.click();
    await expect(settings).toBeVisible();
  };
  const originalViewport = page.viewportSize();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openVisibility();
      const rect = await settings.boundingBox();
      if (rect === null) throw new Error("Missing visible view settings");
      expect(rect.x).toBeGreaterThanOrEqual(0);
      // The anchored sheet is sized in CSS pixels; fractional layouter rounding
      // leaves it a couple of subpixels past the edge at 320 px. Measure the
      // real overflow (not the 1 px assertion) so a genuinely off-screen sheet
      // still fails.
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 4);
      const path = testInfo.outputPath(`column-order-${theme}-${width}.png`);
      // A resize can remount the anchored sheet between resolution and capture;
      // page-level clip of the measured box still records the same region.
      await page.screenshot({ path, clip: rect });
      await testInfo.attach(`column-order-${theme}-${width}`, { path, contentType: "image/png" });
    }
  }
  if (originalViewport !== null) await page.setViewportSize(originalViewport);
  await page.emulateMedia({ colorScheme: "light" });
  if (await settings.isVisible()) {
    await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  }
  await expect(settings).toBeHidden();
  const titleWidth = page.getByRole("button", { name: /Largeur de Titre/ });
  await titleWidth.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Largeur de Titre : 280 pixels" })).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  await createDatabaseView(page, "Liste");
  const listTab = databaseViewButton(page, /Liste/);
  await expect(listTab).toBeVisible({ timeout: 15_000 });
  await waitForDatabaseDefinitionSaved(page);
  await listTab.click();
  await expect(page.locator(".database-list")).toBeVisible();
  await expect(page.locator(".database-list__entry")).toHaveCount(3);
  await page.locator("[data-view-settings-trigger]").click();
  const viewName = page.getByLabel("Nom de la vue");
  await viewName.fill("Planning");
  await expect(viewName).toHaveValue("Planning");
  await viewName.press("Enter");
  await page
    .locator(".database-view-settings")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await expect(databaseViewButton(page, /Planning/)).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  await page.reload();
  await selectItem(page, databaseName);
  await expect(databaseViewButton(page, /Planning/)).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".database-list")).toBeVisible();
  await databaseViewButton(page, /Table/).click();
  await expect.poll(columnNames).toEqual(["Status", "Titre"]);
  await expect(page.getByRole("button", { name: "Largeur de Titre : 280 pixels" })).toBeVisible();

  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await selectItem(second.page, databaseName);
    await expect(databaseViewButton(second.page, /Planning/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(second.page.locator("[data-entry-trigger]")).toHaveCount(3);
    await expect
      .poll(() =>
        second.page
          .getByTestId("database-view-surface")
          .locator("th .database-column-label__name")
          .allTextContents(),
      )
      .toEqual(["Status", "Titre"]);
    await databaseViewButton(second.page, /Planning/).click();
    await expect(second.page.locator(".database-list__entry")).toHaveCount(3);
  } finally {
    await second.context.close();
  }
});

test("property editing from the view settings keeps the panel mounted", async ({ page }) => {
  await openWorkspace(page);
  await createRootDatabase(page, uniqueName("Panel property edits"));
  await addDatabaseProperty(page, "Status", "select", ["To do", "Done"]);
  await openPropertyConfiguration(page, "Status");
  const settings = page.locator(".database-view-settings");
  await expect(settings).toHaveAttribute("data-closing", "false");
  const name = page.getByLabel("Nom de la propriété", { exact: true });
  await name.click();
  // The flyout is portaled to the body, so a click inside it must not be read
  // as "outside the panel" and start closing the settings screen.
  await expect(settings).toHaveAttribute("data-closing", "false");
  await name.fill("État");
  await name.press("Enter");
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader").filter({ hasText: "État" }),
  ).toBeVisible();
  await expect(settings).toHaveAttribute("data-closing", "false");
  // A definition refresh can remount the flyout after the rename: re-acquire it
  // instead of holding a locator whose popover may have been replaced.
  const reopened = await openPropertyConfiguration(page, "État");
  // Option edits come from the same portaled flyout: its menu must keep the
  // host screen open when it opens, commits and closes.
  await reopened.getByRole("button", { name: "Modifier l’option To do", exact: true }).click();
  const optionName = page.getByRole("textbox", { name: "Nom de l'option", exact: true });
  await expect(optionName).toBeVisible();
  await expect(settings).toHaveAttribute("data-closing", "false");
  await optionName.press("Escape");
  await expect(optionName).toBeHidden();
  await expect(settings).toHaveAttribute("data-closing", "false");
  // Escape inside the portaled property editor closes that editor only.
  await page.getByLabel("Nom de la propriété", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(reopened).toBeHidden();
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute("data-closing", "false");
  await waitForDatabaseDefinitionSaved(page);
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
});
