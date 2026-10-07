import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  chooseEntryOptions,
  createDatabaseEntry,
  createDatabaseView,
  createRootDatabase,
  entryTrigger,
  openBoardMoveMenu,
  openWorkspace,
  uniqueName,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

test("multi-select Kanban preserves other memberships across moves, hidden axis, reload and offline", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await openWorkspace(page);
  await createRootDatabase(page, uniqueName("Multi board"));
  await addDatabaseProperty(page, "Matières", "multi-select", ["Alpha", "Beta", "Gamma"]);
  const title = uniqueName("Shared task");
  const trigger = await createDatabaseEntry(page, title);
  await trigger.click();
  await chooseEntryOptions(page, "Matières", ["Alpha", "Beta"]);
  await waitForEntryAutosave(page);
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await createDatabaseView(page, "Kanban");
  const board = page.locator(".database-board-scroll");
  const column = (label: string) => board.getByRole("region", { name: new RegExp(`^${label} ·`) });
  const card = (label: string) =>
    column(label).locator(".database-card").filter({ hasText: title });
  await expect(card("Alpha")).toBeVisible();
  await expect(card("Beta")).toBeAttached();
  const id = await entryTrigger(card("Beta"), title).getAttribute("data-entry-trigger");
  expect(id).not.toBeNull();
  await board.screenshot({ path: testInfo.outputPath("multi-memberships.png") });
  const moveCard = async (origin: string, destination: string, keyboard = false) => {
    const destinationId = await column(destination).getAttribute("data-board-column");
    const menu = await openBoardMoveMenu(page, card(origin), title, keyboard);
    const choice = menu.locator(`[data-board-destination="${destinationId}"]`);
    await expect(choice).toBeEnabled();
    if (keyboard) {
      // Let opening focus settle, then use the menu's actual arrow-key navigation.
      // Forcing focus with locator.press can race initial autofocus on touch engines.
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      for (let i = 0; i < 8; i++) {
        if (await choice.evaluate((node) => node === document.activeElement)) break;
        await page.keyboard.press("ArrowDown");
      }
      await expect(choice).toBeFocused();
      await page.keyboard.press("Enter");
    } else await choice.click();
  };
  const betaMenu = card("Beta").getByRole("button", {
    name: `Actions de ${title}`,
  });
  await openBoardMoveMenu(page, card("Beta"), title, true);
  await expect(page.getByRole("menu")).toContainText("Retirer toutes les sélections");
  await page.getByRole("menu").screenshot({ path: testInfo.outputPath("board-destinations.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(betaMenu).toBeFocused();
  await expect(card("Alpha")).toBeAttached();
  await expect(card("Beta")).toBeAttached();
  await board.getByRole("button", { name: "Replier Alpha", exact: true }).click();
  await expect(card("Alpha")).toHaveCount(0);
  await board.getByRole("button", { name: "Déplier Alpha", exact: true }).click();
  await expect(card("Alpha")).toBeAttached();
  // Opening one occurrence returns to the same column.
  await entryTrigger(card("Beta"), title).click();
  await page.getByRole("button", { name: "Fermer le volet" }).click();
  await expect(entryTrigger(card("Beta"), title)).toBeFocused();

  // Alpha -> Gamma must retain Beta. Selector is available to pointer and touch.
  await moveCard("Alpha", "Gamma");
  await expect(card("Alpha")).toHaveCount(0);
  await expect(card("Beta")).toBeAttached();
  await expect(card("Gamma")).toBeVisible();
  await expect(entryTrigger(card("Gamma"), title)).toHaveAttribute("data-entry-trigger", id ?? "");
  await waitForSynchronized(page);

  if ((testInfo.project.use.viewport?.width ?? 1440) >= 768) {
    const alphaId = await column("Alpha").getAttribute("data-board-column");
    await card("Gamma").scrollIntoViewIfNeeded();
    const sourceBox = await card("Gamma").boundingBox();
    if (sourceBox === null) throw new Error("Missing source geometry");
    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 24, sourceBox.y + 24, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(card("Gamma")).toBeAttached();
    await expect(card("Beta")).toBeAttached();
    await expect(card("Alpha")).toHaveCount(0);
    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 24, sourceBox.y + 24, { steps: 4 });
    // The target shares a horizontal scrollport: scroll after taking the card,
    // so a locator's pre-drag auto-scroll cannot pick another occurrence.
    await board.evaluate((node) => {
      node.scrollLeft = 0;
    });
    const targetBox = await column("Alpha").boundingBox();
    if (targetBox === null) throw new Error("Missing target geometry");
    await page.mouse.move(targetBox.x + 8, targetBox.y + 8, { steps: 6 });
    await page.mouse.move(targetBox.x + 10, targetBox.y + 10);
    await page.mouse.up();
    await expect(card("Gamma")).toHaveCount(0);
    await expect(card("Beta")).toBeAttached();
    await expect(card("Alpha")).toBeVisible();
    await moveCard("Alpha", "Gamma");
    await expect(card("Gamma")).toBeVisible();
    expect(alphaId).not.toBeNull();
  }

  // Gamma -> Beta (already present) removes only Gamma, then keyboard Beta -> Gamma.
  await moveCard("Gamma", "Beta");
  await expect(card("Gamma")).toHaveCount(0);
  await expect(card("Beta")).toBeVisible();
  await moveCard("Beta", "Gamma", true);
  await expect(card("Gamma")).toBeVisible();
  await expect(entryTrigger(card("Gamma"), title)).toBeFocused();

  // Hide the property in settings; the axis remains usable after reload.
  await page.getByRole("button", { name: "Options de la vue", exact: true }).click();
  const settings = page.locator(".database-view-settings");
  await settings.getByRole("button", { name: /Visibilité des propriétés/ }).click();
  const visibility = settings.getByRole("switch", { name: /Matières/ });
  await visibility.click();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await waitForSynchronized(page);
  await page.reload();
  await expect(card("Gamma")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Options de la vue", exact: true }).press("Enter");
  await settings.getByRole("button", { name: /^Grouper/ }).click();
  const grouping = settings.getByRole("button", { name: "Grouper par Matières", exact: true });
  await grouping.press("Enter");
  const groupingMenu = page.getByRole("menu", { name: "Grouper par", exact: true });
  await expect(groupingMenu.getByRole("menuitem", { name: "Matières", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(groupingMenu).toBeHidden();
  await expect(grouping).toBeFocused();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(settings).toBeHidden();
  for (const theme of ["light", "dark"])
    for (const width of [1440, 320]) {
      await page.evaluate((t) => localStorage.setItem("myownnotion.theme", t), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(board).toBeVisible();
      await expect(card("Gamma")).toBeAttached();
      await board.screenshot({ path: testInfo.outputPath(`multi-board-${theme}-${width}.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    }
  await context.setOffline(true);
  try {
    await moveCard("Gamma", "Sans matières");
    await expect(card("Sans matières")).toBeVisible();
    await expect(card("Gamma")).toHaveCount(0);
    await moveCard("Sans matières", "Alpha");
    await expect(card("Alpha")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  await waitForSynchronized(page);
  await page.reload();
  await expect(card("Alpha")).toBeVisible();
});

test("Kanban destination menus expose pending and refused moves without false success", async ({
  page,
}, testInfo) => {
  for (const state of ["pending", "refused"]) {
    await page.goto(`/__ui-lab?review=database&format=board&mutation=${state}`);
    const board = page.locator(".database-board-scroll");
    const source = board
      .locator(".database-card")
      .filter({ hasText: "Préparer la prochaine version" });
    await openBoardMoveMenu(page, source, "Préparer la prochaine version");
    await page.getByRole("menuitem", { name: "Terminé", exact: true }).click();
    await expect(source).toBeAttached();
    if (state === "pending") {
      await expect(source).toHaveAttribute("aria-busy", "true");
      await openBoardMoveMenu(page, source, "Préparer la prochaine version");
      await expect(page.getByRole("menuitem", { name: "Terminé", exact: true })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await page.screenshot({
        path: testInfo.outputPath("board-pending-menu.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    } else {
      const feedback = board.getByRole("status");
      await expect(feedback).toContainText("n'a pas pu être déplacé");
      await expect(feedback).toBeInViewport();
      await expect(feedback).not.toContainText("déplacé vers");
      await openBoardMoveMenu(page, source, "Préparer la prochaine version");
      await expect(page.getByRole("menuitem", { name: "Terminé", exact: true })).toBeEnabled();
      await page.getByRole("menuitem", { name: "Terminé", exact: true }).click();
      await expect(feedback).toContainText("n'a pas pu être déplacé");
      await expect(source).toBeAttached();
      await openBoardMoveMenu(page, source, "Préparer la prochaine version");
      // A full-page mobile capture can temporarily resize the layout viewport;
      // capture after retry so geometry changes cannot steer the pointer action.
      await page.screenshot({
        path: testInfo.outputPath("board-refused-menu.png"),
        fullPage: true,
      });
    }
  }
});
