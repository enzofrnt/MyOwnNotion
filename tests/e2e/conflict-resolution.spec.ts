/** Multi-device operational convergence without false conflicts (US3). */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorChangeSequence,
  openSecondDevice,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

/**
 * Adds words to the end of the paragraph that is already there.
 *
 * Deliberately not `typeIntoEditor`, which selects everything and retypes: that
 * *replaces* the block, so the two devices end up having deleted one block and
 * added two different new ones — which merges cleanly and conflicts with nothing.
 * Appending inside the existing block is the demanding CRDT case: both devices
 * modify the same Loro text identity, not two unrelated replacement blocks.
 */
async function appendInPlace(
  page: Page,
  text: string,
  options: { readonly until?: "durable" | "synced" } = {},
): Promise<void> {
  await waitForEditorSettled(page);
  const beforeSequence = await editorChangeSequence(page);
  const surface = page.getByTestId("block-editor").locator(".ProseMirror");
  await surface.click();
  await page.keyboard.press("ControlOrMeta+End");
  await surface.pressSequentially(text);
  await waitForEditorSettled(page, { afterSequence: beforeSequence });
  await expect(surface).toContainText(text);
  await saveDocument(page, options);
}

async function visibleDocumentText(page: Page): Promise<string> {
  return ((await page.getByTestId("block-editor").locator(".ProseMirror").innerText()) ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

async function setDeviceOffline(page: Page, offline: boolean): Promise<void> {
  await page.context().setOffline(offline);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
  if (await page.getByTestId("editor-sync-status").count()) {
    await expect(page.getByTestId("editor-sync-status")).toHaveAttribute(
      "data-sync",
      offline ? "offline" : /^(?:pending|sending|synced)$/u,
    );
  }
}

test.describe("a device that is merely behind (FR-011)", () => {
  test("produces no conflict when it catches up", async ({ page, browser, baseURL }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      const name = uniqueName("BehindNotDiverged");
      await openWorkspace(page);
      await createRootItem(page, "page", name);
      await waitForSynchronized(page);

      // The second device loads the page and then stops hearing anything.
      await openWorkspace(second.page);
      await selectItem(second.page, name);
      await saveDocument(second.page, { until: "synced" });
      await setDeviceOffline(second.page, true);

      // Only the first device writes. The second one is behind and has changed
      // nothing, which is not a divergence by any definition.
      await selectItem(page, name);
      await typeIntoEditor(page, "written only on the first device");
      await saveDocument(page, { until: "synced" });
      await waitForSynchronized(page);

      await setDeviceOffline(second.page, false);
      await second.page.reload();
      await expect(second.page.getByTestId("workspace-shell")).toBeVisible();
      await selectItem(second.page, name);

      // The assertion that matters: nothing to resolve. A false conflict here
      // would teach an owner that the question is noise, and they would stop
      // reading the one that is real.
      await expect(second.page.getByTestId("conflict-notice")).toHaveCount(0);
      await expect(second.page.getByTestId("sync-status")).not.toHaveAttribute(
        "data-state",
        "conflict",
      );
    } finally {
      await second.context.close();
    }
  });
});

test.describe("concurrent edits to the same paragraph (US3)", () => {
  test("converge automatically and preserve both offline additions", async ({
    page,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    try {
      const name = uniqueName("Diverged");
      await openWorkspace(page);
      await createRootItem(page, "page", name);
      await selectItem(page, name);
      await typeIntoEditor(page, "the sentence both devices started from");
      await saveDocument(page);
      await waitForSynchronized(page);

      // Both devices hold the same starting point.
      await openWorkspace(second.page);
      await selectItem(second.page, name);
      await saveDocument(second.page, { until: "synced" });

      // The second device is cut off, then both devices edit the same paragraph
      // from the same causal frontier.
      await setDeviceOffline(second.page, true);
      await appendInPlace(second.page, " — and what the second device added");

      await appendInPlace(page, " — and what the first device added", { until: "synced" });
      await waitForSynchronized(page);

      // Reconnection imports operations instead of replacing either complete
      // document. Both independent insertions must survive without a question.
      await setDeviceOffline(second.page, false);
      await second.page.reload();
      await openWorkspace(second.page);
      await selectItem(second.page, name);
      await saveDocument(second.page, { until: "synced" });
      await expect(second.page.getByTestId("conflict-notice")).toHaveCount(0);
      await expect(second.page.getByTestId("block-editor")).toContainText(
        "what the first device added",
        { timeout: 30_000 },
      );
      await expect(second.page.getByTestId("block-editor")).toContainText(
        "what the second device added",
      );

      // Reload both independent stores. Equal visible projections after a
      // fresh read prove convergence, not merely a lucky transient rendering.
      await page.reload();
      await openWorkspace(page);
      await selectItem(page, name);
      await expect(page.getByTestId("block-editor")).toContainText("what the second device added", {
        timeout: 30_000,
      });
      expect(await visibleDocumentText(page)).toBe(await visibleDocumentText(second.page));
    } finally {
      await second.context.close();
    }
  });
});
