import { expect, test } from "@playwright/test";
import {
  addCanvasPageCard,
  addCanvasTextCard,
  connectCanvasCards,
  drawCanvasStroke,
  insertCanvas,
} from "./canvas-helpers.ts";
import {
  createRootItem,
  goOffline,
  goOnline,
  openWorkspace,
  reconnectAndSynchronize,
  reloadWhileOffline,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

function canvasNodes(document: unknown): Array<Record<string, unknown>> {
  const canvases: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["type"] === "canvasBlock") canvases.push(record);
    for (const child of Object.values(record)) visit(child);
  };
  visit(document);
  return canvases;
}

test.describe("offline freeform canvas (US4)", () => {
  test("keeps complete geometry, connections, drawing, page card, removal, and viewport through reconnect", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("OfflineCanvas");
    const targetName = uniqueName("OfflineCanvasTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${sourceName}`).getAttribute("data-item-id");
    const targetId = await page.getByTestId(`tree-item-${targetName}`).getAttribute("data-item-id");
    if (sourceId === null || targetId === null) throw new Error("Offline canvas identity missing");
    await selectItem(page, sourceName);
    await goOffline(page);

    const canvas = await insertCanvas(page);
    const textCard = await addCanvasTextCard(canvas, "Durable offline idea");
    const textCardId = await textCard.getAttribute("data-card-id");
    await textCard.click();
    await canvas.getByRole("button", { name: "Move selected card down" }).click();
    await canvas.getByRole("spinbutton", { name: "Card width" }).fill("360");
    await addCanvasPageCard(canvas, targetName);
    const pageCard = canvas.getByRole("button", { name: `Page card: ${targetName}` });
    const pageCardId = await pageCard.getAttribute("data-card-id");
    await addCanvasTextCard(canvas, "Remove offline");
    await canvas.getByRole("button", { name: "Text card: Remove offline" }).click();
    await canvas.getByRole("button", { name: "Remove card" }).click();
    await connectCanvasCards(canvas, "Durable offline idea", targetName, "supports");
    await canvas.getByRole("button", { name: "Pan canvas right" }).click();
    await canvas.getByRole("button", { name: "Zoom canvas in" }).click();
    await drawCanvasStroke(page, canvas);

    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    await reloadWhileOffline(page);
    await expect(page.getByTestId(`tree-item-${sourceName}`)).toBeVisible({ timeout: 15_000 });
    await selectItem(page, sourceName);
    const reloaded = page.getByTestId("canvas-block");
    await expect(
      reloaded.getByRole("button", { name: "Text card: Durable offline idea" }),
    ).toBeVisible();
    await expect(reloaded.getByRole("button", { name: `Page card: ${targetName}` })).toBeVisible();
    await expect(reloaded.getByRole("button", { name: "Text card: Remove offline" })).toHaveCount(
      0,
    );
    await expect(
      reloaded.locator("[data-connection-id]").getByRole("textbox", { name: "Connection name" }),
    ).toHaveValue("supports");
    await expect(reloaded.locator("[data-stroke-id]")).toHaveCount(1);
    await expect(reloaded.getByRole("status", { name: "Canvas zoom" })).toHaveText("125%");

    await reconnectAndSynchronize(page);
    const synchronized = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    expect(synchronized.ok()).toBe(true);
    const body = (await synchronized.json()) as {
      pageDocument: { formatVersion: number; body: unknown };
    };
    expect(body.pageDocument.formatVersion).toBe(6);
    const nodes = canvasNodes(body.pageDocument.body);
    expect(nodes).toHaveLength(1);
    const attrs = nodes[0]?.["attrs"] as
      | {
          cards?: Array<Record<string, unknown>>;
          connections?: Array<Record<string, unknown>>;
          strokes?: Array<Record<string, unknown>>;
          viewport?: Record<string, unknown>;
        }
      | undefined;
    expect(attrs?.cards).toHaveLength(2);
    expect(attrs?.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cardId: textCardId, width: 360, y: 20 }),
        expect.objectContaining({ cardId: pageCardId, targetItemId: targetId }),
      ]),
    );
    expect(attrs?.connections).toEqual([
      expect.objectContaining({
        sourceCardId: textCardId,
        targetCardId: pageCardId,
        label: "supports",
      }),
    ]);
    expect(attrs?.strokes).toEqual([
      expect.objectContaining({
        width: 4,
        points: expect.arrayContaining([
          expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        ]),
      }),
    ]);
    expect(attrs?.viewport).toEqual({ x: -80, y: 0, zoom: 1.25 });

    const relationships = await request.get(
      `http://127.0.0.1:${apiPort}/v1/relationships?itemId=${sourceId}`,
    );
    const relationshipBody = (await relationships.json()) as {
      relationships: Array<Record<string, unknown>>;
    };
    expect(relationshipBody.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pageCardId,
          sourceItemId: sourceId,
          targetItemId: targetId,
          relationType: "link:references",
        }),
      ]),
    );
  });

  test("keeps a complete local canvas recoverable after a competing revision", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("CanvasConflict");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (sourceId === null) throw new Error("Conflict canvas page identity missing");
    await selectItem(page, pageName);
    await goOffline(page);
    const canvas = await insertCanvas(page);
    await addCanvasTextCard(canvas, "Keep complete local canvas");
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });

    const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${sourceId}`);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(
      `http://127.0.0.1:${apiPort}/v1/pages/${sourceId}/document`,
      {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          baseRevisionId: currentBody.currentRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 6,
            body: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Competing document" }] },
              ],
            },
          },
        },
      },
    );
    expect(competing.ok()).toBe(true);

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId("conflict-records")).toBeVisible({ timeout: 20_000 });
    await selectItem(page, pageName);
    await expect(
      page.getByTestId("canvas-block").getByRole("button", {
        name: "Text card: Keep complete local canvas",
      }),
    ).toBeVisible();
  });
});
