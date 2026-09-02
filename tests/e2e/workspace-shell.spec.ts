/**
 * The focused V1 workspace shell on desktop and phone (T052, US1).
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  ensureNavigationVisible,
  moveSelectedItemInto,
  openSettingsSection,
  openWorkspace,
  renameItem,
  returnToWorkspace,
  selectItem,
  triggerAndSampleCssTransition,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

interface StoredPresentationState {
  readonly sidebarOpen?: boolean;
  readonly sidebarWidth?: number;
  readonly favouritesVisible?: boolean;
  readonly favouritesExpanded?: boolean;
  readonly recentsVisible?: boolean;
  readonly recentsExpanded?: boolean;
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
  test("collapses and restores the desktop sidebar through a real intermediate width", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.endsWith("-mobile"),
      "The whole-sidebar control is desktop-only",
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);

    const shell = page.getByTestId("workspace-shell");
    const slot = page.locator(".workspace-sidebar-slot");
    const close = page.getByRole("button", { name: "Masquer la barre latérale" });
    const open = page.getByRole("button", { name: "Afficher la barre latérale" });
    const initial = await slot.boundingBox();
    expect(initial).not.toBeNull();
    await expect(close).toBeVisible();
    await expect(open).toBeHidden();

    const closing = await triggerAndSampleCssTransition(close, slot, "width");
    expect(closing.width).toBeGreaterThan(1);
    expect(closing.width).toBeLessThan(initial?.width ?? 0);

    await expect(open).toBeVisible();
    await expect(open).toBeFocused();
    const topRow = await page.locator(".workspace-stage__header").boundingBox();
    const openControl = await open.boundingBox();
    expect(topRow).not.toBeNull();
    expect(openControl).not.toBeNull();
    expect(openControl?.y ?? 0).toBeGreaterThanOrEqual((topRow?.y ?? 0) - 0.5);
    expect((openControl?.y ?? 0) + (openControl?.height ?? 0)).toBeLessThanOrEqual(
      (topRow?.y ?? 0) + (topRow?.height ?? 0) + 0.5,
    );
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    await expect.poll(async () => (await slot.boundingBox())?.width ?? 0).toBeLessThan(1);
    const closedShell = await shell.boundingBox();
    const closedStage = await shell.locator(".workspace-stage").boundingBox();
    expect(closedShell).not.toBeNull();
    expect(closedStage).not.toBeNull();
    expect(Math.abs((closedStage?.x ?? 0) - (closedShell?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((closedStage?.width ?? 0) - (closedShell?.width ?? 0))).toBeLessThanOrEqual(1);
    await expect
      .poll(async () => await storedPresentationState(page))
      .toMatchObject({ sidebarOpen: false });

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toHaveAttribute("data-sidebar-open", "false");
    await expect(open).toBeVisible();
    const opening = await triggerAndSampleCssTransition(open, slot, "width");
    expect(opening.width).toBeGreaterThan(1);
    expect(opening.width).toBeLessThan(initial?.width ?? 0);
    await expect(close).toBeVisible();
    await expect(close).toBeFocused();
    await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  });

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

    // Root and nested creation now share the same navigation contract: the
    // created item opens immediately with its title focused. Return to the
    // original page before exercising the remaining identity mutations.
    await expect(page.getByTestId("active-item-title")).toHaveValue(archive);
    await selectItem(page, originalPage);
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
    const createdTitle = page.getByTestId("active-item-title");
    await expect(createdTitle).toHaveValue(pageName);

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

  test("restores local shortcut visibility and collapse preferences after reload", async ({
    page,
  }) => {
    await openWorkspace(page);
    await ensureNavigationVisible(page);
    await expect(page.getByRole("heading", { level: 3, name: "Notes" })).toBeVisible();

    await page.getByRole("button", { name: "Replier les favoris" }).click();
    await page.getByRole("button", { name: "Replier les récents" }).click();
    await expect(page.getByRole("button", { name: "Déplier les favoris" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Déplier les récents" })).toBeVisible();

    await openSettingsSection(page, "navigation");
    const favourites = page.getByRole("switch", { name: /favoris/iu });
    await expect(favourites).toHaveAttribute("aria-checked", "true");
    await favourites.click();
    await expect(favourites).toHaveAttribute("aria-checked", "false");
    await returnToWorkspace(page);
    await ensureNavigationVisible(page);

    await expect(page.getByRole("heading", { level: 3, name: "Favoris" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Récents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Déplier les récents" })).toBeVisible();
    await expect
      .poll(async () => await storedPresentationState(page))
      .toMatchObject({
        favouritesVisible: false,
        favouritesExpanded: false,
        recentsVisible: true,
        recentsExpanded: false,
      });

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 15_000 });
    await ensureNavigationVisible(page);
    await expect(page.getByRole("heading", { level: 3, name: "Favoris" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Déplier les récents" })).toBeVisible();

    await openSettingsSection(page, "navigation");
    const restoredFavourites = page.getByRole("switch", { name: /favoris/iu });
    await expect(restoredFavourites).toHaveAttribute("aria-checked", "false");
    await restoredFavourites.click();
    await expect(restoredFavourites).toHaveAttribute("aria-checked", "true");
    await returnToWorkspace(page);
    await ensureNavigationVisible(page);
    await expect(page.getByRole("heading", { level: 3, name: "Favoris" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Déplier les favoris" })).toBeVisible();
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

  test("edits a folder title and emoji from the main canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    const original = uniqueName("Dossier éditable");
    const renamed = uniqueName("Dossier renommé");
    await createRootItem(page, "folder", original);
    await waitForSynchronized(page);
    await page.getByTestId(`tree-item-${original}`).dblclick();

    const title = page.getByRole("textbox", { name: "Nom du dossier" });
    await expect(page.getByTestId("workspace-folder-canvas")).toBeVisible();
    await expect(title).toHaveValue(original);
    await title.fill(renamed);
    await title.blur();
    await expect(page.getByTestId(`tree-item-${renamed}`)).toBeVisible({ timeout: 15_000 });

    const icon = page.getByTestId("item-icon-picker-trigger");
    await icon.click();
    const picker = page.getByTestId("emoji-picker-panel");
    await expect(picker).toBeVisible();
    const folderEmoji = picker.getByRole("button", { name: "📁", exact: true });
    await folderEmoji.click();
    await expect(icon.locator('[data-item-emoji="true"]')).toHaveText("📁");
  });

  test("expands a folder on click and opens it on double-click", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    const keep = uniqueName("Page gardée");
    const folder = uniqueName("Dossier arbre");
    const child = uniqueName("Enfant visible");
    await createRootItem(page, "page", keep);
    await createRootItem(page, "folder", folder);
    await createChildItem(page, folder, "page", child);
    await waitForSynchronized(page);
    await selectItem(page, keep);
    await expect(page.getByTestId("active-item-title")).toHaveValue(keep);

    const folderRow = page.getByTestId(`tree-item-${folder}`);
    const toggle = page.getByTestId(`toggle-${folder}`);
    if ((await folderRow.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
    }
    await expect(folderRow).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(0);

    await folderRow.click();
    await expect(folderRow).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId(`tree-item-${child}`)).toBeVisible();
    await expect(page.getByTestId("active-item-title")).toHaveValue(keep);
    await expect(page.getByTestId("workspace-folder-canvas")).toHaveCount(0);

    await folderRow.click();
    await expect(folderRow).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`tree-item-${child}`)).toHaveCount(0);
    await expect(page.getByTestId("active-item-title")).toHaveValue(keep);

    await folderRow.dblclick();
    await expect(folderRow).toHaveAttribute("aria-expanded", "true");
    await expect(folderRow).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("workspace-folder-canvas")).toBeVisible();
    await expect(page.getByTestId("active-item-title")).toHaveValue(folder);
  });
});
