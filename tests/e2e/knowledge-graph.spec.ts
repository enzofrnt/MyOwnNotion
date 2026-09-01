import { expect, test } from "./fixtures.ts";
import {
  createBusinessRelationship,
  createChildItem,
  createRootItem,
  ensureNavigationVisible,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("the content graph stays distinct from folders and supports ten pointer journeys", async ({
  page,
  browserName,
}, testInfo) => {
  test.slow();
  await openWorkspace(page);
  const productFolder = uniqueName("GraphProduct");
  const researchFolder = uniqueName("GraphResearch");
  const source = uniqueName("ContentSource");
  const target = uniqueName("ContentTarget");
  const otherSource = uniqueName("OtherSource");
  const otherTarget = uniqueName("OtherTarget");
  const additionalPages = Array.from({ length: 6 }, (_, index) =>
    uniqueName(`PointerJourney${index + 1}`),
  );
  await createRootItem(page, "folder", productFolder);
  await createRootItem(page, "folder", researchFolder);
  await createChildItem(page, productFolder, "page", source);
  await createChildItem(page, researchFolder, "page", target);
  await createChildItem(page, productFolder, "page", otherSource);
  await createChildItem(page, researchFolder, "page", otherTarget);
  for (const [index, name] of additionalPages.entries()) {
    await createChildItem(page, index % 2 === 0 ? productFolder : researchFolder, "page", name);
  }
  await waitForSynchronized(page);

  const pageNames = [source, target, otherSource, otherTarget, ...additionalPages];
  const identities = Object.fromEntries(
    await Promise.all(
      [productFolder, researchFolder, ...pageNames].map(async (name) => [
        name,
        await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id"),
      ]),
    ),
  );
  if (Object.values(identities).some((itemId) => itemId === null)) {
    throw new Error("Le scénario pointeur exige des identités locales complètes.");
  }
  const sourceId = identities[source] as string;
  const targetId = identities[target] as string;
  const otherSourceId = identities[otherSource] as string;
  const otherTargetId = identities[otherTarget] as string;
  const productFolderId = identities[productFolder] as string;
  const researchFolderId = identities[researchFolder] as string;

  const authored = await page.evaluate(
    async (pairs) => {
      const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
      if (service === undefined) return false;
      for (const { sourceItemId, targetItemId } of pairs) {
        const item = await service.getItem(sourceItemId);
        if (item === null) return false;
        const result = await service.mutate(
          "page.document.replace",
          {
            itemId: sourceItemId,
            baseRevisionId: item.currentRevisionId,
            document: {
              format: "myownnotion.document+json",
              formatVersion: 2,
              body: {
                blocks: [
                  {
                    type: "paragraph",
                    id: crypto.randomUUID(),
                    content: [
                      { text: "Décision reliée au contenu : " },
                      {
                        text: "cible éditoriale",
                        marks: [{ type: "pageLink", targetItemId }],
                      },
                    ],
                  },
                ],
              },
            },
            pageLinkTargetIds: [targetItemId],
          },
          [item.currentRevisionId],
        );
        if (!result.ok) return false;
      }
      await service.synchronize();
      return true;
    },
    [
      { sourceItemId: sourceId, targetItemId: targetId },
      { sourceItemId: otherSourceId, targetItemId: otherTargetId },
      {
        sourceItemId: identities[additionalPages[0] as string] as string,
        targetItemId: identities[additionalPages[1] as string] as string,
      },
      {
        sourceItemId: identities[additionalPages[2] as string] as string,
        targetItemId: identities[additionalPages[3] as string] as string,
      },
      {
        sourceItemId: identities[additionalPages[4] as string] as string,
        targetItemId: identities[additionalPages[5] as string] as string,
      },
    ],
  );
  expect(authored).toBe(true);

  await ensureNavigationVisible(page);
  await page.getByTestId("open-knowledge-graph").click();
  await expect(page).toHaveURL("/graph");
  const graph = page.getByTestId("knowledge-graph");
  await expect(graph).toBeVisible();
  await graph.getByRole("button", { name: /Carte/u }).click();
  const canvas = page.getByTestId("knowledge-graph-canvas");
  const journeyItems = pageNames.map((name) => ({ name, id: identities[name] as string }));
  for (const { id: itemId } of journeyItems) {
    await expect(canvas.locator(`[data-graph-node="${itemId}"]`)).toHaveCount(1);
  }
  for (const folderId of [productFolderId, researchFolderId]) {
    await expect(canvas.locator(`[data-graph-node="${folderId}"]`)).toHaveCount(0);
  }

  await page.getByLabel("Hiérarchie").check();
  await expect(canvas.locator(`[data-graph-node="${productFolderId}"]`)).toHaveCount(1);
  await expect(canvas.locator(`[data-graph-node="${researchFolderId}"]`)).toHaveCount(1);
  await page.getByLabel("Hiérarchie").uncheck();
  await expect(canvas.locator(`[data-graph-node="${productFolderId}"]`)).toHaveCount(0);

  const startedAt = Date.now();
  for (let journey = 0; journey < 10; journey += 1) {
    const svg = canvas.locator(":scope > svg");
    const box = await svg.boundingBox();
    if (box === null) throw new Error("La carte doit fournir une surface au pointeur.");
    await page.mouse.move(box.x + 12, box.y + box.height - 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 32 + journey, box.y + box.height - 28, { steps: 2 });
    await page.mouse.up();
    const deltaY = journey % 2 === 0 ? -120 : 120;
    if (browserName === "webkit" && testInfo.project.name.endsWith("-mobile")) {
      await svg.evaluate(
        (element, wheel) =>
          element.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: wheel.clientX,
              clientY: wheel.clientY,
              deltaY: wheel.deltaY,
            }),
          ),
        {
          clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2,
          deltaY,
        },
      );
    } else {
      await page.mouse.wheel(0, deltaY);
    }

    const sourceNode = canvas.locator(`[data-graph-node="${sourceId}"]`);
    const journeyItem = journeyItems[journey];
    if (journeyItem === undefined) throw new Error("Le parcours pointeur est incomplet.");
    const targetNode = canvas.locator(`[data-graph-node="${journeyItem.id}"]`);
    const unrelatedNode = canvas.locator(`[data-graph-node="${otherSourceId}"]`);
    await sourceNode.hover();
    await expect(unrelatedNode).toHaveAttribute("data-emphasis", "dimmed");
    await targetNode.click();
    const inspector = page.locator(".knowledge-graph-inspector");
    await expect(inspector).toBeVisible();
    if (journey === 0) {
      await targetNode.locator("circle").dblclick();
    } else {
      await inspector.getByRole("button", { name: "Ouvrir la page" }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/notes/${journeyItem.id}$`, "u"));
    await expect(page.getByTestId("active-item-title")).toHaveValue(journeyItem.name);
    await ensureNavigationVisible(page);
    await page.getByTestId("open-knowledge-graph").click();
    await expect(page).toHaveURL("/graph");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("active-item-title")).toHaveCount(0);
  }
  expect(Date.now() - startedAt).toBeLessThan(20_000);
});

test("backlinks, local graph, global filters and offline restart stay coherent", async ({
  page,
}) => {
  test.slow();
  await openWorkspace(page);
  const source = uniqueName("GraphSource");
  const target = uniqueName("GraphTarget");
  const isolated = uniqueName("GraphIsolated");
  await createRootItem(page, "page", source);
  await createRootItem(page, "page", target);
  await createRootItem(page, "page", isolated);
  await waitForSynchronized(page);

  const targetId = await page.getByTestId(`tree-item-${target}`).getAttribute("data-item-id");
  const sourceId = await page.getByTestId(`tree-item-${source}`).getAttribute("data-item-id");
  const isolatedId = await page.getByTestId(`tree-item-${isolated}`).getAttribute("data-item-id");
  if (sourceId === null || targetId === null || isolatedId === null) {
    throw new Error("Les éléments du graphe doivent conserver leur identité.");
  }
  for (let occurrence = 0; occurrence < 2; occurrence += 1) {
    await createBusinessRelationship(page.context().request, sourceId, targetId);
  }
  await page.evaluate(async () => {
    await window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.().synchronize();
  });

  await selectItem(page, source);
  await page.getByTestId("open-local-graph").click();
  await expect(page).toHaveURL(/\/graph\/[0-9a-f-]+$/u);
  const graph = page.getByTestId("knowledge-graph");
  await expect(graph).toBeVisible();
  await expect(graph.locator(`[data-graph-node="${targetId}"]`)).toHaveCount(1);
  await expect(graph.getByText("2 occurrences", { exact: false })).toBeVisible();
  await expect(graph.getByText("Vue complète sur cet appareil")).toBeVisible();

  await graph.getByRole("button", { name: /Carte/u }).click();
  const canvasNodes = page.locator('[data-testid="knowledge-graph-canvas"] [data-graph-node]');
  await expect(canvasNodes).toHaveCount(2);
  await canvasNodes.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(canvasNodes.nth(1)).toBeFocused();
  await page.keyboard.press("+");
  await expect(page.getByLabel("Niveau de zoom")).toHaveText("125 %");
  await page.keyboard.press("0");
  await expect(page.getByLabel("Niveau de zoom")).toHaveText("100 %");
  await page.keyboard.press("Escape");
  await expect(page.locator(".knowledge-graph-inspector")).toHaveCount(0);

  await ensureNavigationVisible(page);
  await page.getByTestId("open-knowledge-graph").click();
  await expect(page).toHaveURL("/graph");
  await expect(graph.locator(`[data-graph-node="${isolatedId}"]`)).toHaveCount(0);
  await page.getByLabel("Afficher les éléments isolés").check();
  await expect(graph.locator(`[data-graph-node="${isolatedId}"]`)).toHaveCount(1);
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await expect(graph.locator(`[data-graph-node="${isolatedId}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: /Liste/u }).click();
  await expect(page.getByTestId("knowledge-graph-list")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const zoomedLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}.${element.className}`,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter(
        ({ left, right }) =>
          left < -1 || right > Math.round(document.documentElement.clientWidth) + 1,
      )
      .slice(0, 12),
  }));
  expect(
    zoomedLayout.overflow,
    JSON.stringify(zoomedLayout.offenders, null, 2),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });

  await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/health", (route) => route.abort("connectionrefused"));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  const addOffline = await page.evaluate(
    async ({ sourceItemId, targetItemId }) => {
      const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
      const sourceItem = await service?.getItem(sourceItemId);
      if (service === undefined || sourceItem === null || sourceItem === undefined) return null;
      return await service.mutate(
        "page.document.replace",
        {
          itemId: sourceItemId,
          baseRevisionId: sourceItem.currentRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: {
              blocks: [
                {
                  type: "paragraph",
                  id: crypto.randomUUID(),
                  content: [
                    {
                      text: "Lien ajouté hors ligne",
                      marks: [{ type: "pageLink", targetItemId }],
                    },
                  ],
                },
              ],
            },
          },
          pageLinkTargetIds: [targetItemId],
        },
        [sourceItem.currentRevisionId],
      );
    },
    { sourceItemId: sourceId, targetItemId: targetId },
  );
  expect(addOffline).toEqual({ ok: true });
  const sourceGraphRow = graph.locator(`[data-graph-node="${sourceId}"]`);
  await sourceGraphRow.getByRole("button").first().click();
  await expect(page.locator(".knowledge-graph-inspector")).toContainText("Lien interne");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByTestId("knowledge-graph"),
    "the local graph survives an offline reload",
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Hors ligne", { exact: false }).first()).toBeVisible();
  await expect(graph.locator(`[data-graph-node="${targetId}"]`)).toHaveCount(1);
  await graph.locator(`[data-graph-node="${sourceId}"]`).getByRole("button").first().click();
  await expect(page.locator(".knowledge-graph-inspector")).toContainText("Lien interne");

  const removeOffline = await page.evaluate(async (sourceItemId) => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    const sourceItem = await service?.getItem(sourceItemId);
    if (service === undefined || sourceItem === null || sourceItem === undefined) return null;
    return await service.mutate(
      "page.document.replace",
      {
        itemId: sourceItemId,
        baseRevisionId: sourceItem.currentRevisionId,
        document: { format: "myownnotion.document+json", formatVersion: 2, body: { blocks: [] } },
        pageLinkTargetIds: [],
      },
      [sourceItem.currentRevisionId],
    );
  }, sourceId);
  expect(removeOffline).toEqual({ ok: true });
  await expect(page.locator(".knowledge-graph-inspector")).not.toContainText("Lien interne");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("knowledge-graph")).toBeVisible({ timeout: 20_000 });
  await graph.locator(`[data-graph-node="${sourceId}"]`).getByRole("button").first().click();
  await expect(page.locator(".knowledge-graph-inspector")).not.toContainText("Lien interne");
});
