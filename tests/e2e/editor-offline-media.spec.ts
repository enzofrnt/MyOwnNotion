/**
 * Files created offline, bytes on their own schedule (T089, US3, SC-013).
 *
 * The promise under test has two halves that must never be conflated. The
 * document reference is editorial: dropped or pasted offline it commits
 * durably on the device and the page keeps working. The bytes are a transfer:
 * they wait for the network and are stated honestly as pending rather than
 * dressed up as synchronized.
 *
 * Every API route remains cut from before the drop through the replacement
 * process. This models a running/cached application with the server unreachable
 * while avoiding a Playwright WebKit defect: its full-offline emulation makes
 * even a JavaScript-created local `File` throw `NotReadableError`. IndexedDB is
 * therefore the only possible source for blocks and bytes before reconnect.
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openPageAttachments,
  openWorkspace,
  selectItem,
  uniqueName,
} from "./helpers.ts";

test.describe("editor media offline", () => {
  test("a file dropped offline becomes a durable reference with an honest transfer state", async ({
    page,
  }) => {
    const context = page.context();
    const pageName = uniqueName("OfflineMedia");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });

    // Server disconnected before anything is inserted: no upload can succeed.
    const apiPattern = "**/v1/**";
    await context.route(apiPattern, (route) => route.abort());

    // Drop a PNG onto the surface. The block must appear through the durable
    // engine commit even though no upload can run. The File is built inside
    // the page: a Node-side File does not survive the serialization boundary.
    await editor.click();
    await editor.evaluate((surface) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        ),
        (character) => character.charCodeAt(0),
      );
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([bytes], "capture.png", { type: "image/png" }));
      dataTransfer.items.add(
        new File(["Compte rendu hors ligne"], "compte-rendu.txt", { type: "text/plain" }),
      );
      surface.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
      );
    });
    await expect(editor.locator(".editor-image-block")).toBeVisible({ timeout: 15_000 });
    await expect(editor.locator("img.editor-image-preview")).toBeVisible();
    await expect(editor.locator("img.editor-image-preview")).toHaveAttribute("alt", "capture.png");
    await expect(editor.locator(".editor-file-block")).toBeVisible();
    // Either wording is honest offline: queued before any attempt, or waiting
    // for the network once an attempt was refused. Never « synchronisé ».
    const stateLine = editor.locator(".editor-file-state");
    await expect(stateLine).toHaveCount(2);
    await expect(stateLine.first()).toBeVisible();
    await expect(stateLine.first()).not.toContainText("vérifiés sur le serveur");
    await expect(stateLine.last()).not.toContainText("vérifiés sur le serveur");

    // Abrupt process boundary: close the only page. The replacement may load
    // Vite's shell, but the API stays unreachable until the reconnect below.
    await page.close();
    const restarted = await context.newPage();
    await openWorkspace(restarted);
    await selectItem(restarted, pageName);
    const remounted = restarted.getByTestId("block-editor").locator(".ProseMirror");
    await expect(remounted).toBeVisible({ timeout: 30_000 });
    await expect(remounted.locator(".editor-image-block")).toBeVisible();
    await expect(remounted.locator(".editor-file-block")).toBeVisible();
    await expect(remounted.locator("img.editor-image-preview")).toHaveAttribute(
      "alt",
      "capture.png",
    );

    // IndexedDB may expose routing IDs, never names, media types or bytes.
    const storedRows = await restarted.evaluate(async () => {
      const request = indexedDB.open("myownnotion-local");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ["pendingFileTransfers", "pendingFileTransferChunks"],
        "readonly",
      );
      const read = (storeName: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const rows = transaction.objectStore(storeName).getAll();
          rows.onsuccess = () => resolve(rows.result);
          rows.onerror = () => reject(rows.error);
        });
      const result = await Promise.all([
        read("pendingFileTransfers"),
        read("pendingFileTransferChunks"),
      ]);
      database.close();
      return JSON.stringify(result);
    });
    expect(storedRows).not.toContain("capture.png");
    expect(storedRows).not.toContain("compte-rendu.txt");
    expect(storedRows).not.toContain("Compte rendu hors ligne");
    expect(storedRows).not.toContain("text/plain");

    // Text keeps working offline next to the pending media: create a fresh
    // editable block below the image and type into it.
    await remounted.click();
    await remounted.press("ControlOrMeta+Alt+Enter");
    await remounted.pressSequentially(" et le texte continue hors ligne");
    await expect(remounted).toContainText("et le texte continue hors ligne");

    // Back online: the queued transfer resumes by itself and reports
    // completion honestly — bytes verified, not merely an accepted operation.
    let uploadCreations = 0;
    const verifiedItems = new Set<string>();
    restarted.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/uploads") {
        uploadCreations += 1;
      }
    });
    restarted.on("response", async (response) => {
      if (response.request().method() !== "PATCH" || response.status() !== 201) return;
      const body = (await response.json().catch(() => null)) as { itemId?: unknown } | null;
      if (typeof body?.itemId === "string") verifiedItems.add(body.itemId);
    });
    await context.unroute(apiPattern);
    await restarted.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(remounted.locator(".editor-file-state").first()).toHaveAttribute(
      "data-state",
      "synchronized",
      { timeout: 30_000 },
    );
    await expect(remounted.locator(".editor-file-state").last()).toHaveAttribute(
      "data-state",
      "synchronized",
      { timeout: 30_000 },
    );
    expect(uploadCreations).toBe(2);
    expect(verifiedItems.size).toBe(2);

    // A hard reload destroys the upload queue and its in-memory File objects.
    // Both blocks must now resolve the verified feature-005 items, render from
    // server bytes, and avoid inventing a new queued transfer.
    await restarted.reload();
    await openWorkspace(restarted);
    await selectItem(restarted, pageName);
    const serverBacked = restarted.getByTestId("block-editor").locator(".ProseMirror");
    await expect(serverBacked).toBeVisible({ timeout: 30_000 });
    await expect(serverBacked.locator("img.editor-image-preview")).toBeVisible({ timeout: 30_000 });
    const fileBlock = serverBacked.locator(".editor-file-block");
    await expect(fileBlock).toContainText("text/plain");
    await expect(fileBlock.getByRole("link", { name: "Télécharger" })).toHaveAttribute(
      "href",
      /\/v1\/files\/[^/]+\/content$/u,
    );
    await expect(serverBacked.locator(".editor-file-state")).toHaveCount(0);

    // An editor file is a content attachment of this page. It is neither a
    // root hierarchy item nor a panel appended below the writing canvas.
    await expect(restarted.getByTestId("tree-item-capture.png")).toHaveCount(0);
    await expect(restarted.getByTestId("tree-item-compte-rendu.txt")).toHaveCount(0);
    await expect(restarted.getByTestId("attachment-panel")).toHaveCount(0);
    await openPageAttachments(restarted, pageName);
    await expect(restarted.getByTestId("attachment-capture.png")).toBeVisible({ timeout: 30_000 });
    await expect(restarted.getByTestId("attachment-compte-rendu.txt")).toBeVisible({
      timeout: 30_000,
    });
  });
});
