/**
 * Same-device tab coordination (T235, US5, FR-060/FR-073).
 *
 * IndexedDB is shared by same-origin tabs, but each tab owns a distinct Loro
 * peer and renderer. Durable changes must therefore be adopted immediately
 * through the tab channel, while one origin-wide transport owner prevents a
 * live request from being reset or duplicated. No assertion below reloads a
 * page or invokes a save-shaped helper.
 */

import type { Locator, Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorChangeSequence,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

function editor(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function firstInline(page: Page): Locator {
  return editor(page).locator(".bn-inline-content").first();
}

async function placeCaret(page: Page, edge: "start" | "end"): Promise<void> {
  await firstInline(page).evaluate((node, requestedEdge) => {
    const surface = node.closest(".ProseMirror");
    if (!(surface instanceof HTMLElement)) throw new Error("the block is outside the editor");
    surface.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(requestedEdge === "start");
    const selection = window.getSelection();
    if (selection === null) throw new Error("the browser did not expose a selection");
    selection.removeAllRanges();
    selection.addRange(range);
  }, edge);
}

async function typeAt(page: Page, edge: "start" | "end", text: string): Promise<void> {
  const before = await editorChangeSequence(page);
  await placeCaret(page, edge);
  await editor(page).pressSequentially(text);
  await waitForEditorSettled(page, { afterSequence: before });
  await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-durable", "true");
}

async function waitForPageSynced(page: Page): Promise<void> {
  await waitForEditorSettled(page);
  await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-sync", "synced", {
    timeout: 30_000,
  });
}

function isWholeDocumentReplacement(request: Request): boolean {
  if (/\/v1\/items\/[^/]+\/document$/u.test(new URL(request.url()).pathname)) return true;
  if (!request.url().includes("/v1/mutations/batch")) return false;
  const body = request.postDataJSON() as {
    readonly mutations?: readonly { readonly commandType?: string }[];
  } | null;
  return (
    body?.mutations?.some(({ commandType }) => commandType === "page.document.replace") ?? false
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function stallNextOperationalSend(page: Page): Promise<{
  readonly started: Promise<void>;
  readonly release: () => void;
}> {
  const started = deferred();
  const released = deferred();
  let intercepted = false;
  await page.route("**/v1/page-operations/*/sync", async (route) => {
    const request = route.request();
    type SyncRequestBody = { readonly mode?: string; readonly updates?: readonly unknown[] };
    let body: SyncRequestBody | null = null;
    try {
      body = request.postDataJSON() as SyncRequestBody;
    } catch {
      // Non-JSON requests continue through the native transport.
    }
    if (!intercepted && body?.mode === "active" && (body.updates?.length ?? 0) > 0) {
      intercepted = true;
      started.resolve();
      await released.promise;
      await route.abort("failed").catch(() => undefined);
      return;
    }
    await route.continue();
  });
  return { started: started.promise, release: released.resolve };
}

async function countSendingPageUpdates(page: Page): Promise<number> {
  return await page.evaluate(
    async () =>
      await new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open("myownnotion-local");
        opening.onerror = () => reject(opening.error ?? new Error("local database unavailable"));
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction("pageOperationUpdates", "readonly");
          const request = transaction
            .objectStore("pageOperationUpdates")
            .index("status")
            .count("sending");
          request.onerror = () => reject(request.error ?? new Error("sending count failed"));
          request.onsuccess = () => resolve(request.result);
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

test("same-origin tabs adopt offline edits and recover a crashed sender", async ({
  page,
  context,
}) => {
  const replacements: string[] = [];
  const recordReplacement = (request: Request) => {
    if (isWholeDocumentReplacement(request)) replacements.push(request.url());
  };
  context.on("request", recordReplacement);
  const second = await context.newPage();
  let releaseStalledRequest: (() => void) | null = null;

  try {
    const pageName = uniqueName("MultiTabConvergence");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await waitForEditor(page);
    await typeAt(page, "start", "base");
    await waitForPageSynced(page);

    await openWorkspace(second);
    await selectItem(second, pageName);
    await waitForPageSynced(second);
    await expect(editor(second)).toContainText("base");

    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect.poll(() => second.evaluate(() => navigator.onLine)).toBe(false);

    await typeAt(page, "end", " — visible hors ligne sur B");
    await expect(second.getByTestId("block-editor")).toContainText("visible hors ligne sur B", {
      timeout: 10_000,
    });

    await Promise.all([typeAt(page, "start", "A — "), typeAt(second, "end", " — B")]);
    for (const tab of [page, second]) {
      await expect(tab.getByTestId("block-editor")).toContainText("A —", { timeout: 10_000 });
      await expect(tab.getByTestId("block-editor")).toContainText("— B", { timeout: 10_000 });
      await expect(tab.getByTestId("editor-sync-status")).toHaveAttribute("data-sync", "offline");
    }

    await context.setOffline(false);
    await Promise.all([waitForPageSynced(page), waitForPageSynced(second)]);

    const stalled = await stallNextOperationalSend(page);
    releaseStalledRequest = stalled.release;
    await typeAt(page, "end", " — repris après crash");
    await stalled.started;
    await expect.poll(() => countSendingPageUpdates(page), { timeout: 15_000 }).toBeGreaterThan(0);

    // Closing the transport owner terminates its Web Lock and unresolved fetch.
    // The already-open successor must recover the immutable update ID itself.
    const closed = new Promise<void>((resolve) => page.once("close", () => resolve()));
    const closing = page.close();
    await closed;
    stalled.release();
    releaseStalledRequest = null;
    await closing;
    await expect(second.getByTestId("block-editor")).toContainText("repris après crash", {
      timeout: 30_000,
    });
    await waitForPageSynced(second);
    expect(replacements).toEqual([]);
  } finally {
    releaseStalledRequest?.();
    context.off("request", recordReplacement);
    await context.setOffline(false);
    await second.close();
  }
});
