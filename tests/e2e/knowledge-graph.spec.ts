import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationVisible,
  openSettingsSection,
  openWorkspace,
  returnToWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

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
  await selectItem(page, source);
  await openSettingsSection(page, "page-details");
  const relationshipRows = page.getByTestId("relationship-list").locator("li");
  for (let occurrence = 0; occurrence < 2; occurrence += 1) {
    await page.getByTestId("relation-target").fill(targetId);
    await page.getByTestId("create-relation").click();
    await expect(relationshipRows).toHaveCount(occurrence + 1);
  }
  await returnToWorkspace(page);
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
  await page.keyboard.press("ArrowUp");
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
