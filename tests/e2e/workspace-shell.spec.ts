/**
 * The focused V1 workspace shell on desktop and phone (T052, US1).
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  moveSelectedItemInto,
  openWorkspace,
  renameItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

interface StoredPresentationState {
  readonly sidebarOpen?: boolean;
  readonly sidebarWidth?: number;
  readonly expandedItemIds?: string[];
  readonly lastVisitedItemId?: string | null;
}

/** Reads the durable presentation record so reload never races its IndexedDB write. */
async function storedPresentationState(page: Page): Promise<StoredPresentationState | null> {
  return await page.evaluate(
    async () =>
      await new Promise<StoredPresentationState | null>((resolve, reject) => {
        const request = indexedDB.open("myownnotion-local");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("meta", "readonly");
          const read = transaction.objectStore("meta").get("navigation-state");
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const row = read.result as { readonly value?: StoredPresentationState } | undefined;
            resolve(row?.value ?? null);
          };
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

test.describe("focused workspace shell", () => {
  test("keeps identity, path and device context coherent through mutations and reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);

    const projects = uniqueName("Projets");
    const archive = uniqueName("Archives");
    const originalPage = uniqueName("Feuille de route");
    const renamedPage = `${originalPage}-2027`;

    await createRootItem(page, "folder", projects);
    await createChildItem(page, projects, "page", originalPage);
    await expect(page.getByTestId("active-item-title")).toHaveValue(originalPage);
    await createRootItem(page, "folder", archive);

    await expect(page.getByTestId("active-item-title")).toHaveValue(originalPage);
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toContainText(projects);

    await renameItem(page, originalPage, renamedPage);
    await expect(page.getByTestId(`tree-item-${renamedPage}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("active-item-title")).toHaveValue(renamedPage);

    // Capture the stable identity while its current branch is expanded. Once
    // moved under the closed archive the row is correctly absent from the DOM,
    // while the selected content and breadcrumb remain active.
    const selectedItemId = await page
      .getByTestId(`tree-item-${renamedPage}`)
      .getAttribute("data-item-id");
    const projectsId = await page.getByTestId(`tree-item-${projects}`).getAttribute("data-item-id");
    expect(selectedItemId).not.toBeNull();
    expect(projectsId).not.toBeNull();

    await moveSelectedItemInto(page, archive);
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toContainText(archive, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("active-item-title")).toHaveValue(renamedPage);

    const resizer = page.getByTestId("sidebar-resizer");
    await resizer.focus();
    await resizer.press("End");
    await expect(resizer).toHaveAttribute("aria-valuenow", "360");
    await waitForSynchronized(page);

    await expect
      .poll(async () => await storedPresentationState(page))
      .toMatchObject({
        sidebarOpen: true,
        sidebarWidth: 360,
        expandedItemIds: expect.arrayContaining([projectsId as string]),
        lastVisitedItemId: selectedItemId,
      });

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("active-item-title")).toHaveValue(renamedPage);
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toContainText(archive);
    await expect(page.getByTestId(`tree-item-${projects}`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByTestId("sidebar-resizer")).toHaveAttribute("aria-valuenow", "360");
  });

  test("uses a modal touch drawer and returns focus when it closes", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openWorkspace(page);

    const pageName = uniqueName("Page mobile");
    const drawer = page.getByTestId("workspace-navigation-drawer");
    const trigger = page.getByTestId("toggle-tree");
    await expect(drawer).toBeHidden();
    await trigger.click();
    await expect(drawer).toBeVisible();
    await createRootItem(page, "page", pageName);

    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("active-item-title")).toHaveValue(pageName);

    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.getByTestId(`tree-item-${pageName}`).focus();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test("edits the page title in the document without remounting the editor", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    const original = uniqueName("Titre intégré");
    const renamed = uniqueName("Titre modifié");
    await createRootItem(page, "page", original);
    await waitForSynchronized(page);
    await expect(page.getByTestId("active-item-title")).toHaveValue(original);

    const editorIdentity = await page.getByTestId("block-editor").evaluate((node) => {
      node.dataset["mountIdentity"] = crypto.randomUUID();
      return node.dataset["mountIdentity"];
    });
    const title = page.getByRole("textbox", { name: "Titre de la page" });
    await expect(title).toHaveValue(original);
    await title.fill(renamed);
    await title.blur();

    await expect(page.getByTestId(`tree-item-${renamed}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Fil d’Ariane" })).toContainText(renamed);
    await expect(page.getByTestId("block-editor")).toHaveAttribute(
      "data-mount-identity",
      editorIdentity,
    );

    await title.fill("");
    await title.blur();
    await expect(title).toHaveValue("Sans titre");
    await expect(page.getByTestId("tree-item-Sans titre")).toBeVisible({ timeout: 15_000 });
  });
});
