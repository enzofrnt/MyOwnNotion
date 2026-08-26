/**
 * A historical whole-document write already queued on this device must cross
 * the operational-protocol boundary exactly once (T130, FR-065).
 *
 * This journey deliberately creates the state an upgraded browser inherits:
 * the old encrypted workspace outbox contains a `page.document.replace`, then
 * the current editor adds semantic operations while the server is absent. On
 * reconnect, both pieces of work must converge without a reload or an owner
 * choice; after activation the server must refuse every future blind replace.
 */

import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  createRootItem,
  createUnopenedPage,
  editorChangeSequence,
  openWorkspace,
  saveDocument,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

interface QueuedLegacyReplacement {
  readonly mutationId: string;
  readonly localRevisionId: string;
}

function surface(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function rootBlocks(editor: Locator): Locator {
  return editor.locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
}

async function queueHistoricalReplacement(
  page: Page,
  itemId: string,
  text: string,
): Promise<QueuedLegacyReplacement> {
  return await page.evaluate(
    async ({ id, replacementText }) => {
      const modulePath = "/src/services/local-content.ts";
      const loaded = (await import(/* @vite-ignore */ modulePath)) as {
        localContent(): {
          getItem(itemId: string): Promise<{
            currentRevisionId: string;
            kind: string;
            pageDocument: unknown;
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
                localRevisionIds: string[];
              }>
            >;
          };
        };
      };
      const service = loaded.localContent();
      const item = await service.getItem(id);
      if (item === null || item.kind !== "page" || item.pageDocument === null) {
        throw new Error("the legacy page is not available locally");
      }
      const baseRevisionId = item.currentRevisionId;
      const result = await service.mutate(
        "page.document.replace",
        {
          itemId: id,
          baseRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: {
              blocks: [
                {
                  id: crypto.randomUUID(),
                  type: "paragraph",
                  content: [{ text: replacementText }],
                },
              ],
            },
          },
          pageLinkTargetIds: [],
        },
        [baseRevisionId],
      );
      if (!result.ok) throw new Error(`legacy mutation refused locally: ${result.error.code}`);

      const queued = (await service.outbox.all()).find(
        (row) => row.commandType === "page.document.replace" && row.payload["itemId"] === id,
      );
      if (queued === undefined || queued.localRevisionIds[0] === undefined) {
        throw new Error("the legacy replacement was not retained in the encrypted outbox");
      }
      return {
        mutationId: queued.mutationId,
        localRevisionId: queued.localRevisionIds[0],
      };
    },
    { id: itemId, replacementText: text },
  );
}

async function appendOperationalParagraph(page: Page, text: string): Promise<void> {
  await waitForEditorSettled(page);
  const editor = surface(page);
  const blocks = rootBlocks(editor);
  const previousCount = await blocks.count();
  const beforeSequence = await editorChangeSequence(page);
  await blocks.last().locator(":scope > .bn-block > .bn-block-content").first().click();
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+Alt+Enter");
  await expect(blocks).toHaveCount(previousCount + 1);
  await editor.pressSequentially(text);
  await waitForEditorSettled(page, { afterSequence: beforeSequence });
  await expect(blocks.last()).toContainText(text);
}

test.describe("page protocol migration", () => {
  test("uses operational updates from the first normal online edit", async ({ page, request }) => {
    const pageName = uniqueName("DirectOperationalActivation");
    const typed = `écriture CRDT directe ${pageName}`;

    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    const itemId = await page.getByTestId(`tree-item-${pageName}`).getAttribute("data-item-id");
    if (itemId === null) throw new Error("the created page has no stable identity");

    await waitForEditor(page);
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const modulePath = "/src/services/local-content.ts";
            const loaded = (await import(/* @vite-ignore */ modulePath)) as {
              localContent(): {
                pageOperationLog: {
                  getState(pageId: string): Promise<{ status: string } | null>;
                };
              };
            };
            return (await loaded.localContent().pageOperationLog.getState(id))?.status ?? null;
          }, itemId),
        { timeout: 30_000 },
      )
      .toBe("active");

    const editorialRequests: string[] = [];
    const recordEditorialRequest = (request: import("@playwright/test").Request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.includes(`/v1/page-operations/${itemId}`) ||
        path === `/v1/pages/${itemId}/document`
      ) {
        editorialRequests.push(`${request.method()} ${path}`);
      }
    };
    page.on("request", recordEditorialRequest);
    try {
      const editor = surface(page);
      const beforeSequence = await editorChangeSequence(page);
      await editor.click();
      await editor.pressSequentially(typed);
      await waitForEditorSettled(page, { afterSequence: beforeSequence });
      await saveDocument(page, { until: "synced" });

      // HTTP fallback and the live socket are both valid operational transports.
      // A durable server copy plus no whole-document PUT proves the edit crossed
      // the operational boundary without coupling the journey to one transport.
      expect(editorialRequests).not.toContain(`PUT /v1/pages/${itemId}/document`);
      const stored = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
      expect(stored.ok(), await stored.text()).toBe(true);
      expect(
        JSON.stringify(((await stored.json()) as { pageDocument: unknown }).pageDocument),
      ).toContain(typed);

      const localAuthority = await page.evaluate(async (id) => {
        const modulePath = "/src/services/local-content.ts";
        const loaded = (await import(/* @vite-ignore */ modulePath)) as {
          localContent(): {
            pageOperationLog: {
              getState(pageId: string): Promise<{ status: string } | null>;
              getLegacyBranch(pageId: string): Promise<{ status: string } | null>;
            };
          };
        };
        const service = loaded.localContent();
        const [state, branch] = await Promise.all([
          service.pageOperationLog.getState(id),
          service.pageOperationLog.getLegacyBranch(id),
        ]);
        return { state: state?.status ?? null, branch: branch?.status ?? null };
      }, itemId);
      expect(localAuthority).toEqual({ state: "active", branch: null });
      await expect(surface(page)).toContainText(typed);
    } finally {
      page.off("request", recordEditorialRequest);
    }
  });

  test("acknowledges a pending v2 replacement before convergent activation", async ({
    page,
    context,
    request,
  }) => {
    const pageName = uniqueName("PendingV2Migration");
    const replacementText = `ancienne écriture en attente ${pageName}`;
    const operationalText = `nouvelle écriture opérationnelle ${pageName}`;

    await openWorkspace(page);
    const { itemId } = await createUnopenedPage(request, pageName);
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await expect(page.getByTestId(`tree-item-${pageName}`)).toBeAttached({ timeout: 15_000 });

    // This is the browser state present at upgrade time: a v2 replacement is
    // durable on the device but has never reached the server.
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const pending = await queueHistoricalReplacement(page, itemId, replacementText);

    // The current editor opens from that optimistic v2 projection and records
    // only semantic transactions on top of it. No whole-document save follows.
    await selectItem(page, pageName);
    await expect(surface(page)).toContainText(replacementText, { timeout: 30_000 });
    await appendOperationalParagraph(page, operationalText);
    await saveDocument(page);
    await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-sync", "offline");

    // Reconnection alone owns the handover. The old outbox write must be
    // accepted first (giving its local revision a canonical alias), then the
    // semantic branch converts from that exact acknowledged base.
    await context.setOffline(false);
    await saveDocument(page, { until: "synced" });
    await expect(surface(page)).toContainText(replacementText);
    await expect(surface(page)).toContainText(operationalText);
    await expect(page.getByTestId("conflict-notice")).toHaveCount(0);

    const localState = await page.evaluate(
      async ({ id, oldMutationId, oldLocalRevisionId }) => {
        const modulePath = "/src/services/local-content.ts";
        const loaded = (await import(/* @vite-ignore */ modulePath)) as {
          localContent(): {
            outbox: {
              all(): Promise<Array<{ mutationId: string; commandType: string }>>;
            };
            db: {
              revisionHeaders: {
                get(revisionId: string): Promise<
                  | {
                      canonicalRevisionId?: string;
                    }
                  | undefined
                >;
              };
            };
            pageOperationLog: {
              getState(pageId: string): Promise<{ status: string } | null>;
              getLegacyBranch(pageId: string): Promise<{ status: string } | null>;
            };
          };
        };
        const service = loaded.localContent();
        const [outbox, revision, state, branch] = await Promise.all([
          service.outbox.all(),
          service.db.revisionHeaders.get(oldLocalRevisionId),
          service.pageOperationLog.getState(id),
          service.pageOperationLog.getLegacyBranch(id),
        ]);
        return {
          legacyMutationStillQueued: outbox.some(
            (row) =>
              row.mutationId === oldMutationId || row.commandType === "page.document.replace",
          ),
          canonicalRevisionId: revision?.canonicalRevisionId ?? null,
          pageState: state?.status ?? null,
          branchState: branch?.status ?? null,
        };
      },
      {
        id: itemId,
        oldMutationId: pending.mutationId,
        oldLocalRevisionId: pending.localRevisionId,
      },
    );
    expect(localState).toMatchObject({
      legacyMutationStillQueued: false,
      pageState: "active",
      branchState: "converted",
    });
    expect(localState.canonicalRevisionId).not.toBeNull();

    const stored = await request.get(`${apiOrigin()}/v1/items/${itemId}`);
    expect(stored.ok(), await stored.text()).toBe(true);
    const serverItem = (await stored.json()) as {
      currentRevisionId: string;
      pageDocument: { body: unknown };
    };
    expect(JSON.stringify(serverItem.pageDocument.body)).toContain(replacementText);
    expect(JSON.stringify(serverItem.pageDocument.body)).toContain(operationalText);

    // The migration is one-way: once operational history exists, the old API
    // cannot overwrite it even with a current causal revision.
    const blindReplacement = await request.put(`${apiOrigin()}/v1/pages/${itemId}/document`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: serverItem.currentRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: {
            blocks: [
              {
                id: randomUUID(),
                type: "paragraph",
                content: [{ text: "blind replacement must never win" }],
              },
            ],
          },
        },
      },
    });
    expect(blindReplacement.status()).toBe(426);
    expect((await blindReplacement.json()) as { code: string }).toMatchObject({
      code: "page-operations.protocol-read-only",
    });
  });
});
