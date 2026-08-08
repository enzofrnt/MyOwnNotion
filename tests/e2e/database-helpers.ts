import { expect, type Locator, type Page } from "@playwright/test";

export async function insertDatabase(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "Page formatting" })
    .getByRole("button", { name: "Insert database" })
    .click();
  const database = page.getByTestId("database-block").last();
  await expect(database).toBeVisible();
  await database.getByText("Properties", { exact: true }).click();
  return database;
}

export async function addDatabaseProperty(
  database: Locator,
  name: string,
  type: "text" | "number" | "select" | "date" | "checkbox" | "relation",
): Promise<void> {
  await database.getByRole("textbox", { name: "Property name", exact: true }).fill(name);
  await database.getByRole("combobox", { name: "Property type" }).selectOption(type);
  await database.getByRole("button", { name: "Add property" }).click();
  await expect(database.getByRole("textbox", { name: `Property name ${name}` })).toBeVisible();
}

export async function addSelectOption(
  database: Locator,
  propertyName: string,
  optionName: string,
): Promise<void> {
  await database.getByRole("textbox", { name: `New option for ${propertyName}` }).fill(optionName);
  await database.getByRole("button", { name: `Add option to ${propertyName}` }).click();
  await expect(database.getByRole("textbox", { name: `Option name ${optionName}` })).toBeVisible();
}

export async function addDatabaseRecord(database: Locator, title: string): Promise<void> {
  await database.getByRole("textbox", { name: "New record title" }).fill(title);
  await database.getByRole("button", { name: "Add record" }).click();
  await expect(database.getByRole("textbox", { name: `Record title ${title}` })).toBeVisible();
}

export async function visibleRecordIds(container: Locator): Promise<string[]> {
  return container.locator("[data-record-id]").evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const value = node.getAttribute("data-record-id");
      return value === null ? [] : [value];
    }),
  );
}
