/**
 * Structured databases remain honest across offline work and two devices
 * (feature 009, US5, SC-004).
 *
 * The propagation target is measured and attached rather than asserted from a
 * single UI-driven sample: SC-004 is a p95 requirement, while this journey also
 * includes browser interaction and rendering outside the synchronization
 * latency itself. The performance suite owns the percentile assertion.
 */
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  closeMobileNavigation,
  ensureNavigationVisible,
  openRootDatabaseCreation,
  openSecondDevice,
  openWorkspace,
  openWorkspaceDiagnostics,
  returnToWorkspace,
  saveEntryProperties,
  selectItem,
  uniqueName,
  waitForDatabaseDefinitionIdle,
  waitForDatabaseDefinitionSaved,
  waitForSynchronized,
} from "./helpers.ts";

async function goOffline(page: Page): Promise<void> {
  await page.context().route("**/v1/**", (route) => route.abort("connectionrefused"));
  await page.context().route("**/health", (route) => route.abort("connectionrefused"));
  const apiIsBlocked = await page.evaluate(async () => {
    try {
      await fetch("/health");
      return false;
    } catch {
      return true;
    }
  });
  expect(apiIsBlocked).toBe(true);
}

async function goOnline(page: Page): Promise<void> {
  await page.context().unroute("**/v1/**");
  await page.context().unroute("**/health");
}

async function createDatabase(page: Page, name: string): Promise<void> {
  await ensureNavigationVisible(page);
  await openRootDatabaseCreation(page);
  const form = page.getByRole("form", { name: "Créer une base de données" });
  await form.getByLabel("Créer une base de données").fill(name);
  await form.getByRole("button", { name: "Créer la base de données" }).click();
  await expect(page.getByTestId("active-item-title")).toHaveValue(name, { timeout: 15_000 });
  await waitForSynchronized(page);
}

async function addTextProperty(
  page: Page,
  name: string,
  options: { readonly online?: boolean } = {},
): Promise<void> {
  await page.getByRole("button", { name: "Ajouter une propriété" }).click();
  const editor = page.getByRole("form", { name: "Éditeur de propriété" });
  await editor.getByLabel("Nom").fill(name);
  await editor.getByLabel("Type").selectOption("text");
  await editor.getByRole("button", { name: "Enregistrer la propriété" }).click();
  await expect(editor).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".database-schema").getByText(name, { exact: true })).toBeVisible();
  if (options.online === false) await waitForDatabaseDefinitionIdle(page);
  else await waitForDatabaseDefinitionSaved(page);
}

async function createEntry(page: Page, title: string): Promise<void> {
  const form = page.locator(".database-entry-create");
  const titleInput = form.getByLabel("Nouvelle entrée");
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title);
  await form.getByRole("button", { name: "Nouvelle entrée" }).click();
  await expect(page.locator("[data-entry-trigger]").filter({ hasText: title }).first()).toBeVisible(
    {
      timeout: 15_000,
    },
  );
}

async function openEntry(page: Page, title: string): Promise<void> {
  await page.locator("[data-entry-trigger]").filter({ hasText: title }).first().click();
  await expect(page.locator(".entry-panel").getByRole("heading", { name: title })).toBeVisible({
    timeout: 15_000,
  });
}

async function saveEntryValues(
  page: Page,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const panel = page.locator(".entry-panel");
  for (const [label, value] of Object.entries(values)) {
    await panel.getByLabel(label, { exact: true }).fill(value);
  }
  await saveEntryProperties(page);
}

async function closeEntry(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fermer l'entrée" }).click();
}

async function updateTextCell(
  page: Page,
  entryTitle: string,
  propertyName: string,
  value: string,
): Promise<void> {
  const cell = page
    .locator(".database-grid tbody tr")
    .filter({ hasText: entryTitle })
    .getByRole("gridcell", { name: new RegExp(`^${propertyName},`) });
  await cell.focus();
  await cell.press("F2");
  await cell.getByLabel(propertyName, { exact: true }).fill(value);
  await cell
    .getByRole("button", { name: `Enregistrer ${propertyName} pour ${entryTitle}` })
    .click();
  await expect(cell).toHaveAttribute("aria-label", `${propertyName}, ${value}`, {
    timeout: 15_000,
  });
}

function pendingCommand(page: Page, commandType: string) {
  return page.getByTestId("pending-mutations").locator("li").filter({ hasText: commandType });
}

async function openDatabaseAfterReload(page: Page, databaseName: string): Promise<void> {
  await openWorkspace(page);
  await selectItem(page, databaseName);
  await expect(page.getByTestId("active-item-title")).toHaveValue(databaseName, {
    timeout: 15_000,
  });
}

async function attachPropagationMeasurement(testInfo: TestInfo, observedMs: number): Promise<void> {
  await testInfo.attach("structured-remote-propagation.json", {
    body: JSON.stringify(
      {
        requirement: "SC-004",
        targetMs: 2_000,
        observedMs,
        withinTarget: observedMs < 2_000,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

/**
 * Simulates the recoverable eviction performed by the local storage budget.
 * Unit tests exercise the planner and its protection rules; this journey owns
 * the browser-visible consequence after a restart while the server is absent.
 */
async function releaseEntryValuesFromDevice(page: Page, entryId: string): Promise<void> {
  await page.evaluate(
    async ({ id }) =>
      await new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("myownnotion-local");
        opening.onerror = () => reject(opening.error ?? new Error("IndexedDB did not open"));
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction("databaseEntries", "readwrite");
          const store = transaction.objectStore("databaseEntries");
          const reading = store.get(id);
          reading.onerror = () =>
            reject(reading.error ?? new Error("Entry values were unreadable"));
          reading.onsuccess = () => {
            const row = reading.result as
              | { availability: string; sealedValues: unknown }
              | undefined;
            if (row === undefined) {
              reject(new Error("Entry values were not present on this device"));
              return;
            }
            row.availability = "offloaded";
            row.sealedValues = null;
            store.put(row);
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error ?? new Error("Eviction failed"));
          transaction.onabort = () => reject(transaction.error ?? new Error("Eviction aborted"));
        };
      }),
    { id: entryId },
  );
}

async function localConflictDiagnostics(page: Page): Promise<unknown> {
  return await page.evaluate(
    async () =>
      await new Promise<unknown>((resolve, reject) => {
        const opening = indexedDB.open("myownnotion-local");
        opening.onerror = () => reject(opening.error ?? new Error("IndexedDB did not open"));
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction("conflicts", "readonly");
          const request = transaction.objectStore("conflicts").getAll();
          request.onerror = () => reject(request.error ?? new Error("Conflicts were unreadable"));
          request.onsuccess = () =>
            resolve(
              (request.result as Array<Record<string, unknown>>).map((row) => {
                const structured = row["structured"] as
                  | { kind?: unknown; conflicts?: Array<{ path?: unknown; reason?: unknown }> }
                  | undefined;
                return {
                  commandType: row["commandType"],
                  errorCode: row["errorCode"],
                  baseRevisionIds: row["baseRevisionIds"],
                  competingRevisionIds: row["competingRevisionIds"],
                  structuredKind: structured?.kind,
                  conflicts: structured?.conflicts?.map(({ path, reason }) => ({ path, reason })),
                };
              }),
            );
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

test.describe("structured offline convergence (US5)", () => {
  test("survives restart, merges compatible fields, and resolves a same-field conflict", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await openWorkspace(page);
    const databaseName = uniqueName("Offline projects");
    const entryName = uniqueName("Migration");
    const offlineProperty = uniqueName("Offline detail");
    await createDatabase(page, databaseName);
    await addTextProperty(page, "Notes");
    await addTextProperty(page, "Owner");
    await createEntry(page, entryName);
    await openEntry(page, entryName);
    await saveEntryValues(page, { Notes: "common note", Owner: "common owner" });
    await waitForSynchronized(page);
    await closeEntry(page);

    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(second.page);
      await selectItem(second.page, databaseName);
      await expect(
        second.page.locator("[data-entry-trigger]").filter({ hasText: entryName }),
      ).toBeVisible({
        timeout: 15_000,
      });

      // A visible entry row proves the item arrived, not that every structured
      // value has already crossed the catch-up boundary. WebKit can render that
      // row before the value projection finishes hydrating. Establish the full
      // common baseline before deliberately disconnecting this device, or the
      // journey tests an interrupted initial download instead of offline
      // convergence from a shared ancestor.
      await openEntry(second.page, entryName);
      await expect(second.page.getByLabel("Notes", { exact: true })).toHaveValue("common note");
      await expect(second.page.getByLabel("Owner", { exact: true })).toHaveValue("common owner");
      await closeEntry(second.page);

      // Schema, saved-view and value work are all committed locally while the
      // server is unreachable, then recovered after a complete page restart.
      await goOffline(second.page);
      await addTextProperty(second.page, offlineProperty, { online: false });
      await openWorkspaceDiagnostics(second.page);
      await expect(pendingCommand(second.page, "database.definition.replace")).toHaveCount(1);
      await expect(second.page.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");
      await returnToWorkspace(second.page);
      await updateTextCell(second.page, entryName, "Notes", "local compatible note");
      await openWorkspaceDiagnostics(second.page);
      await expect(pendingCommand(second.page, "database.entry.values.replace")).toHaveCount(1);

      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);
      await expect(
        second.page.locator(".database-schema").getByText(offlineProperty, { exact: true }),
      ).toBeVisible();
      await expect(
        second.page.locator(".database-grid").getByRole("columnheader", {
          name: new RegExp(offlineProperty),
        }),
      ).toBeVisible();
      await openEntry(second.page, entryName);
      await expect(second.page.getByLabel("Notes", { exact: true })).toHaveValue(
        "local compatible note",
      );
      await expect(second.page.getByLabel("Owner", { exact: true })).toHaveValue("common owner");
      await openWorkspaceDiagnostics(second.page);
      await expect(second.page.getByTestId("pending-mutations")).toBeVisible();

      // The online device changes another stable field from the common entry
      // revision. Both edits must survive without asking the owner anything.
      await updateTextCell(page, entryName, "Owner", "remote compatible owner");
      await waitForSynchronized(page);

      await goOnline(second.page);
      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);
      try {
        await waitForSynchronized(second.page);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nStructured conflict diagnostics: ${JSON.stringify(await localConflictDiagnostics(second.page))}`,
        );
      }
      await expect(
        second.page.getByRole("heading", { name: "Résoudre le conflit de base de données" }),
      ).toHaveCount(0);
      await openEntry(second.page, entryName);
      await expect(second.page.getByLabel("Notes", { exact: true })).toHaveValue(
        "local compatible note",
      );
      await expect(second.page.getByLabel("Owner", { exact: true })).toHaveValue(
        "remote compatible owner",
      );

      // Both devices now reopen the converged revision. They then diverge on
      // the same value, so automatic reconciliation must stop and retain all
      // three versions for an explicit decision.
      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);
      await page.reload();
      await openDatabaseAfterReload(page, databaseName);

      await goOffline(second.page);
      await updateTextCell(second.page, entryName, "Notes", "local divergent note");
      await openWorkspaceDiagnostics(second.page);
      await expect(pendingCommand(second.page, "database.entry.values.replace")).toHaveCount(1);
      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);
      await openEntry(second.page, entryName);
      await expect(second.page.getByLabel("Notes", { exact: true })).toHaveValue(
        "local divergent note",
      );

      await updateTextCell(page, entryName, "Notes", "remote divergent note");
      await waitForSynchronized(page);

      await goOnline(second.page);
      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);
      const resolver = second.page.getByRole("region", {
        name: "Résoudre un conflit structuré de base de données",
      });
      await expect(resolver).toBeVisible({ timeout: 30_000 });
      const row = resolver
        .locator("tbody tr")
        .filter({ hasText: /^values\./ })
        .first();
      await expect(row.locator('[data-testid^="database-conflict-local-"]')).toContainText(
        "local divergent note",
      );
      await expect(row.locator('[data-testid^="database-conflict-ancestor-"]')).toContainText(
        "local compatible note",
      );
      await expect(row.locator('[data-testid^="database-conflict-remote-"]')).toContainText(
        "remote divergent note",
      );
      await row.getByRole("radio", { name: "Autre appareil" }).check();
      await expect(second.page.getByTestId("database-conflict-review")).toContainText(
        "remote divergent note",
      );
      await resolver.getByRole("button", { name: "Enregistrer cette résolution" }).click();
      await expect(resolver).toHaveCount(0, { timeout: 20_000 });
      await waitForSynchronized(second.page);

      await openEntry(second.page, entryName);
      await expect(second.page.getByLabel("Notes", { exact: true })).toHaveValue(
        "remote divergent note",
      );
      await expect(second.page.getByLabel("Owner", { exact: true })).toHaveValue(
        "remote compatible owner",
      );

      // A resolution is a merge commit, not an overwrite disguised as one.
      const lineage = await second.page.evaluate(async (title) => {
        const items = (await (await fetch("/v1/items")).json()) as {
          items: Array<{ name: string; currentRevisionId: string }>;
        };
        const entry = items.items.find((item) => item.name === title);
        if (entry === undefined) return [];
        const revision = (await (
          await fetch(`/v1/revisions/${entry.currentRevisionId}`)
        ).json()) as { parentRevisionIds?: string[] };
        return revision.parentRevisionIds ?? [];
      }, entryName);
      expect(lineage).toHaveLength(2);
    } finally {
      await second.context.close();
    }
  });

  test("measures live structured propagation and states partial offline coverage", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    await openWorkspace(page);
    const databaseName = uniqueName("Coverage projects");
    const entryName = uniqueName("Observable entry");
    await createDatabase(page, databaseName);
    await addTextProperty(page, "Details");
    await createEntry(page, entryName);
    await waitForSynchronized(page);

    const second = await openSecondDevice(browser, baseURL);
    try {
      await openWorkspace(second.page);
      await selectItem(second.page, databaseName);
      const watchingCell = second.page
        .locator(".database-grid tbody tr")
        .filter({ hasText: entryName })
        .getByRole("gridcell", { name: /^Details,/ });
      await expect(watchingCell).toBeVisible({ timeout: 15_000 });

      const editingCell = page
        .locator(".database-grid tbody tr")
        .filter({ hasText: entryName })
        .getByRole("gridcell", { name: /^Details,/ });
      await editingCell.focus();
      await editingCell.press("F2");
      await editingCell.getByLabel("Details", { exact: true }).fill("propagated value");
      const startedAt = Date.now();
      await editingCell
        .getByRole("button", { name: `Enregistrer Details pour ${entryName}` })
        .click();
      await expect(watchingCell).toHaveAttribute("aria-label", "Details, propagated value", {
        timeout: 15_000,
      });
      await attachPropagationMeasurement(testInfo, Date.now() - startedAt);

      const entryId = await second.page
        .locator("[data-entry-trigger]")
        .filter({ hasText: entryName })
        .first()
        .getAttribute("data-entry-trigger");
      expect(entryId).not.toBeNull();
      await goOffline(second.page);
      await releaseEntryValuesFromDevice(second.page, entryId as string);
      await second.page.reload();
      await openDatabaseAfterReload(second.page, databaseName);

      // Membership and identity remain visible, but values and completeness do
      // not pretend to be available while the server cannot fill the gap.
      await ensureNavigationVisible(second.page);
      const expandDatabase = second.page.getByRole("button", {
        name: `Déplier ${databaseName}`,
        exact: true,
      });
      if (await expandDatabase.isVisible()) await expandDatabase.click();
      await expect(second.page.getByTestId(`tree-item-${entryName}`)).toBeVisible();
      await closeMobileNavigation(second.page);
      await expect(second.page.getByText("Données locales partielles : 0 sur 1")).toBeVisible();
      await expect(
        second.page.getByText("Aucune entrée dans les données disponibles sur cet appareil."),
      ).toBeVisible();
    } finally {
      await second.context.close();
    }
  });
});
