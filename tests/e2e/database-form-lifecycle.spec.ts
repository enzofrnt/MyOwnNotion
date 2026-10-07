import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  createDatabaseEntry,
  createDatabaseView,
  createRootDatabase,
  entryTrigger,
  openSecondDevice,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

test("converts a card without editorial history locally while workspace requests are held", async ({
  page,
}) => {
  await openWorkspace(page);
  const source = uniqueName("Local conversion source");
  const title = uniqueName("Never opened card");
  await createRootDatabase(page, source);
  await page.getByRole("button", { name: "Ajouter une propriété", exact: true }).click();
  const property = page.getByRole("form", { name: "Éditeur de propriété" });
  await property.getByLabel("Nom", { exact: true }).fill("Status");
  await property.locator('select[name="property-type"]').selectOption("select");
  await property.getByRole("button", { name: "Enregistrer la propriété" }).click();
  await expect(property).toBeHidden();
  await waitForDatabaseDefinitionSaved(page);
  await page.keyboard.press("Escape");
  await createDatabaseEntry(page, title);
  await waitForSynchronized(page);
  await createDatabaseView(page, "Kanban");
  await waitForSynchronized(page);
  const card = page.locator(".database-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Modifier ${title}`, exact: true }).click();
  const kind = card.getByRole("group", { name: "Type d’élément", exact: true });
  let release!: () => void;
  const networkGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workspaceRequests = /\/v1\/(?:changes\?|mutations\/batch)/;
  let held = 0;
  await page.route(workspaceRequests, async (route) => {
    held += 1;
    await networkGate;
    await route.continue();
  });
  try {
    await kind.getByRole("button", { name: "Dossier", exact: true }).click();
    await expect(kind.getByRole("button", { name: "Dossier", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 1_500 },
    );
    await expect(kind).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect.poll(() => held).toBeGreaterThan(0);
  } finally {
    release();
    // Let held handlers finish before removing interception; otherwise an
    // already resumed route can be continued twice during cleanup.
    await page.unrouteAll({ behavior: "wait" });
  }
  await waitForSynchronized(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await kind.getByRole("button", { name: "Page", exact: true }).click();
  await expect(kind.getByRole("button", { name: "Page", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(kind).not.toHaveAttribute("aria-busy", "true");
  await waitForSynchronized(page);
  await page.reload();
  await card.getByRole("button", { name: `Modifier ${title}`, exact: true }).click();
  await expect(kind.getByRole("button", { name: "Page", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("keeps conversion confirmation immediate and returns to the card without a pointer selection outline", async ({
  page,
  isMobile,
}, testInfo) => {
  test.slow();
  await openWorkspace(page);
  const source = uniqueName("Conversion source");
  const title = uniqueName("Protected card");
  await createRootDatabase(page, source);
  await page.getByRole("button", { name: "Ajouter une propriété", exact: true }).click();
  const property = page.getByRole("form", { name: "Éditeur de propriété" });
  await property.getByLabel("Nom", { exact: true }).fill("Status");
  await property.locator('select[name="property-type"]').selectOption("select");
  await property.getByRole("button", { name: "Enregistrer la propriété" }).click();
  await expect(property).toBeHidden();
  await waitForDatabaseDefinitionSaved(page);
  await page.keyboard.press("Escape");
  const sourceUrl = page.url();
  const entry = await createDatabaseEntry(page, title);
  await waitForSynchronized(page);
  await entry.click();
  await page.getByRole("button", { name: "Ouvrir en pleine page", exact: true }).click();
  await typeIntoEditor(page, "Keep this content when cancelling conversion.");
  await saveDocument(page, { until: "synced" });
  await page.goto(sourceUrl);
  await createDatabaseView(page, "Kanban");
  const card = page.locator(".database-card").filter({ hasText: title });
  await card.getByRole("button", { name: `Modifier ${title}`, exact: true }).click();
  const kind = card.getByRole("group", { name: "Type d’élément", exact: true });
  const folder = kind.getByRole("button", { name: "Dossier", exact: true });
  await folder.click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  // A known destructive change asks before starting a conversion or disabling
  // its switch. The canonical command still checks the latest content later.
  await expect(kind).not.toHaveAttribute("aria-busy", "true");
  await expect(kind.getByRole("button", { name: "Page", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(kind).toBeVisible();
  await expect(kind).toHaveAttribute("data-quiet-return-focus", "true");
  if (!isMobile) await expect(folder).toBeFocused();
  expect(await folder.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  await kind.screenshot({ path: testInfo.outputPath("conversion-cancel-pointer.png") });

  if (!isMobile) {
    await folder.press("Enter");
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(folder).toBeFocused();
    await expect(kind).not.toHaveAttribute("data-quiet-return-focus", "true");
    expect(await folder.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await folder.click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(kind).toBeVisible();
  expect(await folder.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByTestId("block-editor").filter({ visible: true })).toContainText(
    "Keep this content when cancelling conversion.",
  );
});

test("cancels a pressed property action outside its button and activates exactly once from the keyboard", async ({
  page,
}) => {
  await openWorkspace(page);
  const databaseName = uniqueName("Interaction lifecycle");
  await createRootDatabase(page, databaseName);
  await waitForSynchronized(page);
  await page.getByRole("button", { name: "Ajouter une propriété" }).click();
  const form = page.getByRole("form", { name: "Éditeur de propriété" });
  const name = uniqueName("Owner draft");
  await form.getByLabel("Nom", { exact: true }).fill(name);
  const save = form.getByRole("button", { name: "Enregistrer la propriété" });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  if (box === null) throw new Error("Missing save target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Holding the button must not persist anything, even if the server can respond.
  await expect(form).toBeVisible();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Nom", { exact: true })).toHaveValue(name);
  await expect(page.locator(".database-schema").getByText(name, { exact: true })).toHaveCount(0);
  await save.focus();
  await page.keyboard.press("Space");
  await expect(form).toBeHidden();
  await waitForDatabaseDefinitionSaved(page);
  await expect(page.locator(".database-schema").getByText(name, { exact: true })).toHaveCount(1);
});

test("preserves a composing dirty field while another device updates an untouched property", async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  await openWorkspace(page);
  const databaseName = uniqueName("Draft synchronization");
  const entryName = uniqueName("Current entry");
  await createRootDatabase(page, databaseName);
  await waitForSynchronized(page);
  for (const name of ["Notes", "Shared"]) await addDatabaseProperty(page, name, "text");

  // A wide empty table must already own a horizontal scroll extent; no
  // placeholder row should be needed to reach its property commands.
  const body = page.locator(".database-table-scroll[data-page-flow] .database-table-body-scroll");
  await expect(body.locator("tbody tr")).toHaveCount(0);
  const empty = await body.evaluate((rail) => {
    const table = rail.querySelector("table");
    if (table === null) throw new Error("Missing empty database table");
    const bounds = table.getBoundingClientRect();
    return {
      rows: table.querySelectorAll("tbody tr").length,
      railHeight: rail.getBoundingClientRect().height,
      width: bounds.width,
      viewportWidth: rail.clientWidth,
      range: rail.scrollWidth - rail.clientWidth,
    };
  });
  expect(empty.rows).toBe(0);
  expect(empty.railHeight).toBeGreaterThan(0);
  if (empty.width > empty.viewportWidth) expect(empty.range).toBeGreaterThan(0);

  const entry = await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  await entry.click();
  const second = await test.step("Authorize a second browser device", () =>
    openSecondDevice(browser, baseURL));
  try {
    await second.page.goto(baseURL ?? "http://127.0.0.1:5873");
    await openWorkspace(second.page);
    await selectItem(second.page, databaseName);
    await entryTrigger(second.page, entryName).first().click();
    const local = page.locator(".entry-panel");
    const remote = second.page.locator(".entry-panel");
    const notes = local.getByLabel("Notes", { exact: true });
    await expect(remote.getByLabel("Shared", { exact: true })).toBeVisible();
    await notes.focus();
    await notes.dispatchEvent("compositionstart", { data: "" });
    await notes.fill("日本語の下書き");
    await notes.dispatchEvent("compositionupdate", { data: "日本語の下書き" });
    const original = await notes.elementHandle();
    await remote.getByLabel("Shared", { exact: true }).fill("Updated on another device");
    await waitForEntryAutosave(second.page);
    await waitForSynchronized(second.page);
    await expect(local.getByLabel("Shared", { exact: true })).toHaveValue(
      "Updated on another device",
      { timeout: 15_000 },
    );
    await expect(notes).toHaveValue("日本語の下書き");
    expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
    await notes.dispatchEvent("compositionend", { data: "日本語の下書き" });
    await waitForEntryAutosave(page);
    await waitForSynchronized(page);
    await expect(remote.getByLabel("Notes", { exact: true })).toHaveValue("日本語の下書き", {
      timeout: 15_000,
    });
  } finally {
    await second.context.close();
  }
});
