/**
 * Controlled light/dark shell references and contextual-layout stability
 * (T053, US1).
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  openWorkspace,
  selectItem,
  waitForSynchronized,
} from "./helpers.ts";

const VIEWPORT = { width: 1280, height: 720 };

async function prepareReference(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((preference) => {
    window.localStorage.setItem("myownnotion.theme", preference);
  }, theme);
  await openWorkspace(page);
  await createRootItem(page, "folder", "Projets");
  await createChildItem(page, "Projets", "page", "Feuille de route");
  await selectItem(page, "Feuille de route");
  await waitForSynchronized(page);
  await expect(page.getByTestId("live-connection-state")).toHaveAttribute("data-state", "live", {
    timeout: 15_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(async () => await document.fonts.ready);
  // Backup verification belongs to its own journey and persists across test
  // content resets. It must not move this shell reference depending on which
  // backup test happened to run earlier. The editor can also claim focus while
  // mounting and scroll the document; capture the deliberate top-of-page state.
  await page.addStyleTag({
    content: '[data-testid="workspace-backup-stale"] { display: none !important; }',
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(async () => await page.evaluate(() => window.scrollY)).toBe(0);
}

async function hoverContextualRowWithoutShift(page: Page): Promise<void> {
  const row = page.getByTestId("tree-item-Feuille de route");
  const name = row.locator(".tree-name");
  const readLayout = async () =>
    await page.evaluate(() => {
      const scroller = document.querySelector(".workspace-sidebar-panel__content");
      const item = document.querySelector('[data-testid="tree-item-Feuille de route"]');
      const group = item?.closest('[role="group"]') ?? null;
      const metrics = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return null;
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          width: box.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          scrollLeft: element.scrollLeft,
        };
      };
      const ancestors: Array<{
        readonly element: string;
        readonly metrics: ReturnType<typeof metrics>;
      }> = [];
      let ancestor = item?.parentElement ?? null;
      while (ancestor !== null && ancestors.length < 8) {
        ancestors.push({
          element: `${ancestor.tagName.toLowerCase()}.${ancestor.className}[${ancestor.getAttribute("role") ?? ""}]`,
          metrics: metrics(ancestor),
        });
        ancestor = ancestor.parentElement;
      }
      return { scroller: metrics(scroller), group: metrics(group), row: metrics(item), ancestors };
    });
  const beforeLayout = await readLayout();
  const before = await name.boundingBox();
  expect(before).not.toBeNull();

  await row.hover();
  await expect
    .poll(
      async () =>
        await page
          .getByTestId("item-actions-Feuille de route")
          .evaluate((node) => Number.parseFloat(getComputedStyle(node).opacity)),
    )
    .toBe(1);
  const after = await name.boundingBox();
  const afterLayout = await readLayout();
  expect(after).not.toBeNull();

  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs((after?.[key] ?? 0) - (before?.[key] ?? 0)),
      `${key} layout shift: ${JSON.stringify({ beforeLayout, afterLayout })}`,
    ).toBeLessThanOrEqual(1);
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`matches the controlled ${theme} shell reference`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "One controlled Chromium engine owns visual pixels; all five projects own behavior.",
    );
    await prepareReference(page, theme);
    await hoverContextualRowWithoutShift(page);

    await expect(page).toHaveScreenshot(`workspace-shell-${theme}.png`, {
      animations: "disabled",
      caret: "hide",
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      maxDiffPixelRatio: 0.005,
      mask: [
        page.getByRole("region", { name: "Item details" }),
        page.getByRole("region", { name: "Revision history" }),
      ],
    });
  });
}
