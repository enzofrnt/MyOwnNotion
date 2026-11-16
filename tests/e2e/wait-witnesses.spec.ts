/**
 * The wait witnesses can fail, and resolve only after the real commit (feature 060).
 *
 * A witness that cannot fail certifies nothing. These journeys inject the
 * missing precondition — the write is aborted inside its own IndexedDB
 * transaction — and require the witness to report it, then check that a
 * successful witness resolved after the transaction's `complete` event, not
 * after the React state that announced the change.
 */
import { expect, test } from "./fixtures.ts";
import {
  createDatabaseEntry,
  createRootDatabase,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";
import {
  beginDefinitionChange,
  beginEntryChange,
  expectNavigationPersisted,
  itemIdByName,
} from "./waits/local-state.ts";

/** Aborts, inside its own transaction, any navigation write naming `window.__abortNavigationTo`. */
function installNavigationWriteProbe(): void {
  const put = IDBObjectStore.prototype.put;
  const state = window as unknown as {
    __abortNavigationTo?: string;
    __navigationCommits?: Array<{ readonly id: string | null; readonly at: number }>;
  };
  state.__navigationCommits = [];
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    const record = value as { key?: unknown; value?: { lastVisitedItemId?: string | null } };
    if (this.name === "meta" && record.key === "navigation-state") {
      const id = record.value?.lastVisitedItemId ?? null;
      const transaction = this.transaction;
      if (id !== null && id === state.__abortNavigationTo) {
        transaction.abort();
      } else {
        transaction.addEventListener("complete", () => {
          state.__navigationCommits?.push({ id, at: performance.now() });
        });
      }
    }
    return request;
  } as typeof put;
}

test("the navigation witness fails when the selection is never committed", async ({ page }) => {
  await page.addInitScript(installNavigationWriteProbe);
  const first = uniqueName("WitnessFirst");
  const target = uniqueName("WitnessNeverCommitted");
  await openWorkspace(page);
  await createRootItem(page, "page", first);
  await createRootItem(page, "page", target);
  await waitForSynchronized(page);
  await selectItem(page, first);
  await expectNavigationPersisted(page, { lastVisited: first });

  const targetId = await itemIdByName(page, target);
  await page.evaluate((id) => {
    (window as unknown as { __abortNavigationTo?: string }).__abortNavigationTo = id;
  }, targetId);
  await selectItem(page, target);
  // The screen shows the selection; the device never wrote it.
  await expect(page.getByTestId("active-item-title")).toHaveValue(target);
  const failure = await expectNavigationPersisted(page, { lastVisited: target }).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  expect(failure).toContain(`the device committed its navigation state`);
  expect(failure).toContain(target);
});

test("the navigation witness resolves after the write's transaction completes", async ({
  page,
}) => {
  await page.addInitScript(installNavigationWriteProbe);
  const first = uniqueName("WitnessOrderFirst");
  const target = uniqueName("WitnessOrderTarget");
  await openWorkspace(page);
  await createRootItem(page, "page", first);
  await createRootItem(page, "page", target);
  await waitForSynchronized(page);
  await selectItem(page, first);
  await expectNavigationPersisted(page, { lastVisited: first });

  const targetId = await itemIdByName(page, target);
  await selectItem(page, target);
  await expectNavigationPersisted(page, { lastVisited: target });
  const resolvedAt = await page.evaluate(() => performance.now());
  const commits = await page.evaluate(
    () =>
      (window as unknown as { __navigationCommits?: Array<{ id: string | null; at: number }> })
        .__navigationCommits ?? [],
  );
  const committed = commits.find((commit) => commit.id === targetId);
  expect(committed, "the target selection was committed by its own transaction").toBeDefined();
  expect(committed?.at ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(resolvedAt);
});

test("the definition and entry witnesses fail when the gesture wrote nothing", async ({ page }) => {
  const database = uniqueName("WitnessDatabase");
  const entry = uniqueName("WitnessEntry");
  await openWorkspace(page);
  await createRootDatabase(page, database);
  await createDatabaseEntry(page, entry);
  await waitForSynchronized(page);

  // No gesture between capture and wait: a witness that resolved here would
  // certify any later step, which is what an `idle` state used to do.
  const definition = await beginDefinitionChange(page, database);
  const values = await beginEntryChange(page, entry);
  const [definitionFailure, entryFailure] = await Promise.all(
    [definition.committed(), values.committed()].map((wait) =>
      wait.then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    ),
  );
  expect(definitionFailure).toContain(`new definition or presentation revision of "${database}"`);
  expect(entryFailure).toContain(`new value version of entry "${entry}"`);
});
