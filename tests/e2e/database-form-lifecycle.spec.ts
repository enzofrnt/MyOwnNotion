import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  openRootDatabaseCreation,
  openSecondDevice,
  openWorkspace,
  saveEntryProperties,
  selectItem,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

test("cancels a pressed property action outside its button and activates exactly once from the keyboard", async ({
  page,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Interaction lifecycle");
  await openRootDatabaseCreation(page);
  const creation = page.getByRole("form", { name: "Créer une base de données" });
  await creation.getByLabel("Créer une base de données").fill(databaseName);
  await creation.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
  await waitForSynchronized(page);
  await page.getByRole("button", { name: "Ajouter une propriété" }).click();
  const form = page.getByRole("form", { name: "Éditeur de propriété" });
  const name = uniqueName("Owner draft");
  await form.getByLabel("Nom", { exact: true }).fill(name);
  const save = form.getByRole("button", { name: "Enregistrer la propriété" });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  if (box === null) throw new Error("Missing save target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Holding the button must not persist anything, even if the server can respond.
  await expect(form).toBeVisible();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Nom", { exact: true })).toHaveValue(name);
  await expect(page.locator(".database-schema").getByText(name, { exact: true })).toHaveCount(0);
  await save.focus();
  await page.keyboard.press("Space");
  await expect(form).toBeHidden();
  await waitForDatabaseDefinitionSaved(page);
  await expect(page.locator(".database-schema").getByText(name, { exact: true })).toHaveCount(1);
});

test("preserves a composing dirty field while another device updates an untouched property", async ({
  page,
  browser,
  baseURL,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Draft synchronization");
  const entryName = uniqueName("Current entry");
  await openRootDatabaseCreation(page);
  const creation = page.getByRole("form", { name: "Créer une base de données" });
  await creation.getByLabel("Créer une base de données").fill(databaseName);
  await creation.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
  await waitForSynchronized(page);
  for (const name of ["Notes", "Shared"]) {
    await page.getByRole("button", { name: "Ajouter une propriété" }).click();
    const form = page.getByRole("form", { name: "Éditeur de propriété" });
    await form.getByLabel("Nom", { exact: true }).fill(name);
    await form.getByLabel("Type", { exact: true }).selectOption("text");
    await form.getByRole("button", { name: "Enregistrer la propriété" }).click();
    await waitForDatabaseDefinitionSaved(page);
  }
  const entry = await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  await entry.click();
  const second = await openSecondDevice(browser, baseURL);
  try {
    await second.page.goto(baseURL ?? "http://127.0.0.1:5873");
    await openWorkspace(second.page);
    await selectItem(second.page, databaseName);
    await second.page
      .locator("[data-entry-trigger]")
      .filter({ hasText: entryName })
      .first()
      .click();
    const local = page.locator(".entry-panel");
    const remote = second.page.locator(".entry-panel");
    const notes = local.getByLabel("Notes", { exact: true });
    await expect(remote.getByLabel("Shared", { exact: true })).toBeVisible();
    await notes.focus();
    await notes.dispatchEvent("compositionstart", { data: "" });
    await notes.fill("日本語の下書き");
    await notes.dispatchEvent("compositionupdate", { data: "日本語の下書き" });
    const original = await notes.elementHandle();
    await remote.getByLabel("Shared", { exact: true }).fill("Updated on another device");
    await saveEntryProperties(second.page);
    await waitForSynchronized(second.page);
    await expect(local.getByLabel("Shared", { exact: true })).toHaveValue(
      "Updated on another device",
      { timeout: 15_000 },
    );
    await expect(notes).toHaveValue("日本語の下書き");
    expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
    await notes.dispatchEvent("compositionend", { data: "日本語の下書き" });
    await saveEntryProperties(page);
    await waitForSynchronized(page);
    await expect(remote.getByLabel("Notes", { exact: true })).toHaveValue("日本語の下書き", {
      timeout: 15_000,
    });
  } finally {
    await second.context.close();
  }
});
