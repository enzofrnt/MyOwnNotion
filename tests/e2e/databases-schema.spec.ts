/**
 * The complete first structured-page journey (feature 009, US1).
 *
 * This journey has a two-minute Playwright budget, still below SC-001's
 * five-minute owner journey. Its own elapsed-time assertion keeps that product
 * requirement visible if the shared runner budget changes later.
 */
import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  chooseEntryOptions,
  chooseEntryRelation,
  createDatabaseEntry,
  createRootDatabase,
  createRootItem,
  ensureNavigationVisible,
  entryTrigger,
  moveSelectedItemInto,
  openSettingsSection,
  openWorkspace,
  renameItem,
  returnToWorkspace,
  selectItem,
  trashItem,
  uniqueName,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

test("creates a typed database whose entry and relations keep canonical page identities", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const startedAt = Date.now();
  await openWorkspace(page);

  const folderName = uniqueName("Archive");
  const targetName = uniqueName("Customer");
  const renamedTarget = uniqueName("Renamed customer");
  const databaseName = uniqueName("Projects");
  const entryName = uniqueName("Migration");

  await createRootItem(page, "folder", folderName);
  await createRootItem(page, "page", targetName);

  await createRootDatabase(page, databaseName);
  await expect(page.getByTestId(`tree-item-${databaseName}`)).toBeAttached({ timeout: 15_000 });
  await expect(
    page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
  ).toHaveValue(databaseName);
  await waitForSynchronized(page);

  await addDatabaseProperty(page, "Notes", "text");
  await addDatabaseProperty(page, "Estimate", "number");
  await addDatabaseProperty(page, "Due", "date");
  await addDatabaseProperty(page, "Status", "status", ["Planned", "In progress", "Done"]);
  await addDatabaseProperty(page, "Priority", "select", ["Low", "High"]);
  await addDatabaseProperty(page, "Tags", "multi-select", ["Backend", "Migration"]);
  await addDatabaseProperty(page, "Done", "checkbox");
  await addDatabaseProperty(page, "Related", "relation");

  const entryButton = await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  await entryButton.click();

  await expect(
    page.locator(".entry-panel").getByRole("textbox", { name: "Titre de la page", exact: true }),
  ).toHaveValue(entryName);
  const entryPanel = page.locator(".entry-panel");
  await entryPanel
    .getByLabel("Notes", { exact: true })
    .fill("Move the customer data without downtime");
  await entryPanel.getByLabel("Estimate", { exact: true }).fill("12.5");
  await entryPanel.getByLabel("Due", { exact: true }).fill("2026-09-15");
  await chooseEntryOptions(page, "Status", ["In progress"]);
  await chooseEntryOptions(page, "Priority", ["High"]);
  await chooseEntryOptions(page, "Tags", ["Backend", "Migration"]);
  await entryPanel.getByLabel("Done", { exact: true }).check();
  await chooseEntryRelation(page, "Related", targetName);
  await waitForEntryAutosave(page);

  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await expect(page.locator(".database-entry-peek")).toBeHidden();
  await expect(
    page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
  ).toHaveValue(databaseName);

  await selectItem(page, targetName);
  // Eight prior schema writes can delay this batch in a full browser matrix;
  // still require the exact rename mutation to be accepted by the server.
  await renameItem(page, targetName, renamedTarget, { responseTimeoutMs: 45_000 });
  await expect(page.getByTestId(`tree-item-${renamedTarget}`)).toBeVisible({ timeout: 15_000 });
  await selectItem(page, renamedTarget);
  await moveSelectedItemInto(page, folderName);

  await selectItem(page, databaseName);
  const reopenedEntryButton = entryTrigger(page, entryName);
  await expect(reopenedEntryButton).toBeVisible({ timeout: 15_000 });
  await reopenedEntryButton.click();
  await expect(entryPanel.getByRole("button", { name: "Related", exact: true })).toHaveText(
    renamedTarget,
  );
  await expect(entryPanel.getByLabel("Notes", { exact: true })).toHaveValue(
    "Move the customer data without downtime",
  );

  expect(Date.now() - startedAt).toBeLessThan(300_000);
});

test("trashes and restores the owner with the same direct entry pages", async ({ page }) => {
  let snapshotRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/snapshots/current") snapshotRequests += 1;
  });
  await openWorkspace(page);
  const initialSnapshotRequests = snapshotRequests;

  const databaseName = uniqueName("Trash preview");
  const entryNames = [uniqueName("First entry"), uniqueName("Second entry")];

  await ensureNavigationVisible(page);
  await createRootDatabase(page, databaseName);
  await expect(
    page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
  ).toHaveValue(databaseName);

  for (const entryName of entryNames) {
    await createDatabaseEntry(page, entryName);
  }
  const entryIds = await page
    .locator("[data-entry-trigger]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-entry-trigger")));
  expect(entryIds).toHaveLength(2);

  await trashItem(page, databaseName, { confirm: false });
  const confirmation = page.getByTestId("trash-confirmation");
  await expect(confirmation).toContainText("1 source de données");
  await expect(confirmation).toContainText("pourra affecter les vues qui les utilisent ailleurs");
  await confirmation.getByTestId("cancel-trash").click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByTestId(`tree-item-${databaseName}`)).toBeVisible();
  await expect(
    page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
  ).toHaveValue(databaseName);
  await trashItem(page, databaseName);
  await openSettingsSection(page, "trash");
  // Routing must retain the initialized workspace even when every item is in
  // the trash. Re-seeding here can replace the live projection under Restore.
  expect(snapshotRequests).toBe(initialSnapshotRequests);
  await page
    .getByTestId(`trash-item-${databaseName}`)
    .getByRole("button", { name: "Restaurer" })
    .click();
  await expect(page.getByTestId("trash-settings")).toContainText(
    `« ${databaseName} » a été restauré.`,
  );
  await returnToWorkspace(page);
  await selectItem(page, databaseName);
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(2);
  expect(
    await page
      .locator("[data-entry-trigger]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-entry-trigger"))),
  ).toEqual(entryIds);
  for (const entryName of entryNames) {
    await expect(entryTrigger(page, entryName)).toBeVisible();
  }
});
