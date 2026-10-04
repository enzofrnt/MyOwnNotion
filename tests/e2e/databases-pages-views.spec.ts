import { MISSING_DATA_SOURCE_MESSAGE } from "@myownnotion/domain";
import { expect, test } from "./fixtures.ts";
import {
  closeMobileNavigation,
  createDatabaseEntry,
  createDatabaseView,
  createRootDatabase,
  createRootItem,
  databaseViewButton,
  ensureNavigationVisible,
  entryTrigger,
  nameNewlyCreatedItem,
  openRootDatabaseCreation,
  openWorkspace,
  selectItem,
  trashItem,
  typeIntoEditor,
  uniqueName,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

test("database creation replaces the navigation drawer and cancellation returns to it", async ({
  page,
}) => {
  await openWorkspace(page);
  await openRootDatabaseCreation(page);
  const dialog = page.getByRole("dialog", { name: "Nouvelle base de données" });
  await expect(dialog.getByRole("button", { name: "Créer une nouvelle source" })).toBeVisible();
  const mobile = await page.evaluate(() => window.innerWidth < 768);
  if (mobile) await expect(page.getByTestId("workspace-navigation-drawer")).toBeHidden();
  await dialog.getByRole("button", { name: "Créer une nouvelle source" }).click({ trial: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  if (mobile) await expect(page.getByTestId("workspace-navigation-drawer")).toBeVisible();
  await expect(page.getByTestId("toggle-root-creation")).toBeVisible();
});

test("a database is a navigable owner with direct page and folder entries", async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName("Owner database");
  await createRootDatabase(page, name);
  await expect(page.getByRole("navigation", { name: "Vues de la base" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une base", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Options de la vue" }).click();
  const settings = page.locator(".database-view-settings");
  const lockedReason = "Ajoutez une deuxième vue pour changer sa source.";
  await expect(settings.getByRole("button", { name: /^Source/ })).toBeDisabled();
  await expect(settings.getByRole("button", { name: /^Source/ })).toHaveAccessibleDescription(
    lockedReason,
  );
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
  const firstView = databaseViewButton(page, "Tableau");
  await firstView.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions de la vue" });
  await expect(menu.getByRole("menuitem", { name: /^Source/ })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: /^Source/ })).toHaveAccessibleDescription(
    lockedReason,
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const entry = uniqueName("Database page");
  await createDatabaseEntry(page, entry);
  const folder = uniqueName("Database folder");
  await createDatabaseEntry(page, folder, "folder");
  await waitForSynchronized(page);
  await ensureNavigationVisible(page);
  await page.getByRole("button", { name: `Déplier ${name}` }).click();
  await expect(page.getByTestId(`tree-item-${entry}`)).toBeAttached();
  await expect(page.getByTestId(`tree-item-${folder}`)).toBeAttached();
  await closeMobileNavigation(page);

  await createDatabaseView(page, "Tableau");
  await expect(databaseViewButton(page, "Tableau 2")).toHaveAttribute("aria-current", "page");
  await databaseViewButton(page, "Tableau 2").press("Shift+F10");
  await expect(menu.getByRole("menuitem", { name: /^Source/ })).toBeEnabled();
  await menu.getByRole("menuitem", { name: /^Source/ }).click();
  await expect(settings.getByRole("heading", { name: "Source", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Retour", exact: true }).click();
  await expect(settings.getByRole("button", { name: /^Source/ })).toBeEnabled();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.getByRole("button", { name: "Options de la vue" }).click();
  await settings.getByRole("button", { name: /^Source/ }).click();
  await expect(settings.getByText("Ajoutez une deuxième vue pour changer sa source.")).toHaveCount(
    0,
  );
});

test("a page can create a child database without a footer insertion control", async ({ page }) => {
  await openWorkspace(page);
  const parent = uniqueName("Parent note");
  await createRootItem(page, "page", parent);
  await expect(page.getByRole("button", { name: "Ajouter une base", exact: true })).toHaveCount(0);
  const child = uniqueName("Child database");
  await ensureNavigationVisible(page);
  const row = page.getByTestId(`tree-item-${parent}`);
  if (await page.evaluate(() => window.innerWidth >= 768)) await row.hover();
  await row.focus();
  await row.getByTestId(`toggle-inline-create-${parent}`).click();
  await row.getByTestId(`new-database-inline-${parent}`).click();
  await page
    .getByRole("dialog", { name: "Nouvelle base de données" })
    .getByRole("button", { name: "Créer une nouvelle source" })
    .click();
  await nameNewlyCreatedItem(page, child);
  await selectItem(page, parent);
  await expect(page.getByTestId(`tree-item-${child}`)).toBeAttached();
});

test("views can use different sources while the owner's original source remains recoverable", async ({
  page,
}) => {
  await openWorkspace(page);
  const ownerA = uniqueName("Source A");
  const ownerB = uniqueName("Source B");
  await createRootDatabase(page, ownerA);
  const entryA = uniqueName("Entry A");
  await createDatabaseEntry(page, entryA);
  await createRootDatabase(page, ownerB);
  const entryB = uniqueName("Entry B");
  await createDatabaseEntry(page, entryB);

  await selectItem(page, ownerA);
  const container = page.locator(".database-container-page");
  const tabs = container.getByRole("navigation", { name: "Vues de la base" });
  await createDatabaseView(page, "Tableau");
  const settings = page.locator(".database-view-settings");
  const chooseSource = async () => {
    await page.getByRole("button", { name: "Options de la vue" }).click();
    await settings.getByRole("button", { name: /^Source/ }).click();
    await settings.getByRole("button", { name: new RegExp(`^${ownerB}`) }).click();
    await expect(entryTrigger(container, entryB)).toBeVisible();
    await waitForSynchronized(page);
    await settings.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(settings).toBeHidden();
  };
  await chooseSource();
  await databaseViewButton(page, "Tableau").click();
  await expect(entryTrigger(container, entryA)).toBeVisible();
  await chooseSource();
  await page.getByRole("button", { name: "Options de la vue" }).click();
  await settings.getByRole("button", { name: /^Source/ }).click();
  await settings.getByRole("button", { name: "Retrouver la source d’origine" }).click();
  await expect(entryTrigger(container, entryA)).toBeVisible();
  await settings.getByRole("button", { name: "Retour", exact: true }).click();
  const name = settings.getByLabel("Nom de la vue");
  await name.fill("Source A retrouvée");
  await name.press("Enter");
  await expect(databaseViewButton(page, "Source A retrouvée")).toBeVisible();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
  const recovered = databaseViewButton(page, "Source A retrouvée");
  await recovered.focus();
  await recovered.press("Space");
  await expect(recovered).toHaveAttribute("data-dragging", "true");
  await recovered.press("ArrowLeft");
  await expect
    .poll(() =>
      recovered.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41),
    )
    .toBeLessThan(0);
  await recovered.press("Space");
  await expect(tabs.locator(".database-container-page__tab").nth(1)).toContainText(
    "Source A retrouvée",
  );
  await recovered.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Supprimer la vue" }).click();
  const confirmation = page.getByTestId("retire-owned-source-view");
  await confirmation.getByText("Supprimer la vue uniquement", { exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Supprimer la vue uniquement", exact: true })
    .click();
  await expect(recovered).toHaveCount(0);
});

test("the slash commands create one inline block or one full-page child link", async ({ page }) => {
  await openWorkspace(page);
  const parent = uniqueName("Slash database parent");
  await createRootItem(page, "page", parent);
  const editor = page.locator('[data-testid="block-editor"]:visible').locator(".ProseMirror");
  await typeIntoEditor(page, "Before the database");
  await editor.press("ControlOrMeta+Alt+Enter");
  const blocks = editor.locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first()).toContainText("Before the database");
  await blocks.last().locator(":scope > .bn-block > .bn-block-content").click();
  await waitForEditorSettled(page);
  await expect(editor).toContainText("Before the database");
  await editor.pressSequentially("/base intégrée");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /^Base de données — intégrée/u })
    .click();
  const block = page
    .locator('[data-testid="block-editor"]:visible')
    .locator('[data-testid="database-view-block"][contenteditable="false"]');
  await expect(block).toHaveCount(1);
  await expect(block.getByRole("navigation", { name: "Vues de la base" })).toBeVisible();
  await expect(editor).toContainText("Before the database");
  await expect(editor.locator('a[href^="#page="]')).toHaveCount(0);
  await waitForSynchronized(page);
  await page.reload();
  await selectItem(page, parent);
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]'),
  ).toHaveCount(1);

  const fullParent = uniqueName("Full-page parent");
  await createRootItem(page, "page", fullParent);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/base");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /^Base de données — pleine page/u })
    .click();
  await expect(page.getByRole("navigation", { name: "Vues de la base" })).toBeVisible();
  await selectItem(page, fullParent);
  await expect(editor.locator('a[href^="#page="]')).toHaveCount(1);
  await expect(editor.getByTestId("database-view-block")).toHaveCount(0);
});

test("a linked block shares its source and warns after its owner is trashed", async ({ page }) => {
  await openWorkspace(page);
  const owner = uniqueName("Linked source");
  await createRootDatabase(page, owner);
  const entry = uniqueName("Shared entry");
  await createDatabaseEntry(page, entry);
  await waitForSynchronized(page);

  const host = uniqueName("Linked host");
  await createRootItem(page, "page", host);
  const editor = page.locator('[data-testid="block-editor"]:visible').locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/vue liée");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /^Vue liée de base de données/u })
    .click();
  const picker = page.getByTestId("linked-database-picker");
  await picker.getByLabel("Source").selectOption({ label: owner });
  await picker.getByRole("button", { name: "Insérer la vue" }).click();
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]'),
  ).toHaveCount(1);
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]'),
  ).toContainText(entry);
  await waitForSynchronized(page);
  await page.reload();
  await selectItem(page, host);
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]'),
  ).toContainText(entry);
  await selectItem(page, owner);
  await trashItem(page, owner);
  await selectItem(page, host);
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]')
      .locator('[role="alert"]'),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-testid="block-editor"]:visible')
      .locator('[data-testid="database-view-block"][contenteditable="false"]'),
  ).toContainText(MISSING_DATA_SOURCE_MESSAGE);
});
