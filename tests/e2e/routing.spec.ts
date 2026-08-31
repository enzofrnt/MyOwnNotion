import { generateUuidV7 } from "@myownnotion/domain";
import { expect, test } from "./fixtures.ts";
import {
  convertItem,
  createDatabaseEntry,
  createRootItem,
  moveSelectedItemInto,
  openRootDatabaseCreation,
  openWorkspace,
  renameItem,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test("page, folder, database and entry URLs survive identity changes and history", async ({
  page,
}) => {
  test.slow();
  await openWorkspace(page);
  await expect(page).toHaveURL(/\/notes(?:\/|$)/u);

  const pageName = uniqueName("RoutePage");
  const renamedPage = `${pageName}-renamed`;
  await createRootItem(page, "page", pageName);
  const pageUrl = page.url();
  expect(new URL(pageUrl).pathname).toMatch(/^\/notes\/[0-9a-f-]+$/u);

  await renameItem(page, pageName, renamedPage);
  await expect(page).toHaveURL(pageUrl);

  const folderName = uniqueName("RouteFolder");
  await createRootItem(page, "folder", folderName);
  const folderUrl = page.url();
  expect(new URL(folderUrl).pathname).toMatch(/^\/notes\/[0-9a-f-]+$/u);
  expect(folderUrl).not.toBe(pageUrl);

  await page.goBack();
  await expect(page).toHaveURL(pageUrl);
  await expect(page.getByTestId("active-item-title")).toHaveValue(renamedPage);

  await page.goForward();
  await expect(page).toHaveURL(folderUrl);
  await expect(page.getByTestId("active-item-title")).toHaveValue(folderName);

  await page.reload();
  await expect(page).toHaveURL(folderUrl);
  await expect(page.getByTestId("active-item-title")).toHaveValue(folderName);

  await selectItem(page, renamedPage);
  await convertItem(page, renamedPage);
  await expect(page).toHaveURL(pageUrl);
  await moveSelectedItemInto(page, folderName);
  await expect(page).toHaveURL(pageUrl);

  const databaseName = uniqueName("RouteDatabase");
  await openRootDatabaseCreation(page);
  const createDatabase = page.getByRole("form", { name: "Créer une base de données" });
  await createDatabase.getByLabel("Créer une base de données").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
  const databaseUrl = page.url();
  expect(new URL(databaseUrl).pathname).toMatch(/^\/notes\/[0-9a-f-]+$/u);

  const entryName = uniqueName("RouteEntry");
  const entry = await createDatabaseEntry(page, entryName);
  await entry.click();
  await expect(page.locator(".entry-panel")).toBeVisible();
  const entryUrl = page.url();
  expect(new URL(entryUrl).pathname).toMatch(/^\/notes\/[0-9a-f-]+$/u);
  expect(entryUrl).not.toBe(databaseUrl);

  await page.goBack();
  await expect(page).toHaveURL(databaseUrl);
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
  await page.goForward();
  await expect(page).toHaveURL(entryUrl);
  await expect(page.locator(".entry-panel")).toBeVisible();

  await page.getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page).toHaveURL(databaseUrl);
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName);
});

test("unknown and malformed deep links never reopen the previous note", async ({ page }) => {
  await page.goto("/somewhere-else", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("route-not-found")).toBeVisible();
  await expect(page.getByTestId("workspace-surface")).toHaveCount(0);

  await page.goto("/notes/not-a-uuid", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("route-not-found")).toBeVisible();
  await expect(page).toHaveURL(/\/notes\/not-a-uuid$/u);

  await page.getByRole("button", { name: "Retour aux notes" }).click();
  await expect(page).toHaveURL(/\/notes(?:\/|$)/u);
  await expect(page.getByTestId("workspace-surface")).toBeVisible();
});

test("browser history restores five successive note destinations in order", async ({ page }) => {
  await openWorkspace(page);
  const destinations: Array<{ readonly name: string; readonly url: string }> = [];
  for (let index = 1; index <= 5; index += 1) {
    const name = uniqueName(`RouteHistory${index}`);
    await createRootItem(page, "page", name);
    destinations.push({ name, url: page.url() });
  }

  for (let index = destinations.length - 2; index >= 0; index -= 1) {
    const destination = destinations[index];
    if (destination === undefined) throw new Error("missing history destination");
    await page.goBack();
    await expect(page).toHaveURL(destination.url);
    await expect(page.getByTestId("active-item-title")).toHaveValue(destination.name);
  }
  for (let index = 1; index < destinations.length; index += 1) {
    const destination = destinations[index];
    if (destination === undefined) throw new Error("missing history destination");
    await page.goForward();
    await expect(page).toHaveURL(destination.url);
    await expect(page.getByTestId("active-item-title")).toHaveValue(destination.name);
  }
});

test("a direct local note reloads without the API and an absent identity stays explicit", async ({
  page,
}) => {
  await openWorkspace(page);
  const pageName = uniqueName("RouteOffline");
  await createRootItem(page, "page", pageName);
  const localUrl = page.url();

  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
  await page.goto(localUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("active-item-title")).toHaveValue(pageName, { timeout: 15_000 });

  const absentItemId = generateUuidV7();
  await page.evaluate((itemId) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.history.pushState(null, "", `/notes/${itemId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, absentItemId);
  await expect(page).toHaveURL(`/notes/${absentItemId}`);
  await expect(page.getByText("Cette note n’est pas présente sur cet appareil.")).toBeVisible();
});
