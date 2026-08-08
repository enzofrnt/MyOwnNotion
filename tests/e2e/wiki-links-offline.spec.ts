import { expect, type Page, test } from "@playwright/test";
import {
  createRootItem,
  goOffline,
  goOnline,
  openWorkspace,
  reloadWhileOffline,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

async function insertLink(page: Page, targetName: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Page content" });
  await editor.focus();
  await page.keyboard.type(`[[${targetName.slice(0, 10)}`);
  await page.getByRole("option", { name: new RegExp(targetName) }).click();
  await page.getByRole("button", { name: "Save page" }).click();
}

test.describe("offline wiki links (US4)", () => {
  test("keeps an add and removal across offline reloads and synchronizes one occurrence", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("OfflineLinkSource");
    const targetName = uniqueName("OfflineLinkTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await waitForSynchronized(page);
    const sourceId = await page.getByTestId(`tree-item-${sourceName}`).getAttribute("data-item-id");
    const targetId = await page.getByTestId(`tree-item-${targetName}`).getAttribute("data-item-id");
    if (sourceId === null || targetId === null) {
      throw new Error("Created pages have no stable ids");
    }
    await selectItem(page, sourceName);

    await goOffline(page);
    await insertLink(page, targetName);
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Outgoing links" })).toContainText(targetName);
    await reloadWhileOffline(page);
    await expect(page.getByTestId(`tree-item-${sourceName}`)).toBeVisible({ timeout: 15_000 });
    await selectItem(page, sourceName);
    await expect(page.locator("a[data-wiki-link]")).toContainText(targetName);
    await expect(page.getByRole("region", { name: "Outgoing links" })).toContainText(targetName);

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    const firstSnapshot = await request.get(`http://127.0.0.1:${apiPort}/v1/snapshots/current`);
    expect(firstSnapshot.ok()).toBe(true);
    const firstBody = (await firstSnapshot.json()) as {
      relationships: Array<{ sourceItemId: string; targetItemId: string; relationType: string }>;
    };
    expect(
      firstBody.relationships.filter(
        (relationship) =>
          relationship.sourceItemId === sourceId &&
          relationship.targetItemId === targetId &&
          relationship.relationType === "link:references",
      ),
    ).toHaveLength(1);

    await selectItem(page, sourceName);
    await goOffline(page);
    await page.getByRole("textbox", { name: "Page content" }).fill("Link removed offline");
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    await reloadWhileOffline(page);
    await selectItem(page, sourceName);
    await expect(page.getByRole("region", { name: "Outgoing links" })).toContainText(
      "No outgoing links",
    );

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    const finalSnapshot = await request.get(`http://127.0.0.1:${apiPort}/v1/snapshots/current`);
    const finalBody = (await finalSnapshot.json()) as {
      relationships: Array<{ sourceItemId: string; targetItemId: string; relationType: string }>;
    };
    expect(
      finalBody.relationships.filter(
        (relationship) =>
          relationship.sourceItemId === sourceId && relationship.targetItemId === targetId,
      ),
    ).toHaveLength(0);
  });

  test("keeps the local linked document and projection recoverable after a competing revision", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const sourceName = uniqueName("LinkConflictSource");
    const targetName = uniqueName("LinkConflictTarget");
    await createRootItem(page, "page", targetName);
    await createRootItem(page, "page", sourceName);
    await waitForSynchronized(page);
    await selectItem(page, sourceName);
    const sourceId = await page.getByTestId(`tree-item-${sourceName}`).getAttribute("data-item-id");
    if (sourceId === null) {
      throw new Error("Created source has no stable id");
    }

    await goOffline(page);
    await insertLink(page, targetName);
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
            formatVersion: 3,
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Competing server document" }],
                },
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
    await selectItem(page, sourceName);
    await expect(page.locator("a[data-wiki-link]")).toContainText(targetName);
    await expect(page.getByRole("region", { name: "Outgoing links" })).toContainText(targetName);
  });
});
