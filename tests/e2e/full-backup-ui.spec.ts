import type { FullBackupStatus } from "@myownnotion/contracts";
import { expect, test } from "./fixtures.ts";
import { openSettingsSection, openWorkspace } from "./helpers.ts";

const backupId = "018f2b7c-0000-7000-8000-000000000123";
for (const theme of ["dark", "light"] as const) {
  const width = theme === "dark" ? 320 : 1280;
  test(`complete backup settings preserve keyboard rehearsal at ${width}px in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript(
      (preference) => localStorage.setItem("myownnotion.theme", preference),
      theme,
    );
    const now = new Date().toISOString();
    let status: FullBackupStatus = {
      lastVerifiedAt: now,
      lastVerifiedBackupId: backupId,
      sourceVersion: null,
      sourceVersionLabel: "V0 — version exacte inconnue",
      remote: "failed",
      remoteVerifiedAt: null,
      latestAttemptAt: now,
      latestAttemptOutcome: "succeeded",
      lastRehearsalAt: null,
      lastRehearsalOutcome: null,
      stale: false,
      rehearsalDue: true,
    };
    await page.route("**/v1/backups/full/status", (route) => route.fulfill({ json: status }));
    let rehearsals = 0;
    await page.route("**/v1/backups/full/rehearsals", (route) => {
      rehearsals += 1;
      status = {
        ...status,
        lastRehearsalAt: new Date().toISOString(),
        lastRehearsalOutcome: rehearsals === 1 ? "failed" : "succeeded",
        rehearsalDue: rehearsals === 1,
      };
      return route.fulfill(
        rehearsals === 1
          ? {
              status: 409,
              json: {
                type: "about:blank",
                title: "Rehearsal failed",
                status: 409,
                code: "conflict",
                correlationId: null,
              },
            }
          : { json: { backupId, databaseRestored: true, filesVerified: 4 } },
      );
    });
    await openWorkspace(page);
    await openSettingsSection(page, "backups");
    const panel = page.getByTestId("full-backup-panel");
    await expect(panel.getByTestId("full-backup-source-version")).toHaveText(
      "V0 — version exacte inconnue",
    );
    await expect(panel.getByTestId("full-backup-remote-pending")).toContainText(
      "copie complète locale est conservée",
    );
    await expect(panel.getByTestId("full-backup-rehearsal-due")).toContainText(
      "test de restauration mensuel",
    );
    const run = panel.getByRole("button", { name: "Tester la restauration complète" });
    await run.focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("full-rehearsal-result")).toContainText(
      "n’a pas pu être vérifiée",
    );
    await expect(run).toBeEnabled();
    await expect(run).toBeFocused();
    await page.keyboard.press("Space");
    await expect(panel.getByTestId("full-rehearsal-result")).toContainText("a réussi");
    await expect(panel.getByText(/^Dernier essai :/)).toContainText("réussi");
    expect(rehearsals).toBe(2);
    await expect(run).toBeFocused();
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport + 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`full-backup-${theme}-${width}.png`),
      fullPage: true,
    });
  });
}

test("an absent complete backup stays explicit even with portable exports, and cannot trigger a rehearsal", async ({
  page,
}) => {
  await page.route("**/v1/backups/full/status", (route) =>
    route.fulfill({
      json: {
        lastVerifiedAt: null,
        lastVerifiedBackupId: null,
        sourceVersion: null,
        sourceVersionLabel: "V0 — version exacte inconnue",
        remote: null,
        remoteVerifiedAt: null,
        latestAttemptAt: new Date().toISOString(),
        latestAttemptOutcome: "unfinished",
        lastRehearsalAt: null,
        lastRehearsalOutcome: null,
        stale: true,
        rehearsalDue: true,
      } satisfies FullBackupStatus,
    }),
  );
  await openWorkspace(page);
  await openSettingsSection(page, "backups");
  const panel = page.getByTestId("full-backup-panel");
  await expect(panel.getByTestId("full-backup-local-status")).toContainText("26 dernières heures");
  await expect(panel.getByTestId("full-backup-attempt")).toContainText(
    "n’a pas enregistré de résultat",
  );
  await expect(panel.getByTestId("full-backup-rehearsal-due")).toContainText(
    "test de restauration mensuel",
  );
  await expect(panel.getByTestId("run-full-rehearsal")).toBeDisabled();
});
