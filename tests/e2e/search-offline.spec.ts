/**
 * Honest local-first search coverage (feature 008, US2).
 *
 * The journey keeps one page body locally, releases another, disconnects,
 * commits a new edit and then reconnects. It proves both halves of the promise:
 * local work is searchable immediately, and released content is never claimed
 * to have been searched on this device.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function openSearch(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search the workspace" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function searchFor(page: Page, query: string) {
  const dialog = await openSearch(page);
  await dialog.getByLabel("Query").fill(query);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  return dialog;
}

async function releasePageBodyFromDevice(page: Page, name: string): Promise<void> {
  const itemId = await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id");
  if (itemId === null) {
    throw new Error("page identity is absent from the hierarchy row");
  }
  await page.evaluate(
    async ({ id }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("myownnotion-local");
        request.onerror = () => reject(request.error ?? new Error("local database unavailable"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            [
              "items",
              "pageOperationStates",
              "pageOperationUpdates",
              "pageAmbiguities",
              "legacyOfflineBranches",
            ],
            "readwrite",
          );
          const store = transaction.objectStore("items");
          const read = store.get(id);
          read.onerror = () => reject(read.error ?? new Error("local page unavailable"));
          read.onsuccess = () => {
            if (read.result === undefined) {
              transaction.abort();
              reject(new Error("local page row not found"));
              return;
            }
            store.put({
              ...read.result,
              sealedPageBody: null,
              localAvailability: "offloaded",
            });
            transaction.objectStore("pageOperationStates").delete(id);
            transaction.objectStore("legacyOfflineBranches").delete(id);
            for (const storeName of ["pageOperationUpdates", "pageAmbiguities"]) {
              const indexedStore = transaction.objectStore(storeName);
              const cursor = indexedStore.index("pageId").openKeyCursor(IDBKeyRange.only(id));
              cursor.onsuccess = () => {
                const match = cursor.result;
                if (match === null) return;
                indexedStore.delete(match.primaryKey);
                match.continue();
              };
            }
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("local page release failed"));
          };
        };
      });
    },
    { id: itemId },
  );
}

test.describe("offline workspace search (US2)", () => {
  test("finds pending local work, states released coverage, and deduplicates after reconnect", async ({
    page,
    context,
  }) => {
    await openWorkspace(page);
    const token = uniqueName("offline-search");
    const offloadedPage = `Archive ${token}`;
    const localPage = `Local ${token}`;
    const releasedBodyPhrase = `remote-only-body ${token}`;
    const pendingBodyPhrase = `pending-local-body ${token}`;

    await createRootItem(page, "page", offloadedPage);
    await createRootItem(page, "page", localPage);
    await waitForSynchronized(page);

    await selectItem(page, offloadedPage);
    await typeIntoEditor(page, releasedBodyPhrase);
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);
    await releasePageBodyFromDevice(page, offloadedPage);

    // Open the page that stays local before disconnecting, so editing it needs
    // neither a server read nor a reload of the application shell.
    await selectItem(page, localPage);
    await context.setOffline(true);
    try {
      await typeIntoEditor(page, pendingBodyPhrase);
      await saveDocument(page);
      // Page operations have their own transport and status. The workspace
      // outbox can truthfully be empty while this open page still has durable
      // work waiting for a network, so assert the page-level signal.
      await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-sync", "offline", {
        timeout: 20_000,
      });

      let dialog = await searchFor(page, pendingBodyPhrase);
      await expect(
        dialog.getByText("Search is limited to data available on this device while offline."),
      ).toBeVisible();
      const pendingResult = dialog.getByRole("listitem").filter({ hasText: localPage });
      await expect(pendingResult).toHaveCount(1);
      await expect(pendingResult).toContainText(pendingBodyPhrase);
      await dialog.getByRole("button", { name: "Close search" }).click();

      dialog = await searchFor(page, offloadedPage);
      const releasedResult = dialog.getByRole("listitem").filter({ hasText: offloadedPage });
      await expect(releasedResult).toHaveCount(1);
      await expect(releasedResult).toContainText("Content released from this device");
      await releasedResult.getByRole("button").click();
      await expect(page.getByTestId("editor-unavailable")).toContainText(
        "released from this device",
      );

      dialog = await searchFor(page, releasedBodyPhrase);
      await expect(
        dialog.getByText("No result in the data available on this device."),
      ).toBeVisible();
      await expect(
        dialog.getByText("Search is limited to data available on this device while offline."),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Close search" }).click();
    } finally {
      await context.setOffline(false);
    }

    await waitForSynchronized(page);
    const dialog = await searchFor(page, pendingBodyPhrase);
    await expect(
      dialog.getByText("Search is limited to data available on this device while offline."),
    ).toHaveCount(0);
    await expect(dialog.getByRole("listitem").filter({ hasText: localPage })).toHaveCount(1);
  });
});
