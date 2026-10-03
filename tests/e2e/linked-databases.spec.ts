import { generateUuidV7 } from "@myownnotion/domain";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  closeMobileNavigation,
  createDatabaseEntry,
  createRootDatabase,
  createUnopenedPage,
  ensureNavigationVisible,
  entryTrigger,
  openSecondDevice,
  openWorkspace,
  selectItem,
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
  const hostName = uniqueName("Stable database owner");
  const entryName = uniqueName("Stable entry");
  await createRootDatabase(page, hostName);
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
      const trigger = entryTrigger(page, entryName).first();
      await trigger.click({ trial: true });
      const original = await trigger.elementHandle();
      const box = await trigger.boundingBox();
      if (original === null || box === null) throw new Error("Missing visible entry trigger");
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const pointerHitState = () =>
        trigger.evaluate((element, point) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(point.x, point.y);
          const scroller = element.closest(".workspace-main");
          return {
            hitsTrigger: element.contains(hit),
            scrollTop: scroller?.scrollTop,
            scrollHeight: scroller?.scrollHeight,
            clientHeight: scroller?.clientHeight,
            trigger: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            hit: hit?.outerHTML.slice(0, 160),
            status: document.querySelector(".database-view-status")?.textContent,
            statusHeight: document.querySelector(".database-view-status")?.getBoundingClientRect()
              .height,
            pageHeight: document.querySelector(".database-page")?.getBoundingClientRect().height,
          };
        }, point);
      const beforeHit = await pointerHitState();
      expect(beforeHit.hitsTrigger).toBe(true);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      // A second physical click would share Firefox’s virtual mouse with the
      // held pointer. Activate the other device semantically instead.
      await second.page.getByRole("button", { name: /Largeur de Titre/ }).press("ArrowRight");
      await waitForDatabaseDefinitionSaved(second.page);
      await expect(
        page.getByRole("button", { name: `Largeur de Titre : ${width} pixels`, exact: true }),
      ).toBeVisible();
      expect(await original.evaluate((element) => element.isConnected)).toBe(true);
      expect(await trigger.evaluate((element, previous) => element === previous, original)).toBe(
        true,
      );
      const afterHit = await pointerHitState();
      expect(afterHit.hitsTrigger, JSON.stringify({ beforeHit, afterHit, point })).toBe(true);
      await expect(page.locator(".entry-panel")).toHaveCount(0);
      if (cancel) {
        await page.mouse.move(1, 1);
        await page.mouse.up();
        await expect(page.locator(".entry-panel")).toHaveCount(0);
        await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
      } else {
        await page.mouse.up();
        await expect(page.getByTestId("active-item-title")).toHaveValue(entryName);
        await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
        await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
      }
      await original.dispose();
    }
    for (const key of ["Enter", "Space"]) {
      const trigger = entryTrigger(page, entryName).first();
      await trigger.focus();
      await page.keyboard.press(key);
      await expect(page.getByTestId("active-item-title")).toHaveValue(entryName);
      await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
      await expect(page.getByTestId("active-item-title")).toHaveValue(hostName);
    }
  } finally {
    await page.mouse.up();
    await second.context.close();
  }
});

test("loads beyond 1000 canonical entries using a visible cursor action", async ({
  page,
  request,
}, testInfo) => {
  // 1001 protected canonical writes are fixture work; UI waits remain bounded.
  test.setTimeout(300_000);
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
      placement: { id: generateUuidV7(), parentItemId: host.itemId, positionKey: "a0" },
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
  // A fresh device replays the fixture's paginated change feed before its
  // navigation tree is ready; the standard 15 s boot bound still applies to
  // ordinary workspace journeys.
  await openWorkspace(page, { navigationTimeoutMs: 60_000 });
  await ensureNavigationVisible(page);
  await page.getByRole("button", { name: `Déplier ${hostName}` }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(2);
  await selectItem(page, "Large reusable source");
  const loaded = page.locator(".database-pagination");
  await expect(loaded).toContainText("100 entrées chargées", { timeout: 30_000 });
  const firstPageMs = Date.now() - openStarted;
  await expect(page.locator(".database-view-status")).not.toContainText("Vue partielle");
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
  const last = entryTrigger(page, "Entry 1000");
  await expect(last).toBeVisible();
  const nextPageMs = Date.now() - nextStarted;
  await last.click();
  await expect(page.locator(".entry-panel")).toBeVisible();
  await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue("Large reusable source");
  await expect(loaded).toContainText("1001 entrées chargées", { timeout: 30_000 });
  await expect(last).toBeFocused();
  await expect(last)
    .toBeInViewport({ ratio: 1 })
    .catch(async (error: unknown) => {
      console.error(
        "[table-return] geometry",
        await last.evaluate((element) => {
          const rect = (node: Element | null) => node?.getBoundingClientRect().toJSON();
          const table = element.closest(".database-table-scroll");
          const main = document.querySelector(".workspace-main");
          return {
            target: rect(element),
            row: rect(element.closest("tr")),
            table: rect(table),
            tableScroll: table?.scrollTop,
            tableHeight: table?.scrollHeight,
            main: rect(main),
            mainScroll: main?.scrollTop,
            viewport: window.innerHeight,
          };
        }),
      );
      throw error;
    });
  const returnScreenshot = testInfo.outputPath("large-table-return.png");
  await page.screenshot({ path: returnScreenshot });
  await testInfo.attach("large-table-return", {
    path: returnScreenshot,
    contentType: "image/png",
  });
  await testInfo.attach("pagination-timings", {
    body: JSON.stringify({ seedMs, firstPageMs, nextPageMs }),
    contentType: "application/json",
  });
});
