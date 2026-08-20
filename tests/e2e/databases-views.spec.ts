import { expect, test } from "./fixtures.ts";
import {
  openSecondDevice,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("persists table/list filters, sorts, groups, columns and focus on two browsers", async ({
  page,
  browser,
  baseURL,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Projects views");
  const entries = {
    alpha: uniqueName("Alpha"),
    beta: uniqueName("Beta"),
    gamma: uniqueName("Gamma"),
  };

  await page.getByRole("button", { name: "New root database" }).click();
  const createDatabase = page.getByRole("form", { name: "Create a database" });
  await createDatabase.getByLabel("Create a database").fill(databaseName);
  await createDatabase.getByRole("button", { name: "Create database" }).click();
  await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();

  await page.getByRole("button", { name: "Add property" }).click();
  const propertyEditor = page.getByRole("form", { name: "Property editor" });
  await propertyEditor.getByLabel("Name").fill("Status");
  await propertyEditor.getByLabel("Type").selectOption("status");
  await propertyEditor.getByLabel("Options, separated by commas").fill("To do, Done");
  await propertyEditor.getByRole("button", { name: "Save property" }).click();
  await expect(page.locator(".database-schema").getByText("Status", { exact: true })).toBeVisible();

  const createEntry = async (title: string, status: "To do" | "Done"): Promise<void> => {
    const form = page.locator(".database-entry-create");
    await form.getByLabel("New entry").fill(title);
    await form.getByRole("button", { name: "New entry" }).click();
    const trigger = page.locator(`[data-entry-trigger]`).filter({ hasText: title }).first();
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    const panel = page.locator(".entry-panel");
    await expect(panel).toBeVisible();
    await panel.getByLabel("Status", { exact: true }).selectOption({ label: status });
    await panel.getByRole("button", { name: "Save properties" }).click();
    await waitForSynchronized(page);
    await page.getByRole("button", { name: "Close entry" }).click();
    await expect(page.getByRole("heading", { name: databaseName })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(
      page.locator(`[data-entry-trigger]`).filter({ hasText: title }).first(),
    ).toBeFocused();
  };

  await createEntry(entries.alpha, "To do");
  await createEntry(entries.beta, "Done");
  await createEntry(entries.gamma, "To do");

  const alphaStatus = () =>
    page
      .locator(".database-grid tbody tr")
      .filter({ hasText: entries.alpha })
      .getByRole("gridcell", { name: /Status/ });
  await alphaStatus().focus();
  await alphaStatus().press("F2");
  await alphaStatus().getByLabel("Status", { exact: true }).selectOption({ label: "Done" });
  await alphaStatus()
    .getByRole("button", { name: `Save Status for ${entries.alpha}` })
    .click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, Done");
  await waitForSynchronized(page);
  await alphaStatus().press("F2");
  await alphaStatus().getByLabel("Status", { exact: true }).selectOption({ label: "To do" });
  await alphaStatus()
    .getByRole("button", { name: `Save Status for ${entries.alpha}` })
    .click();
  await expect(alphaStatus()).toHaveAttribute("aria-label", "Status, To do");
  await waitForSynchronized(page);

  const filterEditor = page.locator(".database-rule-editor").filter({ hasText: /^Filters/ });
  await filterEditor.locator("summary").click();
  await filterEditor.getByRole("button", { name: "Add filter" }).click();
  let rules = filterEditor.locator(".database-rule");
  await rules.nth(0).getByLabel("Property").selectOption({ label: "Status" });
  await rules.nth(0).getByLabel("Operator").selectOption("equals");
  await rules.nth(0).getByLabel("Value for Status").selectOption({ label: "To do" });
  await filterEditor.getByRole("button", { name: "Add filter" }).click();
  rules = filterEditor.locator(".database-rule");
  await rules.nth(1).getByLabel("Property").selectOption({ label: "Title" });
  await rules.nth(1).getByLabel("Operator").selectOption("contains");
  await rules.nth(1).getByLabel("Value for Title").fill("Alpha");
  await filterEditor.getByLabel("Filter combination").selectOption("any");
  await filterEditor.getByRole("button", { name: "Save filters" }).click();
  await expect(
    page.locator(`[data-entry-trigger]`).filter({ hasText: entries.gamma }),
  ).toBeVisible();
  await expect(page.locator(`[data-entry-trigger]`).filter({ hasText: entries.beta })).toHaveCount(
    0,
  );

  await filterEditor.getByLabel("Filter combination").selectOption("all");
  await filterEditor.getByRole("button", { name: "Save filters" }).click();
  await expect(
    page.locator(`[data-entry-trigger]`).filter({ hasText: entries.alpha }),
  ).toBeVisible();
  await expect(page.locator(`[data-entry-trigger]`).filter({ hasText: entries.gamma })).toHaveCount(
    0,
  );

  await filterEditor.getByRole("button", { name: "Clear filters" }).click();
  await filterEditor.getByRole("button", { name: "Save filters" }).click();
  await expect(page.locator("[data-entry-trigger]")).toHaveCount(3);

  const sortEditor = page.locator(".database-rule-editor").filter({ hasText: /^Sort & group/ });
  await sortEditor.locator("summary").click();
  await sortEditor.getByRole("button", { name: "Add sort" }).click();
  await sortEditor.getByLabel("Direction").selectOption("descending");
  await sortEditor.getByLabel("Group by").selectOption({ label: "Status" });
  await sortEditor.getByRole("button", { name: "Save sort and group" }).click();
  await expect
    .poll(
      async () =>
        await page
          .locator("[data-entry-trigger]")
          .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
    )
    .toEqual([entries.gamma, entries.beta, entries.alpha]);

  const columns = page.locator(".database-columns");
  await columns.locator("summary").click();
  await columns.getByRole("checkbox", { name: "Status" }).uncheck();
  await expect(
    page.locator(".database-grid").getByRole("columnheader", { name: /Status/ }),
  ).toHaveCount(0);
  await columns.getByRole("checkbox", { name: "Status" }).check();
  await expect(
    page.locator(".database-grid").getByRole("columnheader", { name: /Status/ }),
  ).toBeVisible();
  await columns.getByRole("button", { name: "Move Status column earlier" }).click();
  await expect
    .poll(async () =>
      page
        .locator(".database-grid thead th")
        .evaluateAll((headers) => headers.map((header) => header.textContent?.trim())),
    )
    .toEqual([expect.stringContaining("Status"), expect.stringContaining("Title")]);
  await page.getByRole("button", { name: "Widen Title" }).click();
  await expect(page.getByRole("group", { name: "Title width 280 pixels" })).toBeVisible();

  await page.getByRole("button", { name: "New list view" }).click();
  const listTab = page.getByRole("tab", { name: /List 2/ });
  await expect(listTab).toBeVisible({ timeout: 15_000 });
  await listTab.click();
  await expect(page.locator(".database-list")).toBeVisible();
  await expect(page.locator(".database-list__entry")).toHaveCount(3);
  await page.getByLabel("View name").fill("Planning");
  await page.getByRole("button", { name: "Rename view" }).click();
  await expect(page.getByRole("tab", { name: /Planning/ })).toBeVisible();
  await waitForSynchronized(page);

  await page.reload();
  await expect(page.getByTestId(`tree-item-${databaseName}`)).toBeVisible({ timeout: 15_000 });
  await selectItem(page, databaseName);
  await expect(page.getByRole("tab", { name: /Planning/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".database-list")).toBeVisible();
  await page.getByRole("tab", { name: /Table/ }).click();
  await expect(page.getByRole("group", { name: "Title width 280 pixels" })).toBeVisible();

  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await expect(second.page.getByTestId(`tree-item-${databaseName}`)).toBeVisible({
      timeout: 15_000,
    });
    await selectItem(second.page, databaseName);
    await expect(second.page.getByRole("tab", { name: /Planning/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(second.page.locator("[data-entry-trigger]")).toHaveCount(3);
    await second.page.getByRole("tab", { name: /Planning/ }).click();
    await expect(second.page.locator(".database-list__entry")).toHaveCount(3);
  } finally {
    await second.context.close();
  }
});
