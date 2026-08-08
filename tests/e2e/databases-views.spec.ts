import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
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

test.describe("structured database views (US3)", () => {
  test("keeps exact identity parity across table, board, and gallery and focuses cards", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const pageName = uniqueName("DatabaseViews");
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const database = await insertDatabase(page);
    await addDatabaseProperty(database, "Status", "select");
    await addDatabaseProperty(database, "Summary", "text");
    await addSelectOption(database, "Status", "Active");
    await addSelectOption(database, "Status", "Done");
    for (const title of ["First", "Second", "Unassigned"]) await addDatabaseRecord(database, title);
    await database.getByRole("combobox", { name: "Status for First" }).selectOption({
      label: "Active",
    });
    await database.getByRole("combobox", { name: "Status for Second" }).selectOption({
      label: "Done",
    });
    await database.getByRole("textbox", { name: "Summary for First" }).fill("Visible card summary");
    const tableIds = await visibleRecordIds(database.getByTestId("database-table"));

    await database.getByRole("button", { name: "Board" }).click();
    await database.getByRole("combobox", { name: "Board group" }).selectOption({
      label: "Status",
    });
    await expect(database.getByRole("heading", { name: /Active 1 records/ })).toBeVisible();
    await expect(database.getByRole("heading", { name: /Done 1 records/ })).toBeVisible();
    await expect(database.getByRole("heading", { name: /Unassigned 1 records/ })).toBeVisible();
    const boardIds = await visibleRecordIds(database.getByTestId("database-board"));
    expect(new Set(boardIds)).toEqual(new Set(tableIds));
    await attachReviewScreenshot(page, testInfo, "database-board");

    await database.getByRole("button", { name: "Gallery" }).click();
    const galleryIds = await visibleRecordIds(database.getByTestId("database-gallery"));
    expect(galleryIds).toEqual(tableIds);
    await expect(database.getByRole("button", { name: "Open record First" })).toContainText(
      "Visible card summary",
    );
    await database.getByRole("button", { name: "Open record First" }).click();
    await expect(database.getByRole("region", { name: "Record editor First" })).toBeFocused();
    const axe = await new AxeBuilder({ page }).include(".database-block").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    await attachReviewScreenshot(page, testInfo, "database-gallery");
  });
});
