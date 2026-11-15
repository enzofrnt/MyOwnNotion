/**
 * Witnesses read from the device's committed local state (feature 060).
 *
 * Every reader here opens a fresh IndexedDB read through the application's own
 * service. IndexedDB orders a read after any read-write transaction on the
 * same store that was created before it, so a value returned here has been
 * committed: it cannot be React state that has not been written yet, and it
 * cannot be missed the way a transient event can. See
 * `docs/testing/wait-contracts.md` for the rule these helpers implement.
 */
import { expect, type Page } from "@playwright/test";
import type {} from "../helpers.ts";

interface PresentationRecord {
  readonly lastVisitedItemId: string | null;
  readonly openTabIds: readonly string[];
  readonly expandedItemIds: readonly string[];
  readonly sidebarOpen: boolean;
}

/** The identity of the one active item with this (unique) name, from the committed projection. */
export async function itemIdByName(page: Page, name: string): Promise<string> {
  let found: string | null = null;
  await expect
    .poll(
      async () => {
        found = await page.evaluate(async (wanted) => {
          const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
          if (service === undefined)
            throw new Error("the E2E build exposes no local content service");
          const matches = (await service.listActiveItems()).filter((item) => item.name === wanted);
          return matches.length === 1 ? (matches[0]?.id ?? null) : null;
        }, name);
        return found;
      },
      { message: `exactly one committed item is named "${name}"`, timeout: 15_000 },
    )
    .not.toBeNull();
  return found as unknown as string;
}

/** The committed `navigation-state` record, or `null` before the first write. */
export async function readPresentation(page: Page): Promise<PresentationRecord | null> {
  return await page.evaluate(async () => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    if (service === undefined) throw new Error("the E2E build exposes no local content service");
    const row = await service.db.meta.get("navigation-state");
    return (row?.value ?? null) as PresentationRecord | null;
  });
}

/**
 * Resolves once the device has committed this navigation choice.
 *
 * Use it before closing, reloading or restarting a page whose next boot must
 * restore the selection or the tabs. A rendered title or `aria-current` is the
 * intent; this is the write the next boot will read.
 */
export async function expectNavigationPersisted(
  page: Page,
  expected: {
    readonly lastVisited?: string;
    /** Exactly these tabs, in strip order. */
    readonly openTabs?: readonly string[];
    /** These tabs at least, in any position. */
    readonly openTabsInclude?: readonly string[];
  },
): Promise<void> {
  const lastVisitedId =
    expected.lastVisited === undefined ? undefined : await itemIdByName(page, expected.lastVisited);
  const tabIds =
    expected.openTabs === undefined
      ? undefined
      : await Promise.all(expected.openTabs.map((name) => itemIdByName(page, name)));
  const includedIds =
    expected.openTabsInclude === undefined
      ? undefined
      : await Promise.all(expected.openTabsInclude.map((name) => itemIdByName(page, name)));
  await expect
    .poll(
      async () => {
        const record = await readPresentation(page);
        return {
          ...(lastVisitedId === undefined
            ? {}
            : { lastVisited: record?.lastVisitedItemId ?? null }),
          ...(tabIds === undefined ? {} : { openTabs: [...(record?.openTabIds ?? [])] }),
          ...(includedIds === undefined
            ? {}
            : { openTabsInclude: includedIds.filter((id) => record?.openTabIds.includes(id)) }),
        };
      },
      {
        message: `the device committed its navigation state ${JSON.stringify(expected)}`,
        timeout: 10_000,
      },
    )
    .toEqual({
      ...(lastVisitedId === undefined ? {} : { lastVisited: lastVisitedId }),
      ...(tabIds === undefined ? {} : { openTabs: tabIds }),
      ...(includedIds === undefined ? {} : { openTabsInclude: includedIds }),
    });
}

async function definitionMarker(page: Page, databaseName: string): Promise<string> {
  const itemId = await itemIdByName(page, databaseName);
  const marker = await page.evaluate(async (itemId) => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    if (service === undefined) throw new Error("the E2E build exposes no local content service");
    const row = (await service.listDatabases()).find((candidate) => candidate.itemId === itemId);
    return row === undefined
      ? null
      : [
          row.definitionVersion,
          row.definitionRevisionId ?? "",
          row.presentationVersion ?? 0,
          row.presentationRevisionId ?? "",
        ].join(":");
  }, itemId);
  if (marker === null) throw new Error(`no committed database is named "${databaseName}"`);
  return marker;
}

/**
 * Captures a database's committed definition and presentation revision before
 * a schema or view gesture, and returns the wait for the revision it produces.
 *
 * Definition and presentation edits go through `service.mutate`, which commits
 * the projection and its outbox row in one transaction. A changed revision is
 * therefore proof that this gesture's write is durable and queued; an idle
 * `data-definition-state` is not, because a gesture that never reached the
 * writer leaves the page just as idle.
 */
export async function beginDefinitionChange(
  page: Page,
  databaseName: string,
): Promise<{ readonly committed: () => Promise<void> }> {
  const before = await definitionMarker(page, databaseName);
  return {
    committed: async () => {
      await expect
        .poll(async () => await definitionMarker(page, databaseName), {
          message: `the gesture committed a new definition or presentation revision of "${databaseName}"`,
          timeout: 15_000,
        })
        .not.toBe(before);
    },
  };
}

/**
 * Resolves once the committed projection holds this item with this kind.
 *
 * A conversion goes through `service.mutate`, so the committed kind is written
 * with its outbox row; a pressed selector button is only the request.
 */
export async function expectItemKind(page: Page, name: string, kind: string): Promise<void> {
  const itemId = await itemIdByName(page, name);
  await expect
    .poll(
      async () =>
        await page.evaluate(
          async (id) =>
            (await window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.().getItem(id))?.kind ?? null,
          itemId,
        ),
      { message: `the committed item "${name}" is a ${kind}`, timeout: 15_000 },
    )
    .toBe(kind);
}

/**
 * Resolves once the committed projection of the named item carries this field
 * value. Item fields change through `service.mutate`, which commits them with
 * their outbox row, so a following `waitForSynchronized` is correlated.
 */
export async function expectCommittedItemField(
  page: Page,
  name: string,
  field: string,
  value: unknown,
): Promise<void> {
  const itemId = await itemIdByName(page, name);
  await expect
    .poll(
      async () =>
        await page.evaluate(
          async ({ id, field }) => {
            const item = (await window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.().getItem(id)) as
              | Record<string, unknown>
              | null
              | undefined;
            return item?.[field] ?? null;
          },
          { id: itemId, field },
        ),
      {
        message: `the committed item "${name}" has ${field} = ${JSON.stringify(value)}`,
        timeout: 15_000,
      },
    )
    .toEqual(value);
}

async function entryValueVersion(page: Page, entryItemId: string): Promise<number | null> {
  return await page.evaluate(
    async (id) =>
      (await window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.().getDatabaseEntry(id))?.valueVersion ??
      null,
    entryItemId,
  );
}

/**
 * Captures an entry's committed value version before a value gesture, and
 * returns the wait for the version that gesture produces.
 *
 * `valueVersion` is written by the same transaction as the entry's outbox row,
 * so a higher version proves this gesture's values are durable and queued. A
 * cell label, a panel field or `data-save-state` may still show the optimistic
 * draft, or a "saved" left over from an earlier write.
 */
export async function beginEntryChange(
  page: Page,
  entryTitle: string,
): Promise<{ readonly committed: () => Promise<void> }> {
  const entryItemId = await itemIdByName(page, entryTitle);
  const before = await entryValueVersion(page, entryItemId);
  if (before === null) throw new Error(`"${entryTitle}" is not a committed database entry`);
  return {
    committed: async () => {
      await expect
        .poll(async () => (await entryValueVersion(page, entryItemId)) ?? -1, {
          message: `the gesture committed a new value version of entry "${entryTitle}"`,
          timeout: 15_000,
        })
        .toBeGreaterThan(before);
    },
  };
}

/**
 * How many committed active items carry exactly this name, or `null` in a
 * runtime that does not expose the local service: the packaged desktop
 * application is a production build, so its journeys cannot read local state.
 */
export async function committedNameCount(page: Page, name: string): Promise<number | null> {
  return await page.evaluate(async (wanted) => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    if (service === undefined) return null;
    return (await service.listActiveItems()).filter((item) => item.name === wanted).length;
  }, name);
}

/**
 * Resolves once one more committed item carries `name` than before the gesture.
 *
 * Counting rather than looking up keeps the witness correct when a journey
 * deliberately creates two items with the same name.
 */
export async function expectCommittedNameCount(
  page: Page,
  name: string,
  atLeast: number,
): Promise<void> {
  if ((await committedNameCount(page, name)) === null) {
    throw new Error("the E2E build exposes no local content service");
  }
  await expect
    .poll(async () => await committedNameCount(page, name), {
      message: `the device committed an item named "${name}"`,
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(atLeast);
}
