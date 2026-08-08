import { expect, test } from "@playwright/test";
import {
  createRootItem,
  goOffline,
  goOnline,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

test.describe("block editor offline durability (US4)", () => {
  test("keeps a rich edit through an offline reload and synchronizes it after reconnect", async ({
    page,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("OfflineEditor");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);

    await goOffline(page);
    const editor = page.getByRole("textbox", { name: "Page content" });
    await editor.fill("A durable offline paragraph");
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");

    await page.reload();
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeVisible({ timeout: 15_000 });
    await selectItem(page, pageName);
    await expect(page.getByRole("textbox", { name: "Page content" })).toContainText(
      "A durable offline paragraph",
    );
    await expect(page.getByTestId("pending-mutations")).toBeVisible();

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await expect(page.getByRole("textbox", { name: "Page content" })).toContainText(
      "A durable offline paragraph",
    );
  });

  test("keeps the local rich document recoverable when a competing revision wins", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const pageName = uniqueName("EditorConflict");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (itemId === null) {
      throw new Error("Created page has no stable item id");
    }

    await goOffline(page);
    await page.getByRole("textbox", { name: "Page content" }).fill("Local competing draft");
    await expect(page.getByTestId("pending-mutations")).toBeVisible({ timeout: 15_000 });

    const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${itemId}`);
    expect(current.ok()).toBe(true);
    const currentBody = (await current.json()) as { currentRevisionId: string };
    const competing = await request.put(`http://127.0.0.1:${apiPort}/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        baseRevisionId: currentBody.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Competing server draft" }],
              },
            ],
          },
        },
      },
    });
    expect(competing.ok()).toBe(true);

    await goOnline(page);
    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId("conflict-records")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "conflict");
    await expect(page.getByTestId("conflict-records")).toContainText("competing revision");
  });
});
