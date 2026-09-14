/**
 * End-to-end contract for feature 022: open tabs, measured breadcrumbs and
 * the folder canvas all describe the same canonical hierarchy.
 */

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures.ts";
import {
  clickItemAction,
  closeMobileNavigation,
  convertItem,
  createChildItem,
  createRootItem,
  ensureNavigationRowVisible,
  expectNoHorizontalOverflow,
  expectTreeOrder,
  openSecondDevice,
  openWorkspace,
  renameItem,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("keeps tabs, a deep path and folder ordering coherent at desktop and phone widths", async ({
  baseURL,
  browser,
  page,
  isMobile,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1024, height: 800 });
  await openWorkspace(page);

  const root = uniqueName("Dossier principal long");
  const first = uniqueName("Première note du dossier");
  const second = uniqueName("Deuxième note du dossier");
  const database = uniqueName("Suivi structuré du dossier");
  const levelOne = uniqueName("Études et références longues");
  const levelTwo = uniqueName("Archives de conception longues");
  const levelThree = uniqueName("Décisions intermédiaires longues");
  const levelFour = uniqueName("Détails de réalisation longs");
  const leaf = uniqueName("Page finale avec un titre long");

  await createRootItem(page, "folder", root);
  await createChildItem(page, root, "page", first);
  const firstId = await page.getByTestId(`tree-item-${first}`).getAttribute("data-item-id");
  expect(firstId).not.toBeNull();

  await createChildItem(page, root, "page", second);
  const secondId = await page.getByTestId(`tree-item-${second}`).getAttribute("data-item-id");
  expect(secondId).not.toBeNull();

  await clickItemAction(page, root, `new-database-inside-${root}`);
  const databaseCreation = page.getByRole("form", { name: "Créer une base de données" });
  await databaseCreation.getByLabel("Créer une base de données").fill(database);
  await databaseCreation.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(database);

  await createChildItem(page, root, "folder", levelOne);
  await createChildItem(page, levelOne, "folder", levelTwo);
  await createChildItem(page, levelTwo, "folder", levelThree);
  await createChildItem(page, levelThree, "folder", levelFour);
  await createChildItem(page, levelFour, "page", leaf);
  await waitForSynchronized(page);

  const strip = page.getByTestId("open-tabs");
  await expect(strip.getByRole("button", { name: leaf, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(strip.getByRole("button", { name: first, exact: true })).toHaveCount(1);
  await expect(strip.getByRole("button", { name: second, exact: true })).toHaveCount(1);
  await expect(strip.getByRole("button", { name: root, exact: true })).toHaveCount(1);

  // Reopening existing destinations activates their existing tabs rather than
  // duplicating them, regardless of their depth in the tree.
  const firstTab = strip.getByRole("button", { name: first, exact: true });
  await firstTab.click();
  await expect(firstTab).toHaveAttribute("aria-current", "page");
  const leafTab = strip.getByRole("button", { name: leaf, exact: true });
  await leafTab.click();
  await expect(leafTab).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(firstTab).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(leafTab).toHaveAttribute("aria-current", "page");
  await page.reload();
  await openWorkspace(page);
  await expect(leafTab).toHaveAttribute("aria-current", "page");
  await expect(firstTab).toHaveCount(1);

  const renamedLeaf = `${leaf} renommée`;
  await renameItem(page, leaf, renamedLeaf);
  const renamedLeafTab = strip.getByRole("button", { name: renamedLeaf, exact: true });
  await expect(renamedLeafTab).toHaveAttribute("aria-current", "page");
  await waitForSynchronized(page);

  await page.getByTestId("workspace-page-canvas").getByTestId("item-icon-picker-trigger").click();
  const picker = page.getByTestId("emoji-picker-panel");
  const emojiSearch = picker.locator('em-emoji-picker input[type="search"]');
  await emojiSearch.focus();
  await emojiSearch.fill("pushpin");
  await picker.getByRole("button", { name: "📌", exact: true }).click();
  await expect(renamedLeafTab.locator('[data-item-emoji="true"]')).toHaveText("📌");
  await waitForSynchronized(page);

  await convertItem(page, renamedLeaf);
  await expect(page.getByTestId(`tree-item-${renamedLeaf}`)).toHaveAttribute(
    "data-item-kind",
    "folder",
  );
  await expect(renamedLeafTab.locator('[data-item-kind-badge="folder"]')).toBeVisible();
  await waitForSynchronized(page);

  const path = page.getByTestId("page-path");
  await expect(path).toHaveAttribute("data-truncated", "true");
  const ellipsis = page.getByTestId("page-path-ellipsis");
  await expect(ellipsis).toBeVisible();
  await ellipsis.focus();
  await ellipsis.press("Enter");
  const hiddenLocations = page.getByRole("menu", {
    name: "Afficher les emplacements intermédiaires",
  });
  await expect(hiddenLocations).toBeVisible();
  const hiddenLabels = (await hiddenLocations.getByRole("menuitem").allTextContents()).map(
    (label) => label.trim(),
  );
  const ancestors = [root, levelOne, levelTwo, levelThree, levelFour];
  expect(hiddenLabels.length).toBeGreaterThan(0);
  expect(hiddenLabels.every((label) => ancestors.includes(label))).toBe(true);
  expect(hiddenLabels.map((label) => ancestors.indexOf(label))).toEqual(
    hiddenLabels.map((label) => ancestors.indexOf(label)).toSorted((left, right) => left - right),
  );
  await page.keyboard.press("Escape");

  await strip.getByRole("button", { name: root, exact: true }).click();
  const folderCanvas = page.getByTestId("workspace-folder-canvas");
  await expect(folderCanvas).toBeVisible();
  await expect(folderCanvas.getByTestId("folder-children")).toBeVisible();
  await expect(folderCanvas.locator(".ProseMirror")).toHaveCount(0);
  const databaseRow = folderCanvas.getByTestId("folder-child").filter({ hasText: database });
  await expect(databaseRow).toContainText("Base de données");
  await expect(databaseRow.locator('[data-icon="table"]')).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="open-tabs"], [data-testid="workspace-folder-canvas"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ help, id }) => `${id}: ${help}`),
  ).toEqual([]);

  const secondRow = folderCanvas.locator(
    `[data-testid="folder-child"][data-item-id="${secondId as string}"]`,
  );
  const secondMenu = secondRow.getByTestId("folder-child-menu");
  if (isMobile === true) {
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(folderCanvas).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const deepRow = await ensureNavigationRowVisible(page, renamedLeaf);
    const deepMenu = deepRow.getByTestId(`item-actions-${renamedLeaf}`);
    await deepMenu.scrollIntoViewIfNeeded();
    await expect(deepMenu).toBeInViewport();
    const deepMenuBox = await deepMenu.boundingBox();
    expect(deepMenuBox).not.toBeNull();
    expect(deepMenuBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(deepMenuBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((deepMenuBox?.x ?? 0) + (deepMenuBox?.width ?? 0)).toBeLessThanOrEqual(320);
    await deepMenu.tap();
    await expect(page.getByRole("menu", { name: `Actions pour ${renamedLeaf}` })).toBeVisible();
    await page.keyboard.press("Escape");
    await closeMobileNavigation(page);
    await expect(folderCanvas).toBeVisible();
    const touchHandle = await secondRow
      .getByRole("button", { name: `Déplacer ${second}`, exact: true })
      .boundingBox();
    expect(touchHandle).not.toBeNull();
    expect(touchHandle?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(touchHandle?.height ?? 0).toBeGreaterThanOrEqual(44);
    await secondMenu.tap();
  } else {
    await secondMenu.click();
  }
  const childActions = page.getByRole("menu", { name: `Actions pour ${second}` });
  const moveUp = childActions.getByRole("menuitem", { name: "Monter", exact: true });
  await expect(moveUp).toBeVisible();
  if (isMobile === true) {
    await moveUp.tap();
  } else {
    await moveUp.click();
  }
  await expect
    .poll(async () =>
      folderCanvas
        .getByTestId("folder-child")
        .evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getAttribute("data-item-id"))),
    )
    .toEqual([secondId, firstId]);
  await expectTreeOrder(page, second, first);
  await waitForSynchronized(page);

  if (isMobile === true) {
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(folderCanvas).toBeVisible();
  }

  // The sortable handle exposes the dnd-kit keyboard sensor on every profile.
  // Space lifts/drops the child and ArrowUp selects the same "before" intent.
  const firstHandle = folderCanvas.getByRole("button", { name: `Déplacer ${first}`, exact: true });
  const firstRow = folderCanvas.locator(
    `[data-testid="folder-child"][data-item-id="${firstId as string}"]`,
  );
  await firstHandle.focus();
  await expect(firstHandle).toBeFocused();
  await page.keyboard.down("Space");
  await expect(firstRow).toHaveAttribute("data-dragging", "true");
  await page.keyboard.up("Space");
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () =>
      firstRow.evaluate((row) => {
        const transform = row.style.transform;
        return transform === "" || /translate3d\(0px,\s*0px/.test(transform) ? null : transform;
      }),
    )
    .not.toBeNull();
  await page.keyboard.down("Space");
  await expect(firstRow).not.toHaveAttribute("data-dragging", "true");
  await page.keyboard.up("Space");
  await expect
    .poll(async () =>
      folderCanvas
        .getByTestId("folder-child")
        .evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getAttribute("data-item-id"))),
    )
    .toEqual([firstId, secondId]);
  await expectTreeOrder(page, first, second);
  await waitForSynchronized(page);

  // Fine-pointer profiles exercise the actual drag sensor as well as the
  // touch alternative above. Both paths emit the same placement command.
  if (isMobile !== true) {
    const source = folderCanvas.getByRole("button", { name: `Déplacer ${second}`, exact: true });
    const sourceRow = folderCanvas.locator(
      `[data-testid="folder-child"][data-item-id="${secondId as string}"]`,
    );
    const target = folderCanvas.locator(
      `[data-testid="folder-child"][data-item-id="${firstId as string}"]`,
    );
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (sourceBox !== null && targetBox !== null) {
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        sourceBox.x + sourceBox.width / 2,
        sourceBox.y + sourceBox.height / 2 - 8,
        { steps: 2 },
      );
      await expect(sourceRow).toHaveAttribute("data-dragging", "true");
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
        steps: 8,
      });
      await expect
        .poll(async () => (await sourceRow.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
        .toBeLessThan(targetBox.y + targetBox.height / 2);
      await page.mouse.up();
    }
    await expect
      .poll(async () =>
        folderCanvas
          .getByTestId("folder-child")
          .evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getAttribute("data-item-id"))),
      )
      .toEqual([secondId, firstId]);
    await expectTreeOrder(page, second, first);
    await waitForSynchronized(page);
  }

  const expectedRemoteOrder = isMobile === true ? [first, second] : [second, first];
  const verifier = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(verifier.page);
    await selectItem(verifier.page, root);
    const remoteFolder = verifier.page.getByTestId("workspace-folder-canvas");
    await expect(remoteFolder).toBeVisible();
    await expect
      .poll(async () =>
        remoteFolder
          .getByTestId("folder-child")
          .locator(".folder-children__name")
          .evaluateAll((names) => names.slice(0, 2).map((name) => name.textContent?.trim())),
      )
      .toEqual(expectedRemoteOrder);
  } finally {
    await verifier.context.close();
  }

  // Close controls are native keyboard buttons. Closing a background tab must
  // preserve the active folder; closing the active one selects its neighbour.
  const closeFirst = strip.getByRole("button", {
    name: `Fermer l’onglet ${first}`,
    exact: true,
  });
  await closeFirst.focus();
  await closeFirst.press("Enter");
  await expect(strip.getByRole("button", { name: first, exact: true })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: root, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(strip.getByRole("button", { name: root, exact: true })).toBeFocused();

  const closeRoot = strip.getByRole("button", {
    name: `Fermer l’onglet ${root}`,
    exact: true,
  });
  await closeRoot.focus();
  await closeRoot.press("Space");
  await expect(strip.getByRole("button", { name: root, exact: true })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: second, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(strip.getByRole("button", { name: second, exact: true })).toBeFocused();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(strip).toBeVisible();
    const tabGeometry = await strip.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rows: new Set(
        Array.from(element.querySelectorAll('[data-testid="open-tab"]')).map((tab) =>
          Math.round(tab.getBoundingClientRect().top),
        ),
      ).size,
    }));
    expect(tabGeometry.scrollWidth).toBeGreaterThan(tabGeometry.clientWidth);
    expect(tabGeometry.rows).toBe(1);
    const remainingCloseTarget = await strip
      .getByRole("button", { name: `Fermer l’onglet ${second}`, exact: true })
      .boundingBox();
    expect(remainingCloseTarget).not.toBeNull();
    expect(remainingCloseTarget?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(remainingCloseTarget?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  }

  const tabsBeforeShortcut = await strip
    .locator("[data-open-tab-activate]")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute("data-tab-id"),
        active: button.getAttribute("aria-current") === "page",
      })),
    );
  const activeIndex = tabsBeforeShortcut.findIndex(({ active }) => active);
  const shortcutNeighbour =
    tabsBeforeShortcut[activeIndex + 1]?.id ?? tabsBeforeShortcut[activeIndex - 1]?.id ?? null;
  expect(shortcutNeighbour).not.toBeNull();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(strip.getByRole("button", { name: second, exact: true })).toHaveCount(0);
  const focusedNeighbour = strip.locator(
    `[data-open-tab-activate][data-tab-id="${shortcutNeighbour as string}"]`,
  );
  await expect(focusedNeighbour).toHaveAttribute("aria-current", "page");
  await expect(focusedNeighbour).toBeFocused();
});
