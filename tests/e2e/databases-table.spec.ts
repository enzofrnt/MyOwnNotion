import { expect, test } from "@playwright/test";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  insertDatabase,
  visibleRecordIds,
} from "./database-helpers.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("structured database table (US2)", () => {
  test("searches readable values and sorts numbers with exact counts and a contained empty state", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("DatabaseTable");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const database = await insertDatabase(page);
    await addDatabaseProperty(database, "Details", "text");
    await addDatabaseProperty(database, "Score", "number");
    for (const title of ["Gamma", "Alpha", "Beta"]) await addDatabaseRecord(database, title);
    await database
      .getByRole("textbox", { name: "Details for Gamma" })
      .fill("Unique searchable value");
    await database.getByRole("spinbutton", { name: "Score for Gamma" }).fill("10");
    await database.getByRole("spinbutton", { name: "Score for Alpha" }).fill("2");
    await database.getByRole("spinbutton", { name: "Score for Beta" }).fill("30");
    await expect(database.getByTestId("database-record-count")).toHaveText("3 records");

    await database.getByRole("searchbox", { name: "Search records" }).fill("searchable");
    await expect(database.getByTestId("database-record-count")).toHaveText("1 record");
    await expect(database.getByRole("textbox", { name: "Record title Gamma" })).toBeVisible();
    await database.getByRole("searchbox", { name: "Search records" }).fill("");
    await database.getByRole("combobox", { name: "Sort records" }).selectOption({ label: "Score" });
    await expect(
      database.locator("tbody tr").first().getByRole("textbox", { name: "Record title Alpha" }),
    ).toBeVisible();
    const ascending = await visibleRecordIds(database.getByTestId("database-table"));
    await database.getByRole("combobox", { name: "Sort direction" }).selectOption("desc");
    await expect(
      database.locator("tbody tr").first().getByRole("textbox", { name: "Record title Beta" }),
    ).toBeVisible();
    const descending = await visibleRecordIds(database.getByTestId("database-table"));
    expect(descending).toEqual([...ascending].reverse());

    await database.getByRole("searchbox", { name: "Search records" }).fill("No result anywhere");
    await expect(database.getByTestId("database-record-count")).toHaveText("0 records");
    await expect(database.getByTestId("database-empty-state")).toBeVisible();
    const blockOverflow = await database.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(blockOverflow).toBeLessThanOrEqual(2);
    await attachReviewScreenshot(page, testInfo, "database-table-empty");
  });
});
