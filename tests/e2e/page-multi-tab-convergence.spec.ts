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

async function interceptNextCommittedSocketReply(page: Page): Promise<{
  readonly arm: () => Promise<void>;
}> {
  let armed = false;
  let targetRequestId: string | null = null;
  let committed = deferred();
  await page.routeWebSocket("**/v1/page-sync/socket", (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      const text = typeof message === "string" ? message : message.toString("utf8");
      if (armed && targetRequestId === null) {
        try {
          const frame = JSON.parse(text) as {
            readonly type?: string;
            readonly requestId?: string;
            readonly request?: { readonly mode?: string; readonly updates?: readonly unknown[] };
          };
          if (
            frame.type === "sync" &&
            frame.request?.mode === "active" &&
            (frame.request.updates?.length ?? 0) > 0 &&
            typeof frame.requestId === "string"
          ) {
            targetRequestId = frame.requestId;
          }
        } catch {
          // The real server remains the protocol authority for malformed data.
        }
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => {
      const text = typeof message === "string" ? message : message.toString("utf8");
      if (targetRequestId !== null) {
        try {
          const frame = JSON.parse(text) as { readonly type?: string; readonly requestId?: string };
          if (frame.type === "sync-result" && frame.requestId === targetRequestId) {
            // The server only emits sync-result after its transaction. Losing
            // this frame leaves the immutable local row in `sending`, exactly
            // like a tab or network dying after commit but before local ACK.
            armed = false;
            targetRequestId = null;
            committed.resolve();
            return;
          }
        } catch {
          // Forward anything that is not the selected committed response.
        }
      }
      browserSocket.send(message);
    });
  });
  return {
    arm: async () => {
      committed = deferred();
      armed = true;
      targetRequestId = null;
      await committed.promise;
    },
  };
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
  const committedReply = await interceptNextCommittedSocketReply(page);

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

    const committedWithoutAck = committedReply.arm();
    await typeAt(page, "end", " — repris après crash");
    await committedWithoutAck;
    await expect.poll(() => countSendingPageUpdates(page), { timeout: 15_000 }).toBeGreaterThan(0);

    // Closing the transport owner terminates its Web Lock after the server has
    // committed but before this tab has received the ACK. The already-open
    // successor must retry the same immutable update ID, receive `repeated`,
    // and adopt the committed frontier without a duplicate.
    const closed = new Promise<void>((resolve) => page.once("close", () => resolve()));
    const closing = page.close();
    await closed;
    await closing;
    await expect(second.getByTestId("block-editor")).toContainText("repris après crash", {
      timeout: 30_000,
    });
    await waitForPageSynced(second);
    expect(replacements).toEqual([]);
  } finally {
    context.off("request", recordReplacement);
    await context.setOffline(false);
    await second.close();
  }
});
