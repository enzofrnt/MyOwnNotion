import { expect, test } from "./fixtures.ts";
import {
  closeMobileNavigation,
  createDatabaseEntry,
  createRootDatabase,
  createRootItem,
  nameNewlyCreatedItem,
  ensureNavigationVisible,
  openWorkspace,
  selectItem,
  trashItem,
  typeIntoEditor,
  uniqueName,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

test("a database is a navigable owner with direct page and folder entries", async ({ page }) => {
  await openWorkspace(page);
  const name = uniqueName("Owner database");
  await createRootDatabase(page, name);
  await expect(page.getByRole("navigation", { name: "Vues de la base" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une base", exact: true })).toHaveCount(0);
  await page.locator(".database-container-page__view-options > summary").click();
  await expect(page.getByLabel("Source de la vue")).toBeDisabled();
  await page.locator(".database-container-page__view-options > summary").click();

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

  await page.getByRole("button", { name: "Ajouter une vue" }).click();
  await page
    .getByRole("dialog", { name: "Ajouter une nouvelle vue" })
    .getByRole("button", { name: "Tableau" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Vues de la base" }).getByRole("button"),
  ).toHaveCount(3);
  await page.locator(".database-container-page__view-options > summary").click();
  await expect(page.getByLabel("Source de la vue")).toBeEnabled();
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
  await tabs.getByRole("button", { name: "Ajouter une vue" }).click();
  await page
    .getByRole("dialog", { name: "Ajouter une nouvelle vue" })
    .getByRole("button", { name: "Tableau" })
    .click();
  await container.getByLabel("Source de la vue").selectOption({ label: ownerB });
  await expect(container.locator("[data-entry-trigger]").filter({ hasText: entryB })).toBeVisible();
  await tabs.getByRole("button").first().click();
  await expect(container.locator("[data-entry-trigger]").filter({ hasText: entryA })).toBeVisible();
  await container.getByLabel("Source de la vue").selectOption({ label: ownerB });
  await expect(
    container.getByRole("button", { name: "Retrouver la source d’origine" }),
  ).toBeVisible();
  await container.getByRole("button", { name: "Retrouver la source d’origine" }).click();
  await expect(container.locator("[data-entry-trigger]").filter({ hasText: entryA })).toBeVisible();
  await container.locator(".database-container-page__view-options > summary").click();
  await container.getByLabel("Nom de la vue").fill("Source A retrouvée");
  await container.getByRole("button", { name: "Renommer" }).click();
  await expect(tabs.getByRole("button", { name: "Source A retrouvée" })).toBeVisible();
  await container.getByRole("button", { name: "Déplacer à gauche" }).click();
  await expect(tabs.getByRole("button").nth(1)).toContainText("Source A retrouvée");
  await container.getByRole("button", { name: "Supprimer la vue" }).click();
  await expect(tabs.getByRole("button", { name: "Source A retrouvée" })).toHaveCount(0);
});

test("the slash commands create one inline block or one full-page child link", async ({ page }) => {
  await openWorkspace(page);
  const parent = uniqueName("Slash database parent");
  await createRootItem(page, "page", parent);
  const editor = page.getByTestId("block-editor").locator(".ProseMirror");
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
    .getByRole("option", { name: /^Base de données - intégrée/u })
    .click();
  const block = page.getByTestId("database-view-block");
  await expect(block).toHaveCount(1);
  await expect(block.getByRole("navigation", { name: "Vues de la base" })).toHaveCount(0);
  await expect(editor).toContainText("Before the database");
  await expect(editor.locator('a[href^="#page="]')).toHaveCount(0);
  await waitForSynchronized(page);
  await page.reload();
  await selectItem(page, parent);
  await expect(page.getByTestId("database-view-block")).toHaveCount(1);

  const fullParent = uniqueName("Full-page parent");
  await createRootItem(page, "page", fullParent);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially("/base");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: /^Base de données - pleine page/u })
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
  const editor = page.getByTestId("block-editor").locator(".ProseMirror");
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
  await expect(page.getByTestId("database-view-block")).toHaveCount(1);
  await expect(page.getByTestId("database-view-block")).toContainText(entry);
  await waitForSynchronized(page);
  await page.reload();
  await selectItem(page, host);
  await expect(page.getByTestId("database-view-block")).toContainText(entry);
  await selectItem(page, owner);
  await trashItem(page, owner);
  await selectItem(page, host);
  await expect(page.getByTestId("database-view-block")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("database-view-block")).toContainText("corbeille");
});
