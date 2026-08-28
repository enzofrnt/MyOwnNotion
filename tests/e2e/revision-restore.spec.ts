/**
 * Retained-revision restore and stale-head conflict journeys (T080, US5).
 */
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openSecondDevice,
  openSettingsSection,
  openWorkspace,
  renameItem,
  returnToWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("revision history (US5)", () => {
  test("restores retained content as a new descendant revision", async ({ page }) => {
    await openWorkspace(page);
    const pageName = uniqueName("HistoryPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    // Select the page; note the original head.
    await selectItem(page, pageName);
    await openSettingsSection(page, "page-details");
    await expect(page.getByTestId("revision-restore")).toBeVisible();
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit the document to supersede the original revision.
    await returnToWorkspace(page);
    await typeIntoEditor(page, "version 2");
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await openSettingsSection(page, "page-details");

    // Preview and restore the superseded revision (retained 24h).
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("revision-snapshot")).toContainText(pageName);

    await page.getByTestId("restore-revision").click();
    await expect(page.getByTestId("restore-feedback")).toContainText(
      "historique existant reste inchangé",
      {
        timeout: 15_000,
      },
    );
  });

  test("a stale head yields an explicit conflict instead of silent overwrite", async ({
    page,
    browser,
    baseURL,
  }) => {
    // The stream is cut before anything else, because this journey is about a
    // head that is stale *in the interface*. With live synchronization a
    // connected tab hears the competing edit below within a second and stops
    // being stale, which is an improvement and not what is under test here.
    // Cutting only the stream leaves every other request working, so the restore
    // still reaches the server and is refused for the reason it should be.
    await page.route("**/v1/changes/stream", (route) => route.abort("connectionrefused"));

    await openWorkspace(page);
    const pageName = uniqueName("StaleHeadPage");
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);

    await selectItem(page, pageName);
    await openSettingsSection(page, "page-details");
    const originalHead = await page.getByTestId("current-head").textContent();

    // Edit once so the original head is restorable history.
    await returnToWorkspace(page);
    await typeIntoEditor(page, "v2");
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await openSettingsSection(page, "page-details");

    // Preview the original revision.
    await page.getByTestId("revision-id-input").fill(originalHead ?? "");
    await page.getByTestId("preview-revision").click();
    await expect(page.getByTestId("revision-preview")).toBeVisible();

    // A real second device advances the canonical revision head between
    // preview and restore. Operational body edits are intentionally
    // consolidated separately, so a rename is the supported mutation that
    // proves this stale-head guard without depending on unfinished history
    // consolidation work.
    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(second.page);
      await renameItem(second.page, pageName, uniqueName("RenamedElsewhere"));
      await waitForSynchronized(second.page);

      // Restore now conflicts explicitly (the first UI's head is stale).
      await page.getByTestId("restore-revision").click();
      await expect(page.getByTestId("restore-feedback")).toContainText(
        "version actuelle a changé",
        {
          timeout: 15_000,
        },
      );
    } finally {
      await second.context.close();
    }
  });
});
