/**
 * The complete first structured-page journey (feature 009, US1).
 *
 * The global Playwright budget is one minute, which is substantially stricter
 * than SC-001's five-minute owner journey. Keeping the assertion too makes the
 * product requirement visible if the shared runner budget changes later.
 */
import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  createRootItem,
  ensureNavigationVisible,
  moveSelectedItemInto,
  openWorkspace,
  renameItem,
  saveEntryProperties,
  selectItem,
  trashItem,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

test("creates a typed database whose entry and relations keep canonical page identities", async ({
  page,
}) => {
  const startedAt = Date.now();
  await openWorkspace(page);

  const folderName = uniqueName("Archive");
  const targetName = uniqueName("Customer");
  const renamedTarget = uniqueName("Renamed customer");
  const databaseName = uniqueName("Projects");
  const entryName = uniqueName("Migration");

  await createRootItem(page, "folder", folderName);
  await createRootItem(page, "page", targetName);

  await page.getByTestId("new-root-database").click();
  const createDatabase = page.getByRole("form", { name: "Create a database" });
  await createDatabase.getByLabel("Create a database").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Create database" }).click();
  await expect(page.getByTestId(`tree-item-${databaseName}`)).toBeAttached({ timeout: 15_000 });
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
  await addProperty("Estimate", "number");
  await addProperty("Due", "date");
  await addProperty("Status", "status", "Planned, In progress, Done");
  await addProperty("Priority", "select", "Low, High");
  await addProperty("Tags", "multi-select", "Backend, Migration");
  await addProperty("Done", "checkbox");
  await addProperty("Related", "relation");

  const entryButton = await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  await entryButton.click();

  await expect(page.getByText("Database entry · page")).toBeVisible();
  await page.getByLabel("Notes").fill("Move the customer data without downtime");
  await page.getByLabel("Estimate").fill("12.5");
  await page.getByLabel("Due").fill("2026-09-15");
  await page.getByLabel("Status").selectOption({ label: "In progress" });
  await page.getByLabel("Priority").selectOption({ label: "High" });
  await page.getByLabel("Tags").selectOption(["Backend", "Migration"]);
  await page.getByLabel("Done").check();
  await page.getByLabel("Related").selectOption({ label: targetName });
  await saveEntryProperties(page);

  await page.getByRole("button", { name: "Close entry" }).click();
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();

  await selectItem(page, targetName);
  await renameItem(page, targetName, renamedTarget);
  await expect(page.getByTestId(`tree-item-${renamedTarget}`)).toBeVisible({ timeout: 15_000 });
  await selectItem(page, renamedTarget);
  await moveSelectedItemInto(page, folderName);

  await selectItem(page, databaseName);
  const reopenedEntryButton = page
    .locator(".database-table")
    .getByRole("button", { name: entryName, exact: true });
  await expect(reopenedEntryButton).toBeVisible({ timeout: 15_000 });
  await reopenedEntryButton.click();
  await expect(page.getByLabel("Related").locator("option:checked")).toHaveText(renamedTarget);
  await expect(page.getByLabel("Notes")).toHaveValue("Move the customer data without downtime");

  expect(Date.now() - startedAt).toBeLessThan(300_000);
});

test("announces the active entry count before trashing a database", async ({ page }) => {
  await openWorkspace(page);

  const databaseName = uniqueName("Trash preview");
  const entryNames = [uniqueName("First entry"), uniqueName("Second entry")];

  await ensureNavigationVisible(page);
  await page.getByTestId("new-root-database").click();
  const createDatabase = page.getByRole("form", { name: "Create a database" });
  await createDatabase.getByLabel("Create a database").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Create database" }).click();
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();

  for (const entryName of entryNames) {
    await createDatabaseEntry(page, entryName);
  }

  const confirmation = page.waitForEvent("dialog");
  const trash = trashItem(page, databaseName);

  const dialog = await confirmation;
  expect(dialog.message()).toBe(
    `Move “${databaseName}” and 2 active database entries to the trash?`,
  );
  await dialog.dismiss();
  await trash;
  await expect(page.getByTestId(`tree-item-${databaseName}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();
});
