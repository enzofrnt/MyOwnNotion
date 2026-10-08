import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  chooseEntryOptions,
  chooseEntryRelation,
  closeMobileNavigation,
  createDatabaseEntry,
  createRootDatabase,
  createRootItem,
  editorApplyCount,
  entryTrigger,
  openDatabaseTools,
  openWorkspace,
  saveDocument,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForEditorSettled,
  waitForEntryAutosave,
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

for (const cancel of [false, true]) {
  test(`keeps a property action stable while a new database opens${cancel ? " and permits cancellation" : ""}`, async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const databaseName = uniqueName("Stable property");
    await createRootDatabase(page, databaseName);
    // Naming the owner also renames its source asynchronously. Finish that
    // distinct edit before measuring the geometry of a property gesture.
    await expect(
      page.getByRole("textbox", { name: "Titre de la source", exact: true }),
    ).toHaveValue(databaseName);
    await expect(
      page.getByTestId("database-view-surface").getByRole("columnheader").first(),
    ).toBeVisible();
    // Classification is known at creation. A page-editor placeholder above the
    // database would move this action after the owner has already pressed it.
    await expect(page.getByTestId("editor-loading-skeleton")).not.toBeVisible();
    const addProperty = page.getByRole("button", { name: "Ajouter une propriété" });
    const stopObserving = await addProperty.evaluateHandle((button) => {
      const position = () => ({
        top: button.getBoundingClientRect().top,
        ownerScrollTop: button.closest(".workspace-main")?.scrollTop ?? 0,
        pageScrollY: window.scrollY,
      });
      const positions = [position()];
      let connected = true;
      const sample = () => {
        connected &&= button.isConnected;
        if (button.isConnected) positions.push(position());
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      return () => {
        sample();
        observer.disconnect();
        const tops = positions.map(({ top }) => top);
        return {
          connected,
          displacement: Math.max(...tops) - Math.min(...tops),
          positions,
        };
      };
    });
    await addProperty.click();
    const form = page.getByRole("form", { name: "Éditeur de propriété" });
    await form.getByLabel("Nom", { exact: true }).fill("Notes");
    const stability = await stopObserving.evaluate((stop) => stop());
    await stopObserving.dispose();
    const stabilityPath = testInfo.outputPath("property-action-stability.json");
    await writeFile(stabilityPath, JSON.stringify(stability, null, 2));
    await testInfo.attach("property-action-stability", {
      path: stabilityPath,
      contentType: "application/json",
    });
    expect(stability.connected).toBe(true);
    expect(stability.displacement).toBeLessThanOrEqual(1);
    const save = form.getByRole("button", { name: "Enregistrer la propriété" });
    await save.scrollIntoViewIfNeeded();
    const before = await save.boundingBox();
    if (before === null) throw new Error("Property save action is not visible");
    const held = await save.elementHandle();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    const after = await save.boundingBox();
    expect(await held?.evaluate((element) => element.isConnected)).toBe(true);
    expect(Math.abs((after?.y ?? Number.POSITIVE_INFINITY) - before.y)).toBeLessThanOrEqual(1);
    if (cancel) await page.mouse.move(0, 0);
    await page.mouse.up();
    if (cancel) {
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Nom", { exact: true })).toHaveValue("Notes");
      await save.focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      page.locator(".database-schema").getByText("Notes", { exact: true }),
    ).toBeVisible();
    await waitForDatabaseDefinitionSaved(page);
  });
}

test("tracks one task page through roles, notes, relations, search and an independent checkbox", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Tasks");
  const taskName = uniqueName("Ship task roles");
  const projectName = uniqueName("Related project");
  const propertyNote = uniqueName("structured-note");
  const editorialNote = uniqueName("editorial-checkbox");

  await createRootItem(page, "page", projectName);
  await createRootDatabase(page, databaseName);
  await waitForSynchronized(page);

  await addDatabaseProperty(page, "Notes", "text");
  await addDatabaseProperty(page, "Workflow", "status", ["To do", "In progress", "Done"]);
  await addDatabaseProperty(page, "Deadline", "date");
  await addDatabaseProperty(page, "Importance", "select", ["Low", "High"]);
  await addDatabaseProperty(page, "Project", "relation");

  await openDatabaseTools(page);
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

  await page.keyboard.press("Escape");
  await createDatabaseEntry(page, taskName);
  const taskTrigger = entryTrigger(page, taskName).first();
  await expect(taskTrigger).toBeVisible({ timeout: 15_000 });
  await waitForSynchronized(page);
  await taskTrigger.click();

  const entryPanel = page.locator(".entry-panel");
  await expect(entryPanel.getByLabel("Suivi des tâches")).toBeVisible();
  await chooseEntryOptions(page, "Workflow", ["In progress"]);
  await entryPanel.getByLabel("Deadline", { exact: true }).fill("2026-09-15");
  await chooseEntryOptions(page, "Importance", ["High"]);
  await entryPanel.getByLabel("Notes", { exact: true }).fill(propertyNote);
  await chooseEntryRelation(page, "Project", projectName);
  await waitForEntryAutosave(page);

  const legacyConversion = page.getByTestId("convert-legacy-document");
  if (await legacyConversion.isVisible()) await legacyConversion.click();
  await typeIntoEditor(page, editorialNote);
  const editorialBlock = page
    .locator('[data-testid="block-editor"]:visible')
    .locator(".bn-block-outer[data-id]")
    .filter({ hasText: editorialNote })
    .last();
  await editorialBlock.click({ button: "right" });
  const blockMenu = page.getByRole("menu", { name: "Actions du bloc" });
  await expect(blockMenu).toBeVisible();
  const expectMenuInViewport = async () => {
    await expect
      .poll(() =>
        blockMenu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
  };
  await expectMenuInViewport();
  await blockMenu.focus();
  await page.keyboard.press("Escape");
  await expect(blockMenu).toBeHidden();
  await expect(page.locator(".database-entry-peek")).toBeVisible();
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("Menu geometry requires a configured viewport");
  try {
    for (const width of new Set([viewport.width, 320])) {
      await page.setViewportSize({ width, height: viewport.height });
      await closeMobileNavigation(page);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await editorialBlock.click({ button: "right" });
        await expect(blockMenu).toBeVisible();
        await expectMenuInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`side-peek-menu-${width}-${colorScheme}.png`),
        });
        await blockMenu.focus();
        await page.keyboard.press("Escape");
        await expect(blockMenu).toBeHidden();
        await expect(page.locator(".database-entry-peek")).toBeVisible();
      }
    }
  } finally {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: null });
  }
  await editorialBlock.click({ button: "right" });
  await expect(blockMenu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("side-peek-editor-menu.png") });
  const beforeTaskConversion = await editorApplyCount(page);
  await page.getByRole("menuitem", { name: "Liste de tâches" }).click();
  await expect(blockMenu).toBeHidden();
  await expect(page.locator(".database-entry-peek")).toBeVisible();
  await waitForEditorSettled(page, { afterApplyCount: beforeTaskConversion });
  const documentCheckbox = page
    .locator('[data-testid="block-editor"]:visible')
    .locator('input[type="checkbox"]');
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-content-type="checkListItem"]'),
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
  await expect(page.locator(".database-entry-peek")).toBeHidden();

  await chooseEntryOptions(page, "Workflow", ["Done"]);
  await waitForEntryAutosave(page);
  search = await openSearch(page, "Done");
  await expect(search.getByRole("listitem").filter({ hasText: taskName })).toHaveCount(1);
  await search.getByRole("button", { name: "Fermer la recherche" }).click();

  await expect(page.locator('[data-testid="block-editor"]:visible')).toContainText(editorialNote);
  await expect(documentCheckbox).toBeChecked();
  await expect(entryPanel.getByRole("button", { name: "Project", exact: true })).toHaveText(
    projectName,
  );
  await page.getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(1);
});
