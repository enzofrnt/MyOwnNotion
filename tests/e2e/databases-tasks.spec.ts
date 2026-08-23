import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  saveDocument,
  saveEntryProperties,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

async function openSearch(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search the workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Query").fill(query);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
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
  await page.getByTestId("new-root-database").click();
  const createDatabase = page.getByRole("form", { name: "Create a database" });
  await createDatabase.getByLabel("Create a database").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Create database" }).click();
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();
  await waitForSynchronized(page);

  const addProperty = async (name: string, type: string, options?: string): Promise<void> => {
    await page.getByRole("button", { name: "Add property" }).click();
    const editor = page.getByRole("form", { name: "Property editor" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Name").fill(name);
    await editor.getByLabel("Type").selectOption(type);
    if (options !== undefined) {
      await editor.getByLabel("Options, separated by commas").fill(options);
    }
    await editor.getByRole("button", { name: "Save property" }).click();
    await expect(page.locator(".database-schema").getByText(name, { exact: true })).toBeVisible();
    await waitForDatabaseDefinitionSaved(page);
  };

  await addProperty("Notes", "text");
  await addProperty("Workflow", "status", "To do, In progress, Done");
  await addProperty("Deadline", "date");
  await addProperty("Importance", "select", "Low, High");
  await addProperty("Project", "relation");

  const taskConfiguration = page.locator(".task-configuration");
  await taskConfiguration.getByRole("button", { name: "Enable task tracking" }).click();
  await expect(taskConfiguration.getByLabel("Task status property")).toHaveValue(/.+/u);
  await waitForDatabaseDefinitionSaved(page);
  await taskConfiguration.getByLabel("Task due date property").selectOption({ label: "Deadline" });
  await expect(taskConfiguration.getByLabel("Task due date property")).toHaveValue(/.+/u);
  await waitForDatabaseDefinitionSaved(page);
  await taskConfiguration
    .getByLabel("Task priority property")
    .selectOption({ label: "Importance" });
  await expect(taskConfiguration.getByLabel("Task priority property")).toHaveValue(/.+/u);
  await waitForDatabaseDefinitionSaved(page);

  const createEntry = page.locator(".database-entry-create");
  await createEntry.getByLabel("New entry").fill(taskName);
  await createEntry.getByRole("button", { name: "New entry" }).click();
  const taskTrigger = page.locator("[data-entry-trigger]").filter({ hasText: taskName }).first();
  await expect(taskTrigger).toBeVisible({ timeout: 15_000 });
  await waitForSynchronized(page);
  await taskTrigger.click();

  const entryPanel = page.locator(".entry-panel");
  await expect(entryPanel.getByLabel("Task tracking")).toBeVisible();
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
  await page.getByRole("menuitem", { name: "Liste de tâches" }).click();
  const documentCheckbox = page.getByTestId("block-editor").locator('input[type="checkbox"]');
  await expect(
    page.getByTestId("block-editor").locator('[data-content-type="checkListItem"]'),
  ).toBeVisible();
  // BlockNote replaces the checklist NodeView as part of the change handler.
  // WebKit mobile therefore detaches the input that Playwright's `check()`
  // immediately re-reads, even though the user gesture reached the editor.
  // Assert against the freshly rendered control instead of that stale node.
  await documentCheckbox.click();
  await expect(documentCheckbox).toBeChecked();
  await saveDocument(page);
  await waitForSynchronized(page);

  let search = await openSearch(page, propertyNote);
  let result = search.getByRole("listitem").filter({ hasText: taskName });
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Matched property: Notes");
  await search.getByRole("button", { name: "Close search" }).click();

  search = await openSearch(page, "In progress");
  result = search.getByRole("listitem").filter({ hasText: taskName });
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Matched property: Workflow");
  await result.getByRole("button").click();
  await expect(entryPanel).toBeVisible();

  await entryPanel.getByLabel("Workflow", { exact: true }).selectOption({ label: "Done" });
  await saveEntryProperties(page);
  search = await openSearch(page, "Done");
  await expect(search.getByRole("listitem").filter({ hasText: taskName })).toHaveCount(1);
  await search.getByRole("button", { name: "Close search" }).click();

  await expect(page.getByTestId("block-editor")).toContainText(editorialNote);
  await expect(documentCheckbox).toBeChecked();
  await expect(
    entryPanel.getByLabel("Project", { exact: true }).locator("option:checked"),
  ).toHaveText(projectName);
  await page.getByRole("button", { name: "Close entry" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(1);
});
