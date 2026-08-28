import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorApplyCount,
  openRootCreation,
  openWorkspace,
  saveDocument,
  saveEntryProperties,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

async function openSearch(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Rechercher dans l’espace de travail" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Recherche", { exact: true }).fill(query);
  await dialog.getByRole("button", { name: "Rechercher", exact: true }).click();
  return dialog;
}

test("tracks one task page through roles, notes, relations, search and an independent checkbox", async ({
  page,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Tasks");
  const taskName = uniqueName("Ship task roles");
  const projectName = uniqueName("Related project");
  const propertyNote = uniqueName("structured-note");
  const editorialNote = uniqueName("editorial-checkbox");

  await createRootItem(page, "page", projectName);
  await openRootCreation(page);
  await page.getByTestId("new-root-database").click();
  const createDatabase = page.getByRole("form", { name: "Créer une base de données" });
  await createDatabase.getByLabel("Créer une base de données").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
  await waitForSynchronized(page);

  const addProperty = async (name: string, type: string, options?: string): Promise<void> => {
    await page.getByRole("button", { name: "Ajouter une propriété" }).click();
    const editor = page.getByRole("form", { name: "Éditeur de propriété" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Nom").fill(name);
    await editor.getByLabel("Type").selectOption(type);
    if (options !== undefined) {
      await editor.getByLabel("Options séparées par des virgules").fill(options);
    }
    await editor.getByRole("button", { name: "Enregistrer la propriété" }).click();
    await expect(page.locator(".database-schema").getByText(name, { exact: true })).toBeVisible();
    await waitForDatabaseDefinitionSaved(page);
  };

  await addProperty("Notes", "text");
  await addProperty("Workflow", "status", "To do, In progress, Done");
  await addProperty("Deadline", "date");
  await addProperty("Importance", "select", "Low, High");
  await addProperty("Project", "relation");

  const taskConfiguration = page.locator(".task-configuration");
  await taskConfiguration.getByRole("button", { name: "Activer le suivi des tâches" }).click();
  await expect(taskConfiguration.getByLabel("Propriété de statut de la tâche")).toHaveValue(/.+/u);
  await waitForDatabaseDefinitionSaved(page);
  await taskConfiguration
    .getByLabel("Propriété d'échéance de la tâche")
    .selectOption({ label: "Deadline" });
  await expect(taskConfiguration.getByLabel("Propriété d'échéance de la tâche")).toHaveValue(/.+/u);
  await waitForDatabaseDefinitionSaved(page);
  await taskConfiguration
    .getByLabel("Propriété de priorité de la tâche")
    .selectOption({ label: "Importance" });
  await expect(taskConfiguration.getByLabel("Propriété de priorité de la tâche")).toHaveValue(
    /.+/u,
  );
  await waitForDatabaseDefinitionSaved(page);

  const createEntry = page.locator(".database-entry-create");
  await createEntry.getByLabel("Nouvelle entrée").fill(taskName);
  await createEntry.getByRole("button", { name: "Nouvelle entrée" }).click();
  const taskTrigger = page.locator("[data-entry-trigger]").filter({ hasText: taskName }).first();
  await expect(taskTrigger).toBeVisible({ timeout: 15_000 });
  await waitForSynchronized(page);
  await taskTrigger.click();

  const entryPanel = page.locator(".entry-panel");
  await expect(entryPanel.getByLabel("Suivi des tâches")).toBeVisible();
  await entryPanel.getByLabel("Workflow", { exact: true }).selectOption({ label: "In progress" });
  await entryPanel.getByLabel("Deadline", { exact: true }).fill("2026-09-15");
  await entryPanel.getByLabel("Importance", { exact: true }).selectOption({ label: "High" });
  await entryPanel.getByLabel("Notes", { exact: true }).fill(propertyNote);
  await entryPanel.getByLabel("Project", { exact: true }).selectOption({ label: projectName });
  await saveEntryProperties(page);

  const legacyConversion = page.getByTestId("convert-legacy-document");
  if (await legacyConversion.isVisible()) await legacyConversion.click();
  await typeIntoEditor(page, editorialNote);
  const editorialBlock = page
    .getByTestId("block-editor")
    .locator(".bn-block-outer[data-id]")
    .filter({ hasText: editorialNote })
    .last();
  await editorialBlock.click({ button: "right" });
  const beforeTaskConversion = await editorApplyCount(page);
  await page.getByRole("menuitem", { name: "Liste de tâches" }).click();
  await waitForEditorSettled(page, { afterApplyCount: beforeTaskConversion });
  const documentCheckbox = page.getByTestId("block-editor").locator('input[type="checkbox"]');
  await expect(
    page.getByTestId("block-editor").locator('[data-content-type="checkListItem"]'),
  ).toBeVisible();
  const beforeCheck = await editorApplyCount(page);
  await documentCheckbox.click();
  await waitForEditorSettled(page, { afterApplyCount: beforeCheck });
  await expect(documentCheckbox).toBeChecked();
  await saveDocument(page);
  await waitForSynchronized(page);

  let search = await openSearch(page, propertyNote);
  let result = search.getByRole("listitem").filter({ hasText: taskName });
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Propriété correspondante : Notes");
  await search.getByRole("button", { name: "Fermer la recherche" }).click();

  search = await openSearch(page, "In progress");
  result = search.getByRole("listitem").filter({ hasText: taskName });
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Propriété correspondante : Workflow");
  await result.getByRole("button").click();
  await expect(entryPanel).toBeVisible();

  await entryPanel.getByLabel("Workflow", { exact: true }).selectOption({ label: "Done" });
  await saveEntryProperties(page);
  search = await openSearch(page, "Done");
  await expect(search.getByRole("listitem").filter({ hasText: taskName })).toHaveCount(1);
  await search.getByRole("button", { name: "Fermer la recherche" }).click();

  await expect(page.getByTestId("block-editor")).toContainText(editorialNote);
  await expect(documentCheckbox).toBeChecked();
  await expect(
    entryPanel.getByLabel("Project", { exact: true }).locator("option:checked"),
  ).toHaveText(projectName);
  await page.getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(1);
});
