import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationVisible,
  openWorkspace,
  renameItem,
  trashItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/** Repro (062): the open graph must follow renames, creations, deletions and new links. */
test("the open graph follows content changes live", async ({ page }) => {
  test.slow();
  await openWorkspace(page);
  const first = uniqueName("LiveFirst");
  const second = uniqueName("LiveSecond");
  await createRootItem(page, "page", first);
  await createRootItem(page, "page", second);
  await waitForSynchronized(page);
  const id = async (name: string) =>
    (await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id")) as string;
  const firstId = await id(first);
  const secondId = await id(second);

  await ensureNavigationVisible(page);
  await page.getByTestId("open-knowledge-graph").click();
  await expect(page).toHaveURL("/graph");
  const canvas = page.getByTestId("knowledge-graph-canvas");
  // New pages have no links yet: show isolated elements so they are on the canvas.
  await page.getByTestId("graph-filters-toggle").click();
  // A workspace notice can sit over the filter row: use the keyboard, as a person can.
  const isolated = page.getByRole("switch", { name: "Afficher les éléments isolés", exact: true });
  await isolated.focus();
  await page.keyboard.press("Space");
  await expect(isolated).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(canvas.locator(`[data-graph-node="${firstId}"]`)).toHaveCount(1);

  // 1. Rename while the graph is open.
  const renamed = uniqueName("LiveRenamed");
  await renameItem(page, first, renamed);
  await expect(canvas.locator(`[data-graph-node="${firstId}"]`)).toHaveAttribute(
    "aria-label",
    new RegExp(renamed),
    { timeout: 5_000 },
  );

  // 2. Create a page while the graph is open.
  const third = uniqueName("LiveThird");
  await createRootItem(page, "page", third);
  const thirdId = await id(third);
  // Creating a page opens it in a tab; going back to the graph tab must show it.
  await page.getByTestId("open-tabs").getByRole("button", { name: "Graphe", exact: true }).click();
  await expect(page).toHaveURL("/graph");
  await expect(canvas.locator(`[data-graph-node="${thirdId}"]`)).toHaveCount(1, {
    timeout: 5_000,
  });

  // 3. Add a link while the graph is open.
  const linked = await page.evaluate(
    async ({ sourceItemId, targetItemId }) => {
      const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
      const item = await service?.getItem(sourceItemId);
      if (service === undefined || item == null) return false;
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
                  content: [{ text: "vers", marks: [{ type: "pageLink", targetItemId }] }],
                },
              ],
            },
          },
          pageLinkTargetIds: [targetItemId],
        },
        [item.currentRevisionId],
      );
      return result.ok;
    },
    { sourceItemId: firstId, targetItemId: thirdId },
  );
  expect(linked).toBe(true);
  await expect(canvas.locator(`[data-graph-node="${firstId}"]`)).toHaveAttribute(
    "aria-label",
    /1 sortantes/,
    { timeout: 5_000 },
  );

  // 4. Delete a page while the graph is open.
  await trashItem(page, second);
  await expect(canvas.locator(`[data-graph-node="${secondId}"]`)).toHaveCount(0, {
    timeout: 5_000,
  });
});

test("the open graph follows a rename made in another tab", async ({ page, context }) => {
  test.slow();
  await openWorkspace(page);
  const name = uniqueName("CrossTab");
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  const itemId = (await page
    .getByTestId(`tree-item-${name}`)
    .getAttribute("data-item-id")) as string;
  await ensureNavigationVisible(page);
  await page.getByTestId("open-knowledge-graph").click();
  const isolated = page.getByRole("switch", { name: "Afficher les éléments isolés", exact: true });
  await page.getByTestId("graph-filters-toggle").click();
  await isolated.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  const canvas = page.getByTestId("knowledge-graph-canvas");
  await expect(canvas.locator(`[data-graph-node="${itemId}"]`)).toHaveCount(1);

  const other = await context.newPage();
  await openWorkspace(other);
  const renamed = uniqueName("CrossTabRenamed");
  await renameItem(other, name, renamed);
  await waitForSynchronized(other);
  await expect(canvas.locator(`[data-graph-node="${itemId}"]`)).toHaveAttribute(
    "aria-label",
    new RegExp(renamed),
    { timeout: 10_000 },
  );
});

test("toggling a filter keeps the current layout instead of starting a new view", async ({
  page,
}) => {
  test.slow();
  await openWorkspace(page);
  const name = uniqueName("StableNode");
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  const itemId = (await page
    .getByTestId(`tree-item-${name}`)
    .getAttribute("data-item-id")) as string;
  await ensureNavigationVisible(page);
  await page.getByTestId("open-knowledge-graph").click();
  await page.getByTestId("graph-filters-toggle").click();
  const isolated = page.getByRole("switch", { name: "Afficher les éléments isolés", exact: true });
  await isolated.focus();
  await page.keyboard.press("Space");
  const node = page.getByTestId("knowledge-graph-canvas").locator(`[data-graph-node="${itemId}"]`);
  await expect(node).toHaveCount(1);
  await page.waitForTimeout(1_500);
  const zoomBefore = await page.getByLabel("Niveau de zoom").textContent();
  const before = await node.boundingBox();

  // Show then hide another relation type: a live change, not a new view.
  const hierarchy = page.getByRole("switch", { name: "Hiérarchie", exact: true });
  await hierarchy.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1_500);

  const after = await node.boundingBox();
  expect(await page.getByLabel("Niveau de zoom").textContent()).toBe(zoomBefore);
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(40);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(40);
});
