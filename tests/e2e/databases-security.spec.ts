/**
 * Browser-side structured-content boundary (T104, FR-043, SC-009).
 *
 * The same recognizable strings are visible in the authorized interface but
 * absent from IndexedDB, queued offline work, request URLs, browser diagnostics
 * and technical API errors.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  createRootDatabase,
  ensureNavigationVisible,
  entryTrigger,
  openWorkspace,
  openWorkspaceDiagnostics,
  returnToWorkspace,
  waitForDatabaseDefinitionSaved,
  waitForEntryAutosave,
  waitForSynchronized,
} from "./helpers.ts";

const SENTINELS = {
  database: "BROWSER_PRIVATE_DATABASE_SENTINEL_807431",
  property: "BROWSER_PRIVATE_PROPERTY_SENTINEL_807432",
  entry: "BROWSER_PRIVATE_TASK_SENTINEL_807433",
  value: "BROWSER_PRIVATE_VALUE_SENTINEL_807434",
  offline: "BROWSER_PRIVATE_OUTBOX_SENTINEL_807435",
  error: "BROWSER_PRIVATE_ERROR_SENTINEL_807436",
} as const;

function expectNoSentinel(text: string): void {
  for (const sentinel of Object.values(SENTINELS)) expect(text).not.toContain(sentinel);
}

async function indexedDbContents(page: Page): Promise<string> {
  return await page.evaluate(
    async () =>
      await new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open("myownnotion-local");
        opening.onerror = () => reject(opening.error ?? new Error("IndexedDB did not open"));
        opening.onsuccess = () => {
          const database = opening.result;
          const storeNames = Array.from(database.objectStoreNames);
          const transaction = database.transaction(storeNames, "readonly");
          const contents: Record<string, unknown[]> = {};
          for (const storeName of storeNames) {
            const request = transaction.objectStore(storeName).getAll();
            request.onerror = () =>
              reject(request.error ?? new Error(`IndexedDB store ${storeName} was unreadable`));
            request.onsuccess = () => {
              contents[storeName] = request.result as unknown[];
            };
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(JSON.stringify(contents));
          };
          transaction.onerror = () =>
            reject(transaction.error ?? new Error("IndexedDB read failed"));
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("IndexedDB read aborted"));
        };
      }),
  );
}

async function createStructuredContent(page: Page): Promise<string> {
  await ensureNavigationVisible(page);
  await createRootDatabase(page, SENTINELS.database);
  await expect(page.getByTestId("active-item-title")).toHaveValue(SENTINELS.database, {
    timeout: 15_000,
  });
  await waitForSynchronized(page);
  const databaseRow = page.getByTestId(`tree-item-${SENTINELS.database}`);
  const databaseId = await databaseRow.getAttribute("data-item-id");
  expect(databaseId).not.toBeNull();

  await page.getByRole("button", { name: "Ajouter une propriété" }).click();
  const propertyEditor = page.getByRole("form", { name: "Éditeur de propriété" });
  await propertyEditor.getByLabel("Nom").fill(SENTINELS.property);
  await propertyEditor.getByLabel("Type").selectOption("text");
  await propertyEditor.getByRole("button", { name: "Enregistrer la propriété" }).click();
  await expect(propertyEditor).toBeHidden({ timeout: 15_000 });
  await waitForDatabaseDefinitionSaved(page);

  await createDatabaseEntry(page, SENTINELS.entry);
  const entry = entryTrigger(page, SENTINELS.entry).first();
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();
  const panel = page.locator(".entry-panel");
  await panel.getByLabel(SENTINELS.property, { exact: true }).fill(SENTINELS.value);
  await waitForEntryAutosave(page);
  return databaseId ?? "";
}

test("keeps structured content out of local storage, addresses and diagnostics", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requestUrls: string[] = [];
  const diagnostics: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("console", (message) => diagnostics.push(message.text()));
  page.on("pageerror", (error) => diagnostics.push(error.message));

  await openWorkspace(page);
  const databaseId = await createStructuredContent(page);

  // The malformed identifier forces a technical validation error while the
  // private value remains only in the body, never in the address.
  const error = await page.evaluate(
    async ({ id, propertyId, sentinel }) => {
      const { csrfToken } = await (await fetch("/v1/auth/session")).json();
      const response = await fetch(`/v1/databases/${id}/entries`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-myownnotion-client-protocol": "2",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          id: sentinel,
          title: sentinel,
          placement: { id: crypto.randomUUID(), parentItemId: id, positionKey: "z" },
          values: { [propertyId]: { kind: "text", value: sentinel } },
          relationTargets: {},
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    { id: databaseId, propertyId: crypto.randomUUID(), sentinel: SENTINELS.error },
  );
  expect(error.status).toBe(400);
  expectNoSentinel(error.body);

  const onlineStorage = await indexedDbContents(page);
  expectNoSentinel(onlineStorage);
  expect(onlineStorage).toContain("sealedDefinition");
  expect(onlineStorage).toContain("sealedValues");

  // Keep one edit queued to prove the outbox itself is sealed, not merely
  // absent because synchronization happened quickly.
  await page.context().route("**/v1/**", (route) => route.abort("connectionrefused"));
  const panel = page.locator(".entry-panel");
  await panel.getByLabel(SENTINELS.property, { exact: true }).fill(SENTINELS.offline);
  await waitForEntryAutosave(page, { synchronize: false });
  await openWorkspaceDiagnostics(page);
  await expect(page.getByTestId("pending-mutations")).toContainText(
    "database.entry.values.replace",
  );
  await returnToWorkspace(page);
  await expect(panel.getByLabel(SENTINELS.property, { exact: true })).toHaveValue(
    SENTINELS.offline,
  );

  const offlineStorage = await indexedDbContents(page);
  expectNoSentinel(offlineStorage);
  expect(offlineStorage).toContain("sealedPayload");
  expectNoSentinel(page.url());
  expectNoSentinel(requestUrls.join("\n"));
  expectNoSentinel(diagnostics.join("\n"));
});
