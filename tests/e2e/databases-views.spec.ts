import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  ensureNavigationVisible,
  openRootDatabaseCreation,
  openSecondDevice,
  openWorkspace,
  saveEntryProperties,
  selectItem,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

test("persists table/list filters, sorts, groups, columns and focus on two browsers", async ({
  page,
  browser,
  baseURL,
}) => {
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
  await openRootDatabaseCreation(page);
  const createDatabase = page.getByRole("form", { name: "Créer une base de données" });
  await createDatabase.getByLabel("Créer une base de données").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);

  await page.getByRole("button", { name: "Ajouter une propriété" }).click();
  const propertyEditor = page.getByRole("form", { name: "Éditeur de propriété" });
  await propertyEditor.getByLabel("Nom").fill("Status");
  await propertyEditor.getByLabel("Type").selectOption("status");
  await propertyEditor.getByLabel("Options séparées par des virgules").fill("To do, Done");
  await propertyEditor.getByRole("button", { name: "Enregistrer la propriété" }).click();
  await expect(page.locator(".database-schema").getByText("Status", { exact: true })).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  const createEntry = async (title: string, status: "To do" | "Done"): Promise<void> => {
    const trigger = await createDatabaseEntry(page, title);
    await waitForSynchronized(page);
    await trigger.click();
    const panel = page.locator(".entry-panel");
    await expect(panel).toBeVisible();
    await panel.getByLabel("Status", { exact: true }).selectOption({ label: status });
    await saveEntryProperties(page);
    await page.getByRole("button", { name: "Fermer l'entrée" }).click();
    await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
    await expect(
      page.locator(`[data-entry-trigger]`).filter({ hasText: title }).first(),
    ).toBeFocused({ timeout: 15_000 });
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
  await alphaStatus().getByLabel("Status", { exact: true }).selectOption({ label: "Done" });
  await alphaStatus()
    .getByRole("button", { name: `Enregistrer Status pour ${entries.alpha}` })
    .click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, Done");
  await waitForSynchronized(page);
  await alphaStatus().press("F2");
  await alphaStatus().getByLabel("Status", { exact: true }).selectOption({ label: "To do" });
  await alphaStatus()
    .getByRole("button", { name: `Enregistrer Status pour ${entries.alpha}` })
    .click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, To do");
  await waitForSynchronized(page);

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
  await expect(
    page.locator(`[data-entry-trigger]`).filter({ hasText: entries.gamma }),
  ).toBeVisible();
  await expect(page.locator(`[data-entry-trigger]`).filter({ hasText: entries.beta })).toHaveCount(
    0,
  );
  await waitForDatabaseDefinitionSaved(page);

  await filterEditor.getByLabel("Combinaison des filtres").selectOption("all");
  await filterEditor.getByRole("button", { name: "Enregistrer les filtres" }).click();
  await expect(
    page.locator(`[data-entry-trigger]`).filter({ hasText: entries.alpha }),
  ).toBeVisible();
  await expect(page.locator(`[data-entry-trigger]`).filter({ hasText: entries.gamma })).toHaveCount(
    0,
  );
  await waitForDatabaseDefinitionSaved(page);

  await filterEditor.getByRole("button", { name: "Effacer les filtres" }).click();
  await filterEditor.getByRole("button", { name: "Enregistrer les filtres" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(3);
  await waitForDatabaseDefinitionSaved(page);

  const sortEditor = page
    .locator(".database-rule-editor")
    .filter({ hasText: /^Tri et regroupement/ });
  await sortEditor.locator("summary").click();
  await sortEditor.getByRole("button", { name: "Ajouter un tri" }).click();
  await sortEditor.getByLabel("Direction").selectOption("descending");
  await sortEditor.getByLabel("Regrouper par").selectOption({ label: "Status" });
  await sortEditor.getByRole("button", { name: "Enregistrer le tri et le regroupement" }).click();
  await expect
    .poll(
      async () =>
        await page
          .locator("[data-entry-trigger]")
          .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
    )
    .toEqual([entries.gamma, entries.beta, entries.alpha]);
  await waitForDatabaseDefinitionSaved(page);

  const columns = page.locator(".database-columns");
  await columns.locator("summary").click();
  await columns.getByRole("checkbox", { name: "Status" }).uncheck();
  await expect(
    page.locator(".database-grid").getByRole("columnheader", { name: /Status/ }),
  ).toHaveCount(0);
  await waitForDatabaseDefinitionSaved(page);
  await columns.getByRole("checkbox", { name: "Status" }).check();
  await expect(
    page.locator(".database-grid").getByRole("columnheader", { name: /Status/ }),
  ).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);
  await columns.getByRole("button", { name: "Déplacer la colonne Status vers la gauche" }).click();
  await expect
    .poll(async () =>
      page
        .locator(".database-grid thead th")
        .evaluateAll((headers) => headers.map((header) => header.textContent?.trim())),
    )
    .toEqual([expect.stringContaining("Status"), expect.stringContaining("Titre")]);
  await waitForDatabaseDefinitionSaved(page);
  await page.getByRole("button", { name: "Augmenter la largeur de Titre" }).click();
  await expect(page.getByRole("group", { name: "Largeur de Titre : 280 pixels" })).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  await page.getByRole("button", { name: "Nouvelle vue liste" }).click();
  const listTab = page.getByRole("tab", { name: /Liste 2/ });
  await expect(listTab).toBeVisible({ timeout: 15_000 });
  await waitForDatabaseDefinitionSaved(page);
  await listTab.click();
  await expect(page.locator(".database-list")).toBeVisible();
  await expect(page.locator(".database-list__entry")).toHaveCount(3);
  const viewName = page.getByLabel("Nom de la vue");
  await viewName.fill("Planning");
  await expect(viewName).toHaveValue("Planning");
  await page.getByRole("button", { name: "Renommer la vue" }).click();
  await expect(page.getByRole("tab", { name: /Planning/ })).toBeVisible();
  await waitForDatabaseDefinitionSaved(page);

  await page.reload();
  await selectItem(page, databaseName);
  await expect(page.getByRole("tab", { name: /Planning/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".database-list")).toBeVisible();
  await page.getByRole("tab", { name: /Table/ }).click();
  await expect(page.getByRole("group", { name: "Largeur de Titre : 280 pixels" })).toBeVisible();

  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await selectItem(second.page, databaseName);
    await expect(second.page.getByRole("tab", { name: /Planning/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(second.page.locator("[data-entry-trigger]")).toHaveCount(3);
    await second.page.getByRole("tab", { name: /Planning/ }).click();
    await expect(second.page.locator(".database-list__entry")).toHaveCount(3);
  } finally {
    await second.context.close();
  }
});
