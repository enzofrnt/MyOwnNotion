import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  createRootDatabase,
  entryTrigger,
  openWorkspace,
  selectItem,
  waitForDatabaseDefinitionSaved,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

// Local helper deliberately follows the current type picker, not the retired
// shared property-creation form. All writes below use the real owner UI.
async function addProperty(page: Page, name: string, type: string) {
  const add = page
    .locator(".database-table-add-property")
    .getByRole("button", { name: "Ajouter une propriété", exact: true });
  await add.focus();
  await add.click();
  await page.getByRole("textbox", { name: "Nom de la nouvelle propriété", exact: true }).fill(name);
  await page
    .locator(".database-new-column__types")
    .getByRole("button", { name: type, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Nom de la nouvelle propriété", exact: true }),
  ).toBeHidden();
  await waitForSynchronized(page);
  await waitForDatabaseDefinitionSaved(page);
  // The column header follows the acknowledged definition mutation; on a slow
  // engine it can still be pending when the journey opens its settings.
  await expect(
    page.getByTestId("database-view-surface").getByRole("columnheader").filter({ hasText: name }),
  ).toBeVisible({ timeout: 20_000 });
}

// The column header menu is this spec's proven way into property settings; the
// settings sheet stays reserved for the option journeys.
async function openPropertyConfiguration(page: Page, name: string) {
  const column = page.getByRole("button", { name: `Modifier ${name}`, exact: true });
  // The header follows the acknowledged definition mutation; a slower engine
  // can still be rendering it when the journey asks for it.
  await expect(column).toBeVisible({ timeout: 20_000 });
  await column.focus();
  await column.click();
  await page
    .locator(".database-column-editor__action-row:visible")
    .filter({ hasText: "Modifier la propriété" })
    .click();
  // The pointer can rest on a row that owns a hover submenu ("Trier"): move it
  // away and wait the column flyout out before the property editor is used,
  // otherwise the stale submenu intercepts the next click.
  await page.mouse.move(0, 0);
  await expect(page.locator(".database-column-editor__flyout:visible")).toHaveCount(0);
  await expect(page.locator(".property-settings:visible")).toBeVisible();
}

async function closeConfiguration(page: Page) {
  await page.keyboard.press("Escape");
  const settings = page.locator(".database-view-settings");
  if (await settings.isVisible()) {
    await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  }
  // The sheet animates out; a later "Modifier la propriété" click must not race
  // the still-mounted, detaching rows.
  await expect(settings).toBeHidden();
}

async function configureTotal(page: Page) {
  await openPropertyConfiguration(page, "Total");
  await page
    .locator(".rollup-settings")
    .getByRole("button", { name: /^Relation/ })
    .click();
  await page.getByRole("menuitemradio", { name: "Related", exact: true }).click();
  await page
    .locator(".rollup-settings")
    .getByRole("button", { name: /^Propriété cible/ })
    .click();
  // This must exist while B has NO rows: source schema, never inferred links.
  await page.getByRole("menuitemradio", { name: "Amount", exact: true }).click();
  await page
    .locator(".rollup-settings")
    .getByRole("button", { name: /^Calculer/ })
    .click();
  await chooseSum(page);
  await closeConfiguration(page);
  await waitForSynchronized(page);
}

/**
 * « Somme » lives in the « Plus d'options » submenu. Pointer travel across the
 * gutter races the nested menu's hide timer under Playwright, so the keyboard
 * path (ArrowRight then Enter) is used; it is also the documented interaction.
 */
async function chooseSum(page: Page) {
  const more = page.getByRole("menuitem", { name: "Plus d’options", exact: true });
  await more.focus();
  await page.keyboard.press("ArrowRight");
  const sum = page.getByRole("menuitemradio", { name: "Somme", exact: true });
  await expect(sum).toBeVisible();
  // Opening a submenu asserts its items render before focus lands on the first
  // one. Enter pressed in that gap activates the parent trigger again, so wait
  // for the documented keyboard focus rather than only for visibility.
  await expect(sum).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Calculer/ })).toContainText("Somme");
}

test("configured relation to an empty source persists and computes 10 + 20 = 30, formula 60", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await openWorkspace(page);
  const sourceA = "057 Projects A";
  const sourceB = "057 Amounts B";
  await createRootDatabase(page, sourceB);
  await addProperty(page, "Amount", "Nombre");
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(0);
  await createRootDatabase(page, sourceA);
  await addProperty(page, "Related", "Relation");
  await openPropertyConfiguration(page, "Related");
  await page.getByRole("button", { name: /Liée à/ }).click();
  const sourceSearch = page.getByRole("textbox", { name: "Rechercher une source de données" });
  await expect(sourceSearch).toBeFocused();
  await sourceSearch.fill(sourceB);
  await page
    .locator(".relation-property-settings__menu:visible")
    .screenshot({ path: testInfo.outputPath("relation-source-search-light.png") });
  await page.getByRole("menuitem", { name: sourceB, exact: true }).click();
  await expect(page.getByRole("button", { name: /Liée à/ })).toContainText(sourceB);
  await page
    .locator(".relation-property-settings:visible")
    .screenshot({ path: testInfo.outputPath("relation-settings-light.png") });
  const limit = page.getByRole("button", { name: /^Limite/ });
  await limit.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Aucune limite", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("menu", { name: "Limite de la relation", exact: true })
    .screenshot({ path: testInfo.outputPath("relation-limit-light.png") });
  await page.keyboard.press("Escape");
  await expect(limit).toBeFocused();
  await closeConfiguration(page);
  await waitForSynchronized(page);
  await addProperty(page, "Total", "Agrégation");
  await configureTotal(page);
  await page.reload();
  await expect(
    page.getByTestId("workspace-page-canvas").getByTestId("active-item-title"),
  ).toHaveValue(sourceA);
  await openPropertyConfiguration(page, "Related");
  await expect(page.getByRole("button", { name: /Liée à/ })).toContainText(sourceB);
  await closeConfiguration(page);

  await selectItem(page, sourceB);
  for (const [title, amount] of [
    ["057 Ten", "10"],
    ["057 Twenty", "20"],
  ] as const) {
    await (await createDatabaseEntry(page, title)).click();
    await page.locator(".entry-panel").getByLabel("Amount", { exact: true }).fill(amount);
    await waitForEntryAutosave(page);
    await page.getByRole("button", { name: "Fermer le volet" }).click();
  }
  await selectItem(page, sourceA);
  await addProperty(page, "Double", "Formule");
  await openPropertyConfiguration(page, "Double");
  await page.getByRole("button", { name: "Modifier la formule", exact: true }).click();
  await page.getByRole("textbox", { name: "Formule", exact: true }).fill('prop("Total") * 2');
  await page
    .getByRole("dialog", { name: "Modifier la formule", exact: true })
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await closeConfiguration(page);
  await waitForSynchronized(page);
  await (await createDatabaseEntry(page, "057 Project")).click();
  const panel = page.locator(".entry-panel");
  for (const title of ["057 Ten", "057 Twenty"]) {
    const relation = panel.getByRole("button", { name: "Related", exact: true });
    const option = page.getByRole("menuitemcheckbox", { name: title, exact: true });
    // The menu can already be open from the previous pick; only click to open
    // when the option is not rendered, so the trigger is never toggled twice.
    if (!(await option.isVisible().catch(() => false))) await relation.click();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    // The chosen pill is the durable projection of the link, whether the menu
    // stays open or closes after the pick.
    await expect(panel.getByRole("button", { name: "Related", exact: true })).toContainText(title);
  }
  const relationControl = panel.getByRole("button", { name: "Related", exact: true });
  if ((await relationControl.getAttribute("aria-expanded")) === "true")
    await page.keyboard.press("Escape");
  await waitForEntryAutosave(page);
  const total = panel.locator(".database-field--entry").filter({
    has: page.getByRole("button", { name: "Modifier la propriété Total", exact: true }),
  });
  const double = panel.locator(".database-field--entry").filter({
    has: page.getByRole("button", { name: "Modifier la propriété Double", exact: true }),
  });
  await expect(total).toContainText("30");
  await expect(double).toContainText("60");
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  const row = page.getByRole("row").filter({ hasText: "057 Project" });
  await expect(row).toContainText("30");
  await expect(row).toContainText("60");
  await page.reload();
  await expect(row).toContainText("30");
  await expect(row).toContainText("60");
  await entryTrigger(page, "057 Project").click();
  await expect(panel.getByRole("button", { name: "Related", exact: true })).toContainText(
    "057 Ten",
  );
  await expect(total).toContainText("30");
  await expect(double).toContainText("60");
  await panel.screenshot({ path: testInfo.outputPath("relation-values-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await panel.screenshot({ path: testInfo.outputPath("relation-values-dark.png") });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(total).toContainText("30");
    await expect(double).toContainText("60");
    await panel.screenshot({ path: testInfo.outputPath(`relation-values-dark-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  // The related entries are already local. Removing a link works without the
  // network and the same derived result is persisted when the device reconnects.
  await page.context().setOffline(true);
  await panel.getByRole("button", { name: "Related", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "057 Twenty", exact: true }).click();
  await waitForEntryAutosave(page, { synchronize: false });
  await expect(total.locator(".database-field__readonly")).toHaveText("10");
  await expect(double.locator(".database-field__readonly")).toHaveText("20");
  await page.context().setOffline(false);
  await waitForSynchronized(page);
  await page.reload();
  await expect(row.getByRole("gridcell", { name: "Total, 10", exact: true })).toBeVisible();
  await expect(row.getByRole("gridcell", { name: "Double, 20", exact: true })).toBeVisible();
});

test("relation and rollup isolate a second source in the same database container", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkspace(page);
  const host = "057 Two sources";
  await createRootDatabase(page, host);
  await addProperty(page, "Ignored", "Nombre");
  await (await createDatabaseEntry(page, "057 Primary only")).click();
  await page.locator(".entry-panel").getByLabel("Ignored", { exact: true }).fill("999");
  await waitForEntryAutosave(page);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await page.getByRole("button", { name: "Ajouter une vue", exact: true }).click();
  await page.getByRole("button", { name: "Créer une nouvelle source", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tableau 2", exact: true })).toBeVisible();
  await addProperty(page, "Amount", "Nombre");
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(0);
  await createRootDatabase(page, "057 Consumer");
  await addProperty(page, "Related", "Relation");
  await openPropertyConfiguration(page, "Related");
  await page.getByRole("button", { name: /Liée à/ }).click();
  await page
    .getByRole("textbox", { name: "Rechercher une source de données" })
    .fill("Nouvelle source");
  await page.getByRole("menuitem", { name: "Nouvelle source", exact: true }).click();
  await closeConfiguration(page);
  await waitForSynchronized(page);
  await addProperty(page, "Total", "Agrégation");
  await openPropertyConfiguration(page, "Total");
  await page
    .locator(".rollup-settings")
    .getByRole("button", { name: /^Propriété cible/ })
    .click();
  // The primary source's property must never be offered for the secondary source.
  const amountTarget = page.getByRole("menuitemradio", { name: "Amount", exact: true });
  await expect(amountTarget).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("menuitemradio", { name: "Ignored", exact: true })).toHaveCount(0);
  await amountTarget.click();
  await page
    .locator(".rollup-settings")
    .getByRole("button", { name: /^Calculer/ })
    .click();
  await chooseSum(page);
  await closeConfiguration(page);
  await waitForSynchronized(page);
  await selectItem(page, host);
  await page.getByRole("button", { name: "Tableau 2", exact: true }).click();
  await (await createDatabaseEntry(page, "057 Secondary only")).click();
  await page.locator(".entry-panel").getByLabel("Amount", { exact: true }).fill("17");
  await waitForEntryAutosave(page);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await selectItem(page, "057 Consumer");
  await (await createDatabaseEntry(page, "057 Secondary project")).click();
  const panel = page.locator(".entry-panel");
  await panel.getByRole("button", { name: "Related", exact: true }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "057 Primary only", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitemcheckbox", { name: "057 Secondary only", exact: true }).click();
  await waitForEntryAutosave(page);
  await expect(
    panel
      .locator(".database-field--entry")
      .filter({
        has: page.getByRole("button", { name: "Modifier la propriété Total", exact: true }),
      })
      .locator(".database-field__readonly"),
  ).toHaveText("17");
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "057 Secondary project" })
      .getByRole("gridcell", { name: "Total, 17", exact: true }),
  ).toBeVisible();
});

test("a two-way relation shows on both sides and reads the same link", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkspace(page);
  const sourceB = "057 Pair amounts";
  const sourceA = "057 Pair projects";
  await createRootDatabase(page, sourceB);
  await (await createDatabaseEntry(page, "057 Pair target")).click();
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await waitForSynchronized(page);
  await createRootDatabase(page, sourceA);
  await addProperty(page, "Related", "Relation");
  await waitForSynchronized(page);
  await openPropertyConfiguration(page, "Related");
  await page.getByRole("button", { name: /Liée à/ }).click();
  await page.getByRole("textbox", { name: "Rechercher une source de données" }).fill(sourceB);
  await page.getByRole("menuitem", { name: sourceB, exact: true }).click();
  await page.locator("[data-relation-pair]").click();
  const linkedName = page.getByRole("textbox", { name: "Nom de la propriété liée" });
  // The activation action stays disabled until the linked name is committed.
  // WebKit can project the controlled input's previous empty state back into
  // the DOM between the native fill and its input event, so retry the fill until
  // the value really sticks.
  await expect
    .poll(
      async () => {
        if ((await linkedName.inputValue()) === "Projets liés") return "Projets liés";
        await linkedName.fill("Projets liés").catch(() => {});
        return linkedName.inputValue().catch(() => "");
      },
      { timeout: 20_000 },
    )
    .toBe("Projets liés");
  const activate = page.getByRole("menuitem", { name: "Activer la relation liée" });
  await expect(activate).toBeEnabled();
  await activate.click();
  await waitForSynchronized(page);
  // The row must reflect the new state, not just the projection behind it.
  await expect(page.locator("[data-relation-pair]")).toContainText("Activé", {
    timeout: 15_000,
  });
  await page
    .locator(".relation-property-settings:visible")
    .screenshot({ path: "test-results/057-pair-active.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page
    .locator(".relation-property-settings:visible")
    .screenshot({ path: "test-results/057-pair-active-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await closeConfiguration(page);
  await selectItem(page, sourceB);
  await expect(
    page.getByRole("button", { name: "Modifier Projets liés", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await selectItem(page, sourceA);
  await (await createDatabaseEntry(page, "057 Pair source")).click();
  const panel = page.locator(".entry-panel");
  await panel.getByRole("button", { name: "Related", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "057 Pair target", exact: true }).click();
  await waitForEntryAutosave(page);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await selectItem(page, sourceB);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "057 Pair target" })
      .getByRole("gridcell", { name: "Projets liés, 1 liée", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "057 Pair target" })
      .getByRole("gridcell", { name: "Projets liés, 1 liée", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  // The value control is the button named after the property; the other button
  // with that text is the property label. Editing from this side writes the
  // partner's edge, so the canonical cell loses the link.
  await entryTrigger(page, "057 Pair target").click();
  await expect(page.locator(".entry-panel")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Projets liés", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "057 Pair source", exact: true }).click();
  await waitForSynchronized(page);
  await expect(page.locator(".entry-panel [role=alert]")).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await selectItem(page, sourceA);
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "057 Pair source" })
      .getByRole("gridcell", { name: "Related, —", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
});
