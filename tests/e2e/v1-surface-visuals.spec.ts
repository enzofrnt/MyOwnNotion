/** Controlled cross-surface references for the unified V1 visual system (T174). */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  ensureNavigationVisible,
  openRootDatabaseCreation,
  openSettingsSection,
  openWorkspace,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 412, height: 915 };
const SEARCH_REFERENCE = "Surface visuelle V1 017";

async function prepareVisualSurface(
  page: Page,
  theme: "light" | "dark",
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((preference) => {
    window.localStorage.setItem("myownnotion.theme", preference);
  }, theme);
  await openWorkspace(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // Backup tests retain deliberately stale records outside the content reset.
  // That alert has its own reference and must not make these surfaces depend
  // on suite order.
  await page.addStyleTag({ content: ".workspace-notices { display: none !important; }" });
}

async function settlePixels(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(async () => await page.evaluate(() => window.scrollY)).toBe(0);
}

test("matches the light search surface", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Chromium desktop owns deterministic desktop pixels.",
  );
  await prepareVisualSurface(page, "light", DESKTOP);
  await createRootItem(page, "page", SEARCH_REFERENCE);
  await waitForSynchronized(page);

  await page.locator(".workspace-navigation__search").click();
  const dialog = page.getByRole("dialog", { name: "Rechercher dans l’espace de travail" });
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await dialog.getByRole("textbox", { name: "Recherche" }).fill(SEARCH_REFERENCE);
  await dialog.getByRole("button", { name: "Rechercher", exact: true }).click();
  const matchingResults = dialog
    .locator("[data-search-result='true']")
    .filter({ hasText: SEARCH_REFERENCE });
  // A failed visual assertion can retry before the deleted attempt has left
  // the complete search index. Wait for that stale hit to disappear instead
  // of either capturing two rows or tripping Playwright strict mode.
  await expect(matchingResults).toHaveCount(1, { timeout: 45_000 });
  await expect(matchingResults).toBeVisible();
  await settlePixels(page);

  await expect(page).toHaveScreenshot("v1-search-light.png", {
    animations: "disabled",
    caret: "hide",
    clip: { x: 0, y: 0, ...DESKTOP },
    maxDiffPixelRatio: 0.005,
  });
});

test("matches the dark empty-database surface", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Chromium desktop owns deterministic desktop pixels.",
  );
  await prepareVisualSurface(page, "dark", DESKTOP);
  await ensureNavigationVisible(page);
  await openRootDatabaseCreation(page);
  const form = page.getByRole("form", { name: "Créer une base de données" });
  await form.getByLabel("Créer une base de données").fill("Suivi visuel");
  await form.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("active-item-title")).toHaveValue("Suivi visuel");
  await waitForDatabaseDefinitionSaved(page);
  await settlePixels(page);

  await expect(page).toHaveScreenshot("v1-database-dark.png", {
    animations: "disabled",
    caret: "hide",
    clip: { x: 0, y: 0, ...DESKTOP },
    maxDiffPixelRatio: 0.005,
  });
});

for (const [theme, section] of [
  ["light", "navigation"],
  ["dark", "security"],
] as const) {
  test(`matches the ${theme} mobile ${section} surface`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(
      testInfo.project.name !== "chromium-mobile",
      "Chromium mobile owns deterministic touch-width pixels.",
    );
    await prepareVisualSurface(page, theme, MOBILE);
    await openSettingsSection(page, section);
    await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible();
    if (section === "security") {
      await expect(page.getByTestId("security-settings")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Chargement des passkeys…")).toHaveCount(0, {
        timeout: 15_000,
      });
    } else {
      await expect(page.getByTestId("navigation-settings")).toBeVisible();
    }
    await settlePixels(page);

    await expect(page).toHaveScreenshot(`v1-${section}-${theme}-mobile.png`, {
      animations: "disabled",
      caret: "hide",
      clip: { x: 0, y: 0, ...MOBILE },
      maxDiffPixelRatio: 0.005,
    });
  });
}
