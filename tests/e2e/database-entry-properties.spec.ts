import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  chooseEntryOptions,
  createDatabaseEntry,
  createRootDatabase,
  entryTrigger,
  openWorkspace,
  uniqueName,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

test("configures entry properties directly, shares symbols, and preserves independent property order", async ({
  page,
}, testInfo) => {
  test.slow();
  await openWorkspace(page);
  const database = uniqueName("Property interactions");
  const entry = uniqueName("Canonical entry");
  await createRootDatabase(page, database);
  await addDatabaseProperty(page, "Notes", "text");
  await addDatabaseProperty(page, "Team", "multi-select", [
    "Long option for the application team",
    "Research",
  ]);
  await addDatabaseProperty(page, "Estimate", "number");
  const originalColumns = await page
    .locator(".database-grid th .database-column-label__name")
    .allTextContents();
  await (await createDatabaseEntry(page, entry)).click();
  const label = page.getByRole("button", { name: "Modifier la propriété Notes", exact: true });
  await label.click();
  const config = page.locator(".property-settings");
  await expect(config).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Renommer", exact: true })).toHaveCount(0);
  const propertyName = config.getByLabel("Nom de la propriété");
  await expect(propertyName).toBeFocused();
  await propertyName.fill("Brief");
  await expect(propertyName).toHaveValue("Brief");
  await propertyName.press("Enter");
  const briefLabel = page.getByRole("button", { name: "Modifier la propriété Brief", exact: true });
  await expect(briefLabel).toBeVisible();
  await waitForSynchronized(page);
  await page.keyboard.press("Escape");
  await briefLabel.click({ button: "right" });
  await expect(config).toBeVisible();
  await config.getByRole("button", { name: "Changer l’icône de Brief", exact: true }).click();
  const icons = page.getByRole("dialog", { name: "Icône de Brief", exact: true });
  await icons.getByLabel("Filtrer les icônes").fill("étoile");
  await icons.getByRole("option", { name: "étoile", exact: true }).click();
  await expect(briefLabel.locator('[data-icon="star"]')).toBeVisible();
  await waitForSynchronized(page);
  await page.keyboard.press("Escape");
  await briefLabel.focus();
  await briefLabel.press("Shift+F10");
  await expect(config.getByLabel("Nom de la propriété")).toHaveValue("Brief");
  await config.getByRole("button", { name: "Changer l’icône de Brief", exact: true }).click();
  await icons.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(briefLabel.locator('[data-icon="star"]')).toHaveCount(0);
  await waitForSynchronized(page);
  await page.keyboard.press("Escape");

  await chooseEntryOptions(page, "Team", ["Long option for the application team", "Research"]);
  const team = page.locator(".entry-panel").getByRole("button", { name: "Team", exact: true });
  await team.click();
  const choice = page.locator(".entry-choice");
  const inputSurface = choice.locator(".ui-input-surface");
  const search = choice.getByLabel("Rechercher ou créer une option");
  const remove = choice.getByRole("button", {
    name: "Retirer Long option for the application team",
    exact: true,
  });
  await expect(inputSurface).toContainText("Research");
  const geometry = await remove.evaluate((token) => {
    const surface = token.closest(".ui-input-surface")?.getBoundingClientRect();
    const pill = token.querySelector(".option-pill")?.getBoundingClientRect();
    const cross = token.querySelector('[data-icon="close"]')?.getBoundingClientRect();
    const rect = token.getBoundingClientRect();
    const bounds = (value: DOMRect | undefined) =>
      value === undefined ? undefined : { left: value.left, right: value.right };
    return {
      surface: bounds(surface),
      pill: bounds(pill),
      cross: bounds(cross),
      rect: { left: rect.left, right: rect.right },
    };
  });
  expect(geometry.surface).toBeDefined();
  expect(geometry.pill).toBeDefined();
  expect(geometry.cross).toBeDefined();
  if (geometry.surface === undefined || geometry.pill === undefined || geometry.cross === undefined)
    throw new Error("Incomplete composite input");
  expect(geometry.rect.left).toBeGreaterThanOrEqual(geometry.surface.left);
  expect(geometry.rect.right).toBeLessThanOrEqual(geometry.surface.right + 1);
  expect(geometry.cross.right).toBeLessThanOrEqual(geometry.pill.right);
  await remove.click();
  await expect(search).toBeFocused();
  await expect(choice.locator(".entry-choice__token")).toHaveCount(1);
  await expect(choice.locator(".entry-choice__token")).toContainText("Research");
  await search.fill("Res");
  await expect(choice.getByRole("button", { name: "Research", exact: true })).toBeVisible();
  await choice.screenshot({ path: testInfo.outputPath("composite-property-input.png") });
  await testInfo.attach("composite-property-input", {
    path: testInfo.outputPath("composite-property-input.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await waitForEntryAutosave(page);

  const rows = page.locator(".entry-ordinary-properties [data-property-id]");
  const orderBefore = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-property-id")),
  );
  expect(orderBefore).toHaveLength(3);
  const handle = page.getByRole("button", { name: "Déplacer Brief", exact: true });
  const dragAnnouncement = page.locator('.entry-panel [id^="DndLiveRegion-"]');
  const startKeyboardDrag = async () => {
    await handle.press("Space");
    await expect(rows.first()).toHaveAttribute("data-dragging", "true");
    // KeyboardSensor queues its key listener after onDragStart. Drain that
    // browser task before the next key, even when the row is already active.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  };
  await handle.focus();
  await startKeyboardDrag();
  await handle.press("ArrowDown");
  await expect
    .poll(() =>
      rows.first().evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42),
    )
    .toBeGreaterThan(0);
  await expect(rows.nth(1)).toHaveAttribute("data-preview", "after");
  await expect(dragAnnouncement).toHaveText("Après Team.");
  await handle.press("Escape");
  await expect(rows.first()).not.toHaveAttribute("data-dragging", "true");
  await expect(page.locator(".entry-ordinary-properties [data-preview]")).toHaveCount(0);
  await expect
    .poll(() =>
      rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-property-id"))),
    )
    .toEqual(orderBefore);
  await startKeyboardDrag();
  await handle.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-preview", "after");
  await expect(dragAnnouncement).toHaveText("Après Team.");
  await handle.press("Space");
  await expect
    .poll(() =>
      rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-property-id"))),
    )
    .toEqual([orderBefore[1], orderBefore[0], orderBefore[2]]);
  await waitForSynchronized(page);
  await page
    .locator(".entry-panel")
    .screenshot({ path: testInfo.outputPath("ordered-entry-properties.png") });
  await testInfo.attach("ordered-entry-properties", {
    path: testInfo.outputPath("ordered-entry-properties.png"),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
  await expect
    .poll(() => page.locator(".database-grid th .database-column-label__name").allTextContents())
    .toEqual(originalColumns.map((name) => (name === "Notes" ? "Brief" : name)));
  await page.reload();
  await openWorkspace(page);
  await entryTrigger(page, entry).click();
  await expect
    .poll(() =>
      rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-property-id"))),
    )
    .toEqual([orderBefore[1], orderBefore[0], orderBefore[2]]);
  await expect(team).toContainText("Research");
  await expect(team).not.toContainText("Long option for the application team");
});
