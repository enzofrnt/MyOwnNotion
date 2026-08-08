import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
  insertDatabase,
} from "./database-helpers.ts";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("structured database editing (US1)", () => {
  test("edits every property type and preserves stable records across reload, rename, and move", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const folderName = uniqueName("DatabaseFolder");
    const pageName = uniqueName("DatabaseEdit");
    const renamedPageName = `${pageName}-renamed`;
    await createRootItem(page, "folder", folderName);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const database = await insertDatabase(page);
    const databaseId = await database.getAttribute("data-database-id");
    expect(databaseId).toMatch(/^[0-9a-f-]{36}$/);

    for (const [name, type] of [
      ["Notes", "text"],
      ["Estimate", "number"],
      ["Status", "select"],
      ["Due", "date"],
      ["Ready", "checkbox"],
      ["Related", "relation"],
    ] as const) {
      await addDatabaseProperty(database, name, type);
    }
    await addSelectOption(database, "Status", "Active");
    await addSelectOption(database, "Status", "Done");
    await addDatabaseRecord(database, "Alpha");
    await addDatabaseRecord(database, "Beta");

    const alphaRow = database.getByRole("row", { name: /^Alpha / });
    const betaRow = database.getByRole("row", { name: /^Beta / });
    const alphaId = await alphaRow.getAttribute("data-record-id");
    const betaId = await betaRow.getAttribute("data-record-id");
    expect(alphaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(betaId).toMatch(/^[0-9a-f-]{36}$/);
    await database.getByRole("textbox", { name: "Notes for Alpha" }).fill("Durable details");
    await database.getByRole("spinbutton", { name: "Estimate for Alpha" }).fill("42.5");
    await database.getByRole("combobox", { name: "Status for Alpha" }).selectOption({
      label: "Active",
    });
    await database.getByLabel("Due for Alpha").fill("2028-02-29");
    await database.getByRole("checkbox", { name: "Ready for Alpha" }).check();
    if (betaId === null) throw new Error("Related record identity missing");
    await database.getByRole("listbox", { name: "Related for Alpha" }).selectOption(betaId);

    await database.getByRole("button", { name: "Remove property Notes" }).click();
    await expect(database.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);
    await savePageAndSynchronize(page);
    page.once("dialog", (dialog) => dialog.accept(renamedPageName));
    await page.getByRole("button", { name: `Rename ${pageName}` }).click();
    await page.getByRole("button", { name: `Move selected item into ${folderName}` }).click();

    await page.reload();
    await openWorkspace(page);
    await selectItem(page, renamedPageName);
    const reloaded = page.getByTestId("database-block");
    await expect(reloaded).toHaveAttribute("data-database-id", databaseId ?? "");
    await expect(reloaded.locator(`tr[data-record-id="${alphaId}"]`)).toBeVisible();
    await expect(reloaded.getByRole("spinbutton", { name: "Estimate for Alpha" })).toHaveValue(
      "42.5",
    );
    await expect(reloaded.getByRole("combobox", { name: "Status for Alpha" })).toHaveValue(/.+/);
    await expect(reloaded.getByLabel("Due for Alpha")).toHaveValue("2028-02-29");
    await expect(reloaded.getByRole("checkbox", { name: "Ready for Alpha" })).toBeChecked();
    await expect(reloaded.getByRole("listbox", { name: "Related for Alpha" })).toHaveValues([
      betaId ?? "",
    ]);
    await reloaded.getByRole("textbox", { name: "Record title Beta" }).fill("Beta renamed");
    await expect(
      reloaded.getByRole("listbox", { name: "Related for Alpha" }).getByRole("option", {
        name: "Beta renamed",
      }),
    ).toBeVisible();
    await expect(reloaded.getByRole("listbox", { name: "Related for Alpha" })).toHaveValues([
      betaId ?? "",
    ]);
    await reloaded.getByRole("button", { name: "Remove record Beta renamed" }).click();
    await expect(
      reloaded.getByRole("listbox", { name: "Related for Alpha" }).getByRole("option", {
        name: /Unavailable record/,
      }),
    ).toBeVisible();
    await expect(reloaded.getByRole("listbox", { name: "Related for Alpha" })).toHaveValues([
      betaId ?? "",
    ]);

    await reloaded.getByRole("button", { name: "Gallery" }).click();
    await reloaded.getByRole("button", { name: "Open record Alpha" }).click();
    await expect(reloaded.getByRole("region", { name: "Record editor Alpha" })).toBeFocused();
    const axe = await new AxeBuilder({ page }).include(".database-block").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
    await attachReviewScreenshot(page, testInfo, "database-edit");
  });
});
