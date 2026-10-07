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
  test.slow();

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
  const filterEditor = page.locator(".database-rule-editor").filter({ hasText: /^Filtres/ });
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

  const sortEditor = page.locator(".database-rule-editor").filter({ hasText: /^Trier/ });
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
  const columnsButton = page.getByRole("button", { name: "Afficher ou masquer les propriétés" });
  await columnsButton.click();
  const columns = page.locator(".database-property-visibility");
  await columns.getByRole("switch", { name: "Afficher Status dans cette vue" }).click();
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader", { name: /Status/ }),
  ).toHaveCount(0);
  await waitForDatabaseDefinitionSaved(page);
  await columns.getByRole("switch", { name: "Afficher Status dans cette vue" }).click();
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader", { name: /Status/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Reordering is offered by the view's visibility screen and persists independently of the source schema.
  await page.getByRole("button", { name: "Options de la vue" }).click();
  const settings = page.locator(".database-view-settings");
  await settings.getByRole("button", { name: /Visibilité des propriétés/ }).click();
  await settings.getByRole("button", { name: "Déplacer la colonne Status vers la gauche" }).click();
  await waitForDatabaseDefinitionSaved(page);
  const columnNames = () =>
    page
      .getByTestId("database-view-surface")
      .locator("th .database-column-label__name")
      .allTextContents();
  await expect.poll(columnNames).toEqual(["Status", "Titre"]);
  const originalViewport = page.viewportSize();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(settings).toBeVisible();
      const rect = await settings.boundingBox();
      if (rect === null) throw new Error("Missing visible view settings");
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
      const path = testInfo.outputPath(`column-order-${theme}-${width}.png`);
      await settings.screenshot({ path });
      await testInfo.attach(`column-order-${theme}-${width}`, { path, contentType: "image/png" });
    }
  }
  if (originalViewport !== null) await page.setViewportSize(originalViewport);
  await page.emulateMedia({ colorScheme: "light" });
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
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
  await page.getByRole("button", { name: "Options de la vue" }).click();
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
