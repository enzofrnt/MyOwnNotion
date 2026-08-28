/**
 * Complete online workspace search (feature 008, US1 + US3).
 *
 * This journey deliberately creates content through the visible application.
 * It therefore proves that committed page edits and file imports refresh the
 * transient server index, not merely that a prebuilt fixture can be queried.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  convertItem,
  createChildItem,
  createRootItem,
  ensureNavigationVisible,
  moveSelectedItemInto,
  openPageAttachments,
  openSecondDevice,
  openSettingsSection,
  openWorkspace,
  renameItem,
  returnToWorkspace,
  saveDocument,
  selectItem,
  trashItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

async function openSearch(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Rechercher dans l’espace de travail" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Recherche", { exact: true })).toBeFocused();
  return dialog;
}

async function searchFor(page: Page, query: string) {
  const dialog = await openSearch(page);
  const input = dialog.getByLabel("Recherche", { exact: true });
  await input.fill(query);
  // A workspace projection may render in the same task as the input event.
  // The uncontrolled query must retain the visible text before submission.
  await expect(input).toHaveValue(query);
  await dialog.getByRole("button", { name: "Rechercher", exact: true }).click();
  return dialog;
}

test.describe("workspace search (US1)", () => {
  test("finds ranked titles, page text and files, opens an identity, and explains no result", async ({
    page,
  }) => {
    await openWorkspace(page);
    const token = uniqueName("search");
    const rankPhrase = `priorite ${token}`;
    const titlePage = `Architecture résiliente ${rankPhrase}`;
    const bodyPage = uniqueName("Notes");
    const fileName = `${uniqueName("manuel")}.txt`;
    const bodyPhrase = `reprise atomique ${rankPhrase}`;
    const symbolPage = `Décisions 🧠 ${token}`;

    await createRootItem(page, "page", titlePage);
    await createRootItem(page, "page", bodyPage);
    await createRootItem(page, "page", symbolPage);
    await waitForSynchronized(page);

    await selectItem(page, bodyPage);
    await typeIntoEditor(page, bodyPhrase);
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);
    await openPageAttachments(page, bodyPage);

    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("search fixture"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 15_000 });

    let dialog = await searchFor(page, `architecture resiliente ${rankPhrase}`);
    const titleResult = dialog.getByRole("listitem").filter({ hasText: titlePage });
    await expect(titleResult).toBeVisible();
    await expect(titleResult).toContainText("Pages");
    await titleResult.getByRole("button").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(`tree-item-${titlePage}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    dialog = await searchFor(page, bodyPhrase);
    const bodyResult = dialog.getByRole("listitem").filter({ hasText: bodyPage });
    await expect(bodyResult).toBeVisible();
    await expect(bodyResult).toContainText(bodyPhrase);
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    dialog = await searchFor(page, "🧠");
    await expect(dialog.getByRole("listitem").filter({ hasText: symbolPage })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    dialog = await searchFor(page, fileName);
    const fileResult = dialog.getByRole("listitem").filter({ hasText: fileName });
    await expect(fileResult).toBeVisible();
    await expect(fileResult).toContainText("Fichiers");
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    dialog = await searchFor(page, rankPhrase);
    const ranked = dialog.getByRole("listitem");
    await expect(ranked.first()).toContainText(titlePage);
    await expect(ranked.nth(1)).toContainText(bodyPage);
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    const missing = `${token}-absent`;
    dialog = await searchFor(page, missing);
    await expect(dialog.getByText("Aucun résultat dans l’espace de travail.")).toBeVisible();
    await expect(dialog.getByLabel("Recherche", { exact: true })).toHaveValue(missing);
  });

  test("accepts 512 Unicode characters and explicitly refuses the 513th", async ({ page }) => {
    await openWorkspace(page);
    let dialog = await openSearch(page);
    const query = dialog.getByLabel("Recherche", { exact: true });
    const uniquePrefix = uniqueName("unicode-boundary");
    const accepted = `${uniquePrefix}${"🧠".repeat(512 - Array.from(uniquePrefix).length)}`;
    await query.fill(accepted);
    await expect(query).toHaveValue(accepted);
    await dialog.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(dialog.getByText("Aucun résultat dans l’espace de travail.")).toBeVisible();

    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();
    dialog = await openSearch(page);
    const rejected = `${accepted}🧠`;
    await dialog.getByLabel("Recherche", { exact: true }).fill(rejected);
    await dialog.getByRole("button", { name: "Rechercher", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "La recherche est limitée à 512 caractères Unicode.",
    );
    await expect(dialog.getByLabel("Recherche", { exact: true })).toHaveValue(rejected);
  });
});

test.describe("workspace search refinement (US3)", () => {
  test("filters by type and current branch and remains keyboard-operable at narrow widths", async ({
    page,
  }) => {
    await openWorkspace(page);
    const token = uniqueName("refine");
    const branch = `Branch ${token}`;
    const inside = `Inside page ${token}`;
    const outside = `Outside page ${token}`;
    await createRootItem(page, "folder", branch);
    await createChildItem(page, branch, "page", inside);
    await createRootItem(page, "page", outside);
    await waitForSynchronized(page);

    let dialog = await searchFor(page, token);
    await expect(dialog.getByRole("listitem")).toHaveCount(3);

    const query = dialog.getByLabel("Recherche", { exact: true });
    await query.focus();
    await page.keyboard.press("ArrowDown");
    const resultButtons = dialog.locator("[data-search-result]");
    await expect(resultButtons.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(resultButtons.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    await ensureNavigationVisible(page);
    const searchTrigger = page.getByRole("button", { name: /Rechercher.*⌘ K/u });
    await searchTrigger.focus();
    dialog = await searchFor(page, token);
    await dialog.getByLabel("Dossiers").uncheck();
    await dialog.getByLabel("Fichiers").uncheck();
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(
      dialog.locator(".search-result__title").getByText(branch, { exact: true }),
    ).toHaveCount(0);

    await dialog.getByRole("button", { name: "Réinitialiser les filtres" }).click();
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await dialog.getByLabel("Branch").selectOption({ label: branch });
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByRole("listitem").filter({ hasText: inside })).toBeVisible();
    await expect(dialog.getByRole("listitem").filter({ hasText: outside })).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 720 });
    await expect(dialog.getByLabel("Recherche", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Branch")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Fermer la recherche" })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(24);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // The desktop search control was replaced when the layout crossed the
    // mobile breakpoint, so focus returns to the visible navigation trigger.
    await expect(page.getByTestId("toggle-tree")).toBeFocused();
  });

  test("loads an opaque next page without losing the selected result", async ({ page }) => {
    const query = uniqueName("paged");
    const firstId = "018f0000-0000-7000-8000-000000000601";
    const secondId = "018f0000-0000-7000-8000-000000000602";
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/v1/search", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as Record<string, unknown>;
      requests.push(body);
      const isNextPage = body["cursor"] === "opaque-next-page";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          coverage: "complete",
          generation: 7,
          results: [
            {
              itemId: isNextPage ? secondId : firstId,
              revisionId: isNextPage
                ? "018f0000-0000-7000-8000-000000000612"
                : "018f0000-0000-7000-8000-000000000611",
              kind: isNextPage ? "folder" : "page",
              title: isNextPage ? "Second page" : "First page",
              path: [],
              matchedField: "title",
              propertyId: null,
              propertyName: null,
              snippet: null,
              conflict: false,
            },
          ],
          nextCursor: isNextPage ? null : "opaque-next-page",
        }),
      });
    });

    await openWorkspace(page);
    const dialog = await searchFor(page, query);
    await expect(dialog.getByRole("listitem")).toHaveCount(1);
    const first = dialog.getByRole("button", { name: /First page/u });
    await first.focus();
    await expect(first).toHaveAttribute("aria-current", "true");
    await dialog.getByRole("button", { name: "Afficher plus de résultats" }).click();

    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByText("Second page", { exact: true })).toBeVisible();
    await expect(first).toHaveAttribute("aria-current", "true");
    expect(requests).toEqual([
      { query, limit: 20 },
      { query, limit: 20, cursor: "opaque-next-page" },
    ]);
  });
});

test.describe("workspace search freshness (US4)", () => {
  test("propagates an accepted identity into search on another connected device", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      await Promise.all([openWorkspace(page), openWorkspace(second.page)]);
      // Open navigation during setup, before the remote write. The watching
      // device remains untouched until the new identity has propagated.
      await ensureNavigationVisible(second.page);
      const name = uniqueName("second-device-search");
      const startedAt = performance.now();

      await createRootItem(page, "page", name);
      await waitForSynchronized(page);
      await expect(second.page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });

      const dialog = await searchFor(second.page, name);
      const result = dialog.getByRole("listitem").filter({ hasText: name });
      await expect(result).toHaveCount(1);
      const resultButton = result.getByRole("button");
      await expect(resultButton).toHaveAttribute(
        "id",
        /^search-result-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      const propagationMilliseconds = performance.now() - startedAt;
      await testInfo.attach("second-device-search-propagation.json", {
        body: Buffer.from(JSON.stringify({ propagationMilliseconds })),
        contentType: "application/json",
      });

      await resultButton.click();
      await expect(second.page.getByTestId(`tree-item-${name}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      await second.context.close();
    }
  });

  test("replaces stale title, path and body data across lifecycle changes", async ({ page }) => {
    await openWorkspace(page);
    const token = uniqueName("freshness");
    const destination = `Destination ${token}`;
    const oldName = `Old title ${token}`;
    const currentName = `Current title ${token}`;
    const bodyPhrase = `Body that conversion removes ${token}`;
    await createRootItem(page, "folder", destination);
    await createRootItem(page, "page", oldName);
    await waitForSynchronized(page);

    await selectItem(page, oldName);
    await typeIntoEditor(page, bodyPhrase);
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);

    let dialog = await searchFor(page, bodyPhrase);
    await expect(dialog.getByRole("listitem").filter({ hasText: oldName })).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    await renameItem(page, oldName, currentName);
    await waitForSynchronized(page);

    dialog = await searchFor(page, oldName);
    await expect(dialog.getByText("Aucun résultat dans l’espace de travail.")).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();
    dialog = await searchFor(page, currentName);
    await expect(dialog.getByRole("listitem").filter({ hasText: currentName })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    await selectItem(page, currentName);
    await moveSelectedItemInto(page, destination);
    await waitForSynchronized(page);
    dialog = await searchFor(page, currentName);
    await expect(dialog.getByRole("listitem").filter({ hasText: currentName })).toContainText(
      destination,
    );
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    await ensureNavigationVisible(page);
    await page.getByRole("button", { name: `Déplier ${destination}` }).click();
    await convertItem(page, currentName);
    const conversion = page.getByTestId("convert-confirmation");
    await expect(conversion).toBeVisible();
    await page.getByTestId("confirm-convert").click();
    // Confirmation runs an async content-preserving mutation. Opening another
    // modal before this one has closed races its final-focus restoration with
    // the search input, which is not a state an owner can intentionally reach.
    await expect(conversion).toBeHidden({ timeout: 30_000 });
    await waitForSynchronized(page);

    dialog = await searchFor(page, bodyPhrase);
    await expect(dialog.getByText("Aucun résultat dans l’espace de travail.")).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();
    dialog = await searchFor(page, currentName);
    await expect(dialog.getByRole("listitem").filter({ hasText: currentName })).toContainText(
      "Dossiers",
    );
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    await trashItem(page, currentName);
    await waitForSynchronized(page);
    dialog = await searchFor(page, currentName);
    await expect(dialog.getByText("Aucun résultat dans l’espace de travail.")).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer la recherche" }).click();

    await openSettingsSection(page, "trash");
    await page
      .getByTestId(`trash-item-${currentName}`)
      .getByRole("button", { name: "Restaurer" })
      .click();
    await returnToWorkspace(page);
    await waitForSynchronized(page);
    dialog = await searchFor(page, currentName);
    await expect(dialog.getByRole("listitem").filter({ hasText: currentName })).toHaveCount(1);
  });

  test("keeps reliable local results visible while the complete index rebuilds", async ({
    page,
  }) => {
    await openWorkspace(page);
    const token = uniqueName("rebuilding");
    await createRootItem(page, "page", token);
    await waitForSynchronized(page);
    await page.route("**/v1/search", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        headers: { "retry-after": "1" },
        body: JSON.stringify({
          type: "about:blank",
          title: "Complete search is temporarily unavailable",
          status: 503,
          code: "search.building",
          searchState: "building",
          indexedCount: 2,
          expectedCount: 3,
        }),
      });
    });

    const dialog = await searchFor(page, token);
    await expect(dialog.getByRole("listitem").filter({ hasText: token })).toBeVisible();
    await expect(dialog.getByText(/index complet est en reconstruction/i)).toBeVisible();
  });
});
