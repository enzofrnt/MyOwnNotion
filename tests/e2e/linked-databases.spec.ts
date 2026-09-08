import { generateUuidV7 } from "@myownnotion/domain";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  closeMobileNavigation,
  createDatabaseEntry,
  createRootItem,
  createUnopenedPage,
  expectNoHorizontalOverflow,
  openSecondDevice,
  openWorkspace,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

test("keeps entry activation and cancellation intact while another device updates a column", async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  await openWorkspace(page);
  const hostName = uniqueName("Stable entry host");
  const entryName = uniqueName("Stable entry");
  await createRootItem(page, "page", hostName);
  await page.getByRole("button", { name: "Ajouter une base", exact: true }).click();
  await page.getByLabel("Nouvelle base", { exact: true }).fill(uniqueName("Stable source"));
  await page.getByRole("button", { name: "Créer et insérer", exact: true }).click();
  await expect(page.locator(".database-grid")).toBeVisible();
  await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await selectItem(second.page, hostName);
    await closeMobileNavigation(second.page);
    await closeMobileNavigation(page);
    for (const [width, cancel] of [
      [280, false],
      [300, true],
    ] as const) {
      const trigger = page.locator("[data-entry-trigger]").filter({ hasText: entryName }).first();
      await trigger.click({ trial: true });
      const original = await trigger.elementHandle();
      const box = await trigger.boundingBox();
      if (original === null || box === null) throw new Error("Missing visible entry trigger");
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const pointerStillHitsTrigger = () =>
        trigger.evaluate(
          (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
          point,
        );
      expect(await pointerStillHitsTrigger()).toBe(true);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      // A second physical click would share Firefox’s virtual mouse with the
      // held pointer. Activate the other device semantically instead.
      await second.page
        .getByRole("button", { name: "Augmenter la largeur de Titre", exact: true })
        .evaluate((element) => (element as HTMLButtonElement).click());
      await waitForDatabaseDefinitionSaved(second.page);
      await expect(
        page.getByRole("group", { name: `Largeur de Titre : ${width} pixels`, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".database-pagination")).toBeVisible();
      expect(await original.evaluate((element) => element.isConnected)).toBe(true);
      expect(await trigger.evaluate((element, previous) => element === previous, original)).toBe(
        true,
      );
      expect(await pointerStillHitsTrigger()).toBe(true);
      await expect(page.locator(".entry-panel")).toHaveCount(0);
      if (cancel) {
        await page.mouse.move(1, 1);
        await page.mouse.up();
        await expect(page.locator(".entry-panel")).toHaveCount(0);
        await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
      } else {
        await page.mouse.up();
        await expect(
          page.locator(".entry-panel").getByRole("heading", { name: entryName }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
        await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
      }
      await original.dispose();
    }
    for (const key of ["Enter", "Space"]) {
      const trigger = page.locator("[data-entry-trigger]").filter({ hasText: entryName }).first();
      await trigger.focus();
      await page.keyboard.press(key);
      await expect(
        page.locator(".entry-panel").getByRole("heading", { name: entryName }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
      await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
    }
  } finally {
    await page.mouse.up();
    await second.context.close();
  }
});

test("embeds one source in ordinary pages with independent views and shared canonical entries", async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  await openWorkspace(page);
  const first = uniqueName("Planning page");
  const second = uniqueName("Projects page");
  const sourceName = uniqueName("Shared projects");
  const entryName = uniqueName("Canonical entry");
  await createRootItem(page, "page", first);
  await typeIntoEditor(page, "Editorial text beside the shared database");
  await page.getByRole("button", { name: "Ajouter une base", exact: true }).click();
  await page.getByLabel("Nouvelle base", { exact: true }).fill(sourceName);
  await page.getByRole("button", { name: "Créer et insérer", exact: true }).click();
  await expect(page.locator(".database-embedding")).toHaveCount(1);
  await expect(page.locator(".database-grid")).toBeVisible();
  for (const [name, type] of [
    ["Status", "status"],
    ["Due", "date"],
  ]) {
    await page.getByRole("button", { name: "Ajouter une propriété" }).click();
    const editor = page.getByRole("form", { name: "Éditeur de propriété" });
    await editor.getByLabel("Nom", { exact: true }).fill(name ?? "");
    await editor.getByLabel("Type", { exact: true }).selectOption(type ?? "text");
    if (type === "status")
      await editor.getByLabel("Options séparées par des virgules").fill("Planned, Done");
    await editor.getByRole("button", { name: "Enregistrer la propriété" }).click();
    await expect(
      page.locator(".database-schema").getByText(name ?? "", { exact: true }),
    ).toBeVisible();
    await waitForDatabaseDefinitionSaved(page);
  }
  await createDatabaseEntry(page, entryName);
  await waitForSynchronized(page);
  const identity = await page
    .locator("[data-entry-trigger]")
    .first()
    .getAttribute("data-entry-trigger");
  await createRootItem(page, "page", second);
  await page.getByRole("button", { name: "Ajouter une base", exact: true }).click();
  await page.getByLabel("Base existante", { exact: true }).selectOption({ label: sourceName });
  await page.getByRole("button", { name: "Insérer cette base", exact: true }).click();
  await expect(page.locator("[data-entry-trigger]").filter({ hasText: entryName })).toBeVisible();
  for (const [button, surface] of [
    ["Nouvelle vue Kanban", ".database-board"],
    ["Nouvelle vue calendrier", ".database-calendar"],
    ["Nouvelle vue galerie", ".database-gallery-scroll"],
    ["Nouvelle vue liste", ".database-list"],
  ]) {
    await page.getByRole("button", { name: button ?? "", exact: true }).click();
    await expect(page.locator(surface ?? "")).toBeVisible();
    await waitForDatabaseDefinitionSaved(page);
  }
  await page.locator("[data-entry-trigger]").filter({ hasText: entryName }).first().click();
  await expect(page.locator(".entry-panel")).toBeVisible();
  await typeIntoEditor(page, "Edited through the linked source");
  await page.locator(".entry-panel").getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(second);
  await expect(page.locator(".database-list")).toBeVisible();
  await page
    .locator(".database-embedding")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath("linked-source-light.png") });
  await selectItem(page, first);
  await expect(page.locator(".database-grid")).toBeVisible();
  await expect(page.locator(".database-view-tabs").getByRole("tab")).toHaveCount(1);
  await expect(page.getByTestId("block-editor")).toContainText(
    "Editorial text beside the shared database",
  );
  const shared = page.locator("[data-entry-trigger]").filter({ hasText: entryName }).first();
  await expect(shared).toHaveAttribute("data-entry-trigger", identity ?? "");
  await shared.click();
  await expect(page.getByTestId("block-editor")).toContainText("Edited through the linked source");
  await page.locator(".entry-panel").getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(first);
  // Canonical entry navigation also works without a display-origin hint.
  await page.goto(`/notes/${identity}`);
  await expect(page.locator(".entry-panel")).toBeVisible();
  await page.locator(".entry-panel").getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(first);
  await waitForSynchronized(page);
  // Keep the static app shell available while the API is unreachable, matching
  // the established database reload journeys; local durability is the subject.
  await context.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await context.route("**/health", (route) => route.abort("connectionrefused"));
  await page.getByRole("button", { name: "Retirer de cette page", exact: true }).click();
  await expect(page.locator(".database-embedding")).toHaveCount(0);
  await page.reload();
  await selectItem(page, first);
  await page.getByRole("button", { name: "Ajouter une base", exact: true }).click();
  await page.getByLabel("Base existante", { exact: true }).selectOption({ label: sourceName });
  await page.getByRole("button", { name: "Insérer cette base", exact: true }).click();
  await expect(page.locator("[data-entry-trigger]").filter({ hasText: entryName })).toBeVisible();
  await context.unroute("**/v1/**");
  await context.unroute("**/health");
  await waitForSynchronized(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => window.localStorage.setItem("myownnotion.theme", "dark"));
  await page.reload();
  await selectItem(page, first);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".database-embedding")).toHaveCount(1);
  await page
    .locator(".database-embedding")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath("linked-source-dark.png") });
  await page.setViewportSize({ width: 320, height: 780 });
  await page.reload();
  await selectItem(page, first);
  await closeMobileNavigation(page);
  await expect(page.locator(".database-embedding")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page
    .locator(".database-embedding")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: testInfo.outputPath("linked-source-narrow.png") });
  await page.locator(".database-pagination").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("linked-source-narrow-entries.png") });
});

test("loads beyond 1000 canonical entries using a visible cursor action", async ({
  page,
  request,
}, testInfo) => {
  // 1001 protected canonical writes are fixture work; UI waits remain bounded.
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const hostName = uniqueName("Large linked source page");
  const host = await createUnopenedPage(request, hostName);
  const sourceId = generateUuidV7();
  const created = await request.post(`${apiOrigin()}/v1/databases`, {
    headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": generateUuidV7() },
    data: {
      id: sourceId,
      name: "Large reusable source",
      hostPageId: host.itemId,
      titlePropertyId: generateUuidV7(),
      initialViewId: generateUuidV7(),
      initialViewName: "Complete title order",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a0" },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  // Seed through the protected canonical batch endpoint, then exercise only
  // the real browser pagination. No SQL bypass or 1001 form submissions.
  const seedStarted = Date.now();
  for (let offset = 0; offset < 1001; offset += 100) {
    const response = await request.post(`${apiOrigin()}/v1/mutations/batch`, {
      headers: CURRENT_PROTOCOL_HEADERS,
      data: {
        mutations: Array.from({ length: Math.min(100, 1001 - offset) }, (_, index) => ({
          mutationId: generateUuidV7(),
          commandType: "database.entry.create",
          baseRevisionIds: [],
          payload: {
            databaseId: sourceId,
            id: generateUuidV7(),
            title: `Entry ${String(offset + index).padStart(4, "0")}`,
            values: {},
            relationTargets: {},
          },
        })),
      },
    });
    const result = await response.json();
    expect(response.status(), JSON.stringify(result)).toBe(200);
    expect(
      result.results.every((entry: { status: string }) => entry.status === "accepted"),
      JSON.stringify(result),
    ).toBe(true);
  }
  const seedMs = Date.now() - seedStarted;
  const openStarted = Date.now();
  await openWorkspace(page);
  await selectItem(page, hostName);
  await expect(page.getByRole("treeitem")).toHaveCount(1);
  const loaded = page.locator(".database-pagination");
  await expect(loaded).toContainText("100 entrées chargées", { timeout: 30_000 });
  const firstPageMs = Date.now() - openStarted;
  await expect(page.locator(".database-view-status")).toContainText(
    "Base disponible · 1001 entrées",
  );
  const nextStarted = Date.now();
  for (let expected = 200; expected <= 1100; expected += 100) {
    await loaded.getByRole("button", { name: "Charger les entrées suivantes" }).click();
    await expect(loaded).toContainText(`${Math.min(expected, 1001)} entrées chargées`, {
      timeout: 30_000,
    });
  }
  await expect(loaded.getByRole("button")).toHaveCount(0);
  const scroller = page.locator(".database-table-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const last = page.locator("[data-entry-trigger]").filter({ hasText: "Entry 1000" });
  await expect(last).toBeVisible();
  const nextPageMs = Date.now() - nextStarted;
  await last.click();
  await expect(page.locator(".entry-panel")).toBeVisible();
  await page.locator(".entry-panel").getByRole("button", { name: "Fermer l'entrée" }).click();
  await expect(loaded).toContainText("1001 entrées chargées", { timeout: 30_000 });
  await expect(last).toBeFocused();
  await testInfo.attach("pagination-timings", {
    body: JSON.stringify({ seedMs, firstPageMs, nextPageMs }),
    contentType: "application/json",
  });
});
