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
  createChildItem,
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
  await expect(dialog.getByLabel("Query")).toBeFocused();
  return dialog;
}

async function searchFor(page: Page, query: string) {
  const dialog = await openSearch(page);
  await dialog.getByLabel("Query").fill(query);
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
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

    await createRootItem(page, "page", titlePage);
    await createRootItem(page, "page", bodyPage);
    await waitForSynchronized(page);

    await selectItem(page, bodyPage);
    await typeIntoEditor(page, bodyPhrase);
    await saveDocument(page);
    await waitForSynchronized(page);

    await page.getByTestId("attachment-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("search fixture"),
    });
    await expect(page.getByTestId(`attachment-${fileName}`)).toBeVisible({ timeout: 15_000 });

    let dialog = await searchFor(page, `architecture resiliente ${rankPhrase}`);
    const titleResult = dialog.getByRole("listitem").filter({ hasText: titlePage });
    await expect(titleResult).toBeVisible();
    await expect(titleResult).toContainText("page");
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
    await dialog.getByRole("button", { name: "Close search" }).click();

    dialog = await searchFor(page, fileName);
    const fileResult = dialog.getByRole("listitem").filter({ hasText: fileName });
    await expect(fileResult).toBeVisible();
    await expect(fileResult).toContainText("file");
    await dialog.getByRole("button", { name: "Close search" }).click();

    dialog = await searchFor(page, rankPhrase);
    const ranked = dialog.getByRole("listitem");
    await expect(ranked.first()).toContainText(titlePage);
    await expect(ranked.nth(1)).toContainText(bodyPage);
    await dialog.getByRole("button", { name: "Close search" }).click();

    const missing = `${token}-absent`;
    dialog = await searchFor(page, missing);
    await expect(dialog.getByText("No result in the complete workspace.")).toBeVisible();
    await expect(dialog.getByLabel("Query")).toHaveValue(missing);
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

    const query = dialog.getByLabel("Query");
    await query.focus();
    await page.keyboard.press("ArrowDown");
    const resultButtons = dialog.locator("[data-search-result]");
    await expect(resultButtons.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(resultButtons.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    const searchTrigger = page.getByRole("button", { name: /Search Ctrl\/⌘ K/u });
    await searchTrigger.focus();
    dialog = await searchFor(page, token);
    await dialog.getByLabel("Folders").uncheck();
    await dialog.getByLabel("Files").uncheck();
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(
      dialog.locator(".search-result__title").getByText(branch, { exact: true }),
    ).toHaveCount(0);

    await dialog.getByRole("button", { name: "Reset filters" }).click();
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await dialog.getByLabel("Branch").selectOption({ label: branch });
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByRole("listitem").filter({ hasText: inside })).toBeVisible();
    await expect(dialog.getByRole("listitem").filter({ hasText: outside })).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 720 });
    await expect(dialog.getByLabel("Query")).toBeVisible();
    await expect(dialog.getByLabel("Branch")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close search" })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(24);

    await page.setViewportSize({ width: 640, height: 720 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(dialog.getByLabel("Query")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close search" })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(24);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(searchTrigger).toBeFocused();
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
    await dialog.getByRole("button", { name: "Load more results" }).click();

    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByText("Second page", { exact: true })).toBeVisible();
    await expect(first).toHaveAttribute("aria-current", "true");
    expect(requests).toEqual([
      { query, limit: 20 },
      { query, limit: 20, cursor: "opaque-next-page" },
    ]);
  });
});
