/**
 * Autosave survives abrupt exits at any moment (T109, US4, FR-028, SC-020).
 *
 * The save-state journeys prove durability after a graceful wait. This one
 * proves it without one: every confirmed keystroke transaction is already
 * durable when it is acknowledged, so closing or reloading mid-flight loses
 * nothing that was ever visible as « enregistré sur cet appareil ». The
 * assertion is deliberately timing-hostile — no waiting, no blur handler,
 * just an immediate exit after typing.
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorChangeSequence,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditorSettled,
} from "./helpers.ts";

test.describe("autosave under abrupt exit", () => {
  test("a hard reload right after typing keeps every acknowledged character", async ({ page }) => {
    const name = uniqueName("AbruptReload");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await selectItem(page, name);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const beforeSequence = await editorChangeSequence(page);
    await editor.click();
    await editor.pressSequentially("premier jet durable");

    // No wait for « synchronized » and no save gesture. The status may only
    // acknowledge this exact browser burst after its local commit is durable.
    await waitForEditorSettled(page, { afterSequence: beforeSequence });
    const status = page.getByTestId("editor-sync-status");
    if (await status.count()) {
      await expect(status).toHaveAttribute("data-durable", "true", { timeout: 15_000 });
    }
    await page.reload();

    await openWorkspace(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toContainText("premier jet durable", {
      timeout: 30_000,
    });
  });

  test("edits from a closed tab reappear when the workspace reopens", async ({ page, context }) => {
    const name = uniqueName("ClosedTab");
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await selectItem(page, name);
    const editor = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const beforeSequence = await editorChangeSequence(page);
    await editor.click();
    await editor.pressSequentially("écrit puis fermé brutalement");
    await waitForEditorSettled(page, { afterSequence: beforeSequence });
    const status = page.getByTestId("editor-sync-status");
    if (await status.count()) {
      await expect(status).toHaveAttribute("data-durable", "true", { timeout: 15_000 });
    }

    // Closing the page's tab is the abrupt exit; a fresh tab in the same
    // context keeps both the session and the device's sealed storage. Opening
    // the workspace once is the browser-reopen boundary under test. An
    // immediate second reload races WebKit's Vite module imports and can leave
    // a blank test page before the application has had a chance to boot.
    await page.close();
    const second = await context.newPage();
    await openWorkspace(second);
    await selectItem(second, name);
    await expect(second.getByTestId("block-editor")).toContainText("écrit puis fermé brutalement", {
      timeout: 30_000,
    });
  });
});
