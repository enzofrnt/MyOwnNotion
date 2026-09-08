import { AxeBuilder } from "@axe-core/playwright";
import { launchDesktopElectron } from "./desktop-electron.ts";
import { applyDesktopJourneySkip } from "./desktop-skip.ts";
import { openDesktopWorkspace } from "./desktop-workspace.ts";
import { expect, test } from "./fixtures.ts";
import { createRootItem, openSettingsSection } from "./helpers.ts";

applyDesktopJourneySkip();
// Electron cannot create Playwright's blank aggregation tab. Its renderer
// forbids foreign frames, so axe.run in the existing frame covers the full UI.

test("onboarding preserves keyboard focus and has no serious accessibility violations", async () => {
  const session = await launchDesktopElectron();
  try {
    const page = session.window;
    const url = page.getByLabel("Adresse du serveur");
    await expect(url).toBeVisible();
    await url.focus();
    await expect(url).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Continuer" })).toBeFocused();
    const report = await new AxeBuilder({ page }).setLegacyMode().analyze();
    expect(
      report.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  } finally {
    await session.close();
  }
});

test("workspace and security including native update controls have no serious accessibility violations", async ({
  baseURL,
  freshContent,
}) => {
  if (!baseURL) throw new Error("Missing test server");
  const { session, page } = await openDesktopWorkspace(baseURL, freshContent.cookies);
  try {
    await createRootItem(page, "page", "Desktop accessibility page");
    for (const destination of ["workspace", "security"] as const) {
      if (destination === "security") {
        await openSettingsSection(page, "security");
        await expect(page.getByTestId("desktop-update-panel")).toBeVisible();
        const check = page.getByRole("button", { name: "Vérifier les mises à jour" });
        await check.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(check).toBeFocused();
        expect(await check.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
          "none",
        );
      }
      const report = await new AxeBuilder({ page }).setLegacyMode().analyze();
      expect(
        report.violations.filter((violation) =>
          ["serious", "critical"].includes(violation.impact ?? ""),
        ),
        destination,
      ).toEqual([]);
    }
  } finally {
    await session.close();
  }
});
