/** Historical browser state heals without a manual “replace this file” decision. */

import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  createRootItem,
  openWorkspace,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test("five retained page conflicts self-heal while persistent storage remains a separate advisory", async ({
  page,
  context,
  request,
}) => {
  await context.addInitScript(() => {
    if (navigator.storage === undefined) return;
    Object.defineProperty(navigator.storage, "persisted", {
      configurable: true,
      value: async () => false,
    });
    Object.defineProperty(navigator.storage, "persist", {
      configurable: true,
      value: async () => false,
    });
  });

  await openWorkspace(page);
  const pages: Array<{ id: string; name: string; text: string }> = [];
  for (let index = 1; index <= 5; index += 1) {
    const name = uniqueName(`AncienBrouillon${index}`);
    const text = `brouillon hors ligne récupéré ${index} — ${name}`;
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    const id = await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id");
    if (id === null) throw new Error(`the historical page ${index} has no stable identity`);
    pages.push({ id, name, text });
  }

  await context.setOffline(true);
  const seeded = await page.evaluate(async (fixtures) => {
    const modulePath = "/src/services/local-content.ts";
    const loaded = (await import(/* @vite-ignore */ modulePath)) as {
      localContent(): {
        synchronize(): Promise<string>;
        getItem(itemId: string): Promise<{
          currentRevisionId: string;
          kind: string;
        } | null>;
        mutate(
          commandType: string,
          payload: Record<string, unknown>,
          baseRevisionIds: string[],
        ): Promise<{ ok: true } | { ok: false; error: { code: string } }>;
        outbox: {
          all(): Promise<
            Array<{
              mutationId: string;
              commandType: string;
              payload: Record<string, unknown>;
            }>
          >;
          captureConflict(
            mutationId: string,
            competingRevisionIds: string[],
            errorCode: string,
          ): Promise<void>;
        };
        db: {
          legacySyncRecoveries: { clear(): Promise<void> };
        };
      };
    };
    const service = loaded.localContent();
    const originalSynchronize = service.synchronize.bind(service);
    Object.defineProperty(service, "synchronize", {
      configurable: true,
      value: async () => "offline",
    });
    const mutationIds: string[] = [];
    try {
      for (const fixture of fixtures) {
        const item = await service.getItem(fixture.id);
        if (item === null || item.kind !== "page") throw new Error("historical page missing");
        const baseRevisionId = item.currentRevisionId;
        const result = await service.mutate(
          "page.document.replace",
          {
            itemId: fixture.id,
            baseRevisionId,
            document: {
              format: "myownnotion.document+json",
              formatVersion: 2,
              body: {
                blocks: [
                  {
                    id: crypto.randomUUID(),
                    type: "paragraph",
                    content: [{ text: fixture.text }],
                  },
                ],
              },
            },
            pageLinkTargetIds: [],
          },
          [baseRevisionId],
        );
        if (!result.ok) throw new Error(`local legacy write failed: ${result.error.code}`);
        const queued = (await service.outbox.all()).find(
          (row) =>
            row.commandType === "page.document.replace" && row.payload["itemId"] === fixture.id,
        );
        if (queued === undefined) throw new Error("legacy mutation was not durable");
        await service.outbox.captureConflict(
          queued.mutationId,
          [crypto.randomUUID()],
          "revision.stale-base",
        );
        mutationIds.push(queued.mutationId);
      }
      // Recreate the exact pre-v9 observation: five sealed conflict payloads,
      // no recovery routing rows. Classification must happen after reload and
      // after the device key is unlocked.
      await service.db.legacySyncRecoveries.clear();
    } finally {
      Object.defineProperty(service, "synchronize", {
        configurable: true,
        value: originalSynchronize,
      });
    }
    return mutationIds;
  }, pages);
  expect(seeded).toHaveLength(5);

  await context.setOffline(false);
  await page.reload();
  await openWorkspace(page);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced", {
    timeout: 45_000,
  });
  await expect(page.getByTestId("storage-persistence-advisory")).toBeVisible();
  await expect(page.getByTestId("sync-status")).not.toContainText(/conflit/iu);

  const local = await page.evaluate(
    async (pageIds) => {
      const modulePath = "/src/services/local-content.ts";
      const loaded = (await import(/* @vite-ignore */ modulePath)) as {
        localContent(): {
          outbox: {
            conflicts(): Promise<unknown[]>;
            activeConflicts(): Promise<unknown[]>;
          };
          legacyConflictRecovery: {
            list(): Promise<Array<{ mutationId: string; status: string }>>;
          };
          pageOperationLog: {
            getState(pageId: string): Promise<{ status: string } | null>;
            getLegacyBranch(pageId: string): Promise<{ status: string } | null>;
          };
        };
      };
      const service = loaded.localContent();
      return {
        retainedConflicts: (await service.outbox.conflicts()).length,
        activeConflicts: (await service.outbox.activeConflicts()).length,
        recoveries: await service.legacyConflictRecovery.list(),
        states: await Promise.all(
          pageIds.map(async (id) => ({
            page: (await service.pageOperationLog.getState(id))?.status ?? null,
            branch: (await service.pageOperationLog.getLegacyBranch(id))?.status ?? null,
          })),
        ),
      };
    },
    pages.map(({ id }) => id),
  );
  expect(local.retainedConflicts).toBe(0);
  expect(local.activeConflicts).toBe(0);
  expect(local.recoveries).toHaveLength(5);
  expect(local.recoveries.every(({ status }) => status === "converted")).toBe(true);
  expect(local.states).toEqual(
    Array.from({ length: 5 }, () => ({ page: "active", branch: "converted" })),
  );

  for (const fixture of pages) {
    const response = await request.get(`${apiOrigin()}/v1/items/${fixture.id}`);
    expect(response.ok(), await response.text()).toBe(true);
    const item = (await response.json()) as { pageDocument: { body: unknown } };
    expect(JSON.stringify(item.pageDocument.body)).toContain(fixture.text);
  }
});
