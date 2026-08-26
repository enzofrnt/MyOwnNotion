/**
 * Files created offline, bytes on their own schedule (T089, US3, SC-013).
 *
 * The promise under test has two halves that must never be conflated. The
 * document reference is editorial: dropped or pasted offline it commits
 * durably on the device and the page keeps working. The bytes are a transfer:
 * they wait for the network and are stated honestly as pending rather than
 * dressed up as synchronized.
 *
 * Every third-party route is cut for the whole offline stretch (SC-013): the
 * context is offline from before the drop to after the durability assertions,
 * so nothing but this installation can have been reached. Durability is proven
 * by leaving the page and coming back — the editor remounts from the device's
 * own sealed state — because an emulated-offline context cannot reload a page
 * from a network dev server in the first place.
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
    const pageName = uniqueName("OfflineMedia");
    const otherName = uniqueName("Elsewhere");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await createRootItem(page, "folder", otherName);
    await selectItem(page, pageName);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });

    // Offline before anything is inserted: no byte path can succeed.
    await page.context().setOffline(true);

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

    // Leave the page and come back while still offline: the reference and its
    // pending transfer survive because the device holds them durably.
    await selectItem(page, otherName);
    await selectItem(page, pageName);
    const remounted = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(remounted).toBeVisible({ timeout: 30_000 });
    await expect(remounted.locator(".editor-image-block")).toBeVisible();
    await expect(remounted.locator(".editor-file-block")).toBeVisible();

    // Text keeps working offline next to the pending media: create a fresh
    // editable block below the image and type into it.
    await remounted.click();
    await remounted.press("ControlOrMeta+Alt+Enter");
    await remounted.pressSequentially(" et le texte continue hors ligne");
    await expect(remounted).toContainText("et le texte continue hors ligne");

    // Back online: the queued transfer resumes by itself and reports
    // completion honestly — bytes verified, not merely an accepted operation.
    await page.context().setOffline(false);
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

    // A hard reload destroys the upload queue and its in-memory File objects.
    // Both blocks must now resolve the verified feature-005 items, render from
    // server bytes, and avoid inventing a new queued transfer.
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, pageName);
    const serverBacked = page.getByTestId("block-editor").locator(".ProseMirror");
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
    await expect(page.getByTestId("tree-item-capture.png")).toHaveCount(0);
    await expect(page.getByTestId("tree-item-compte-rendu.txt")).toHaveCount(0);
    await expect(page.getByTestId("attachment-panel")).toHaveCount(0);
    await openPageAttachments(page, pageName);
    await expect(page.getByTestId("attachment-capture.png")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("attachment-compte-rendu.txt")).toBeVisible({ timeout: 30_000 });
  });
});
