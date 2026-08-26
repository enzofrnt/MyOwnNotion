/**
 * Real two-device page convergence (T128, US5, FR-052-FR-059).
 *
 * Neither reconnection path is helped by a reload or by `saveDocument()`. One
 * device receives the browser's online event while its editor stays open; the
 * other is reopened from its own IndexedDB after an abrupt tab close. The only
 * acceptable outcome is the same stable block identities, order and text on
 * both devices.
 */

import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  editorApplyCount,
  editorChangeSequence,
  openSecondDevice,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForEditor,
  waitForEditorSettled,
  waitForSynchronized,
} from "./helpers.ts";

type DeviceName = "A" | "B";

interface Device {
  readonly context: BrowserContext;
  page: Page;
}

interface VisibleBlock {
  readonly id: string;
  readonly text: string;
}

function editor(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function rootBlocks(page: Page): Locator {
  return editor(page).locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
}

function inlineContent(block: Locator): Locator {
  return block.locator(":scope > .bn-block > .bn-block-content > .bn-inline-content").first();
}

function blockContaining(page: Page, text: string): Locator {
  return rootBlocks(page).filter({ hasText: text }).first();
}

function blockById(page: Page, id: string): Locator {
  return editor(page).locator(`:scope > .bn-block-group > .bn-block-outer[data-id="${id}"]`);
}

async function placeCaret(page: Page, content: Locator, edge: "start" | "end"): Promise<void> {
  await content.evaluate((node, requestedEdge) => {
    const surface = node.closest(".ProseMirror");
    if (!(surface instanceof HTMLElement)) throw new Error("the block is outside the editor");
    surface.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(requestedEdge === "start");
    const selection = window.getSelection();
    if (selection === null) throw new Error("the browser did not expose a text selection");
    selection.removeAllRanges();
    selection.addRange(range);
  }, edge);
  await expect(editor(page)).toBeFocused();
}

async function visibleBlocks(page: Page): Promise<VisibleBlock[]> {
  return rootBlocks(page).evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-id") ?? "",
      text: (node.textContent ?? "").replace(/\s+/gu, " ").trim(),
    })),
  );
}

async function waitForPageSynchronized(page: Page): Promise<void> {
  await waitForEditorSettled(page);
  const status = page.getByTestId("editor-sync-status");
  await expect(status).toHaveAttribute("data-durable", "true", { timeout: 30_000 });
  await expect(status).toHaveAttribute("data-sync", "synced", { timeout: 30_000 });
  await expect(page.getByTestId("conflict-notice")).toHaveCount(0);
}

async function goOffline(device: Device): Promise<void> {
  await device.context.setOffline(true);
  await expect.poll(() => device.page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(device.page.getByTestId("editor-sync-status")).toHaveAttribute(
    "data-sync",
    "offline",
  );
}

async function reconnectOpenDevice(device: Device): Promise<void> {
  await device.context.setOffline(false);
  await expect.poll(() => device.page.evaluate(() => navigator.onLine)).toBe(true);
  await waitForPageSynchronized(device.page);
}

async function reopenDevice(device: Device, pageName: string): Promise<void> {
  await device.context.setOffline(false);
  device.page = await device.context.newPage();
  await openWorkspace(device.page);
  await selectItem(device.page, pageName);
  await waitForPageSynchronized(device.page);
}

async function createSharedStartingPoint(page: Page): Promise<void> {
  await waitForEditor(page);
  const surface = editor(page);
  const beforeSequence = await editorChangeSequence(page);
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await surface.pressSequentially("premier");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await surface.pressSequentially("bloc partagé");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await surface.pressSequentially("dernier");
  await waitForEditorSettled(page, { afterSequence: beforeSequence });
  await expect(rootBlocks(page)).toHaveCount(3);
}

async function moveSharedBlockAndEditItsStart(page: Page): Promise<void> {
  const shared = blockContaining(page, "bloc partagé");
  const beforeMove = await editorApplyCount(page);
  await shared.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Déplacer vers le bas" }).click();
  await waitForEditorSettled(page, { afterApplyCount: beforeMove });

  const beforeText = await editorChangeSequence(page);
  const content = inlineContent(blockContaining(page, "bloc partagé"));
  await placeCaret(page, content, "start");
  await editor(page).pressSequentially("A_DEBUT — ");
  await waitForEditorSettled(page, { afterSequence: beforeText });
}

async function editSharedEndAndInsertNeighbour(page: Page): Promise<string> {
  const beforeIds = new Set((await visibleBlocks(page)).map(({ id }) => id));
  const beforeText = await editorChangeSequence(page);
  const content = inlineContent(blockContaining(page, "bloc partagé"));
  await placeCaret(page, content, "end");
  await editor(page).pressSequentially(" — B_FIN");
  await page.keyboard.press("ControlOrMeta+Alt+Enter");
  await waitForEditorSettled(page, { afterSequence: beforeText });

  const inserted = (await visibleBlocks(page)).find(({ id }) => !beforeIds.has(id));
  expect(
    inserted,
    "the second device must create one independently identified block",
  ).toBeDefined();
  const insertedId = inserted?.id ?? "";
  const block = blockById(page, insertedId);
  const beforeNeighbour = await editorChangeSequence(page);
  await placeCaret(page, inlineContent(block), "start");
  await editor(page).pressSequentially("voisin créé sur B");
  await waitForEditorSettled(page, { afterSequence: beforeNeighbour });
  return insertedId;
}

async function moveBlockRepeatedly(
  page: Page,
  label: string,
  direction: "haut" | "bas",
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const beforeMove = await editorApplyCount(page);
    const target = blockContaining(page, label);
    const targetId = await target.getAttribute("data-id");
    expect(targetId).not.toBeNull();
    await target.click({ button: "right" });
    await expect(page.getByTestId("block-context-menu")).toHaveAttribute(
      "data-block-id",
      targetId as string,
    );
    await page.getByRole("menuitem", { name: `Déplacer vers le ${direction}` }).click();
    await waitForEditorSettled(page, { afterApplyCount: beforeMove });
  }
}

for (const firstToReconnect of ["A", "B"] as const) {
  test(`offline page convergence reconnecting ${firstToReconnect} first`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const second = await openSecondDevice(browser, baseURL);
    const devices: Record<DeviceName, Device> = {
      A: { context, page },
      B: { context: second.context, page: second.page },
    };
    const returningName: DeviceName = firstToReconnect === "A" ? "B" : "A";

    try {
      const pageName = uniqueName(`OfflineConvergence${firstToReconnect}`);
      await openWorkspace(devices.A.page);
      await createRootItem(devices.A.page, "page", pageName);
      await waitForSynchronized(devices.A.page);
      await selectItem(devices.A.page, pageName);
      await createSharedStartingPoint(devices.A.page);
      await waitForPageSynchronized(devices.A.page);

      await openWorkspace(devices.B.page);
      await selectItem(devices.B.page, pageName);
      await waitForPageSynchronized(devices.B.page);

      const startingBlocks = await visibleBlocks(devices.A.page);
      expect(await visibleBlocks(devices.B.page)).toEqual(startingBlocks);
      const sharedId = startingBlocks.find(({ text }) => text === "bloc partagé")?.id ?? "";
      expect(sharedId).not.toBe("");

      await Promise.all([goOffline(devices.A), goOffline(devices.B)]);
      await Promise.all([
        moveSharedBlockAndEditItsStart(devices.A.page),
        editSharedEndAndInsertNeighbour(devices.B.page),
      ]);

      for (const device of Object.values(devices)) {
        await waitForEditorSettled(device.page);
        await expect(device.page.getByTestId("editor-sync-status")).toHaveAttribute(
          "data-durable",
          "true",
        );
        await expect(device.page.getByTestId("editor-sync-status")).toHaveAttribute(
          "data-sync",
          "offline",
        );
      }

      // Closing the later device is the crash boundary. Its pending operations
      // exist only in that device's encrypted IndexedDB when the tab disappears.
      await devices[returningName].page.close();

      // The still-open device must react to the browser lifecycle by itself.
      await reconnectOpenDevice(devices[firstToReconnect]);

      // The closed device boots from its own durable state, then catches up and
      // publishes without a reload or any save-shaped command.
      await reopenDevice(devices[returningName], pageName);

      const firstPage = devices[firstToReconnect].page;
      await expect(firstPage.getByTestId("block-editor")).toContainText("voisin créé sur B", {
        timeout: 30_000,
      });
      await expect(firstPage.getByTestId("block-editor")).toContainText("A_DEBUT");
      await expect(firstPage.getByTestId("block-editor")).toContainText("B_FIN");
      await waitForPageSynchronized(firstPage);

      const firstResult = await visibleBlocks(firstPage);
      const returningResult = await visibleBlocks(devices[returningName].page);
      expect(returningResult).toEqual(firstResult);
      const shared = firstResult.find(({ id }) => id === sharedId);
      expect(shared?.text).toContain("A_DEBUT");
      expect(shared?.text).toContain("bloc partagé");
      expect(shared?.text).toContain("B_FIN");
      expect(firstResult.filter(({ id }) => id === sharedId)).toHaveLength(1);
      expect(firstResult.filter(({ text }) => text.includes("voisin créé sur B"))).toHaveLength(1);
    } finally {
      await second.context.close();
    }
  });
}

test("independent offline block moves converge without loss or a conflict", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const second = await openSecondDevice(browser, baseURL);
  try {
    const pageName = uniqueName("ConcurrentBlockMoves");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await waitForEditor(page);
    const beforeSeed = await editorChangeSequence(page);
    const surface = editor(page);
    await surface.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    for (const [index, label] of ["alpha", "bravo", "charlie", "delta"].entries()) {
      if (index > 0) await page.keyboard.press("ControlOrMeta+Alt+Enter");
      await surface.pressSequentially(label);
    }
    await waitForEditorSettled(page, { afterSequence: beforeSeed });
    await waitForPageSynchronized(page);

    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await waitForPageSynchronized(second.page);
    const startingBlocks = await visibleBlocks(page);
    expect(await visibleBlocks(second.page)).toEqual(startingBlocks);

    await Promise.all([
      goOffline({ context, page }),
      goOffline({ context: second.context, page: second.page }),
    ]);
    // Both replicas remain offline, so neither branch can observe the other.
    // Serializing the browser interactions avoids two context menus fighting
    // for focus in one browser process while preserving the concurrent merge.
    await moveBlockRepeatedly(page, "delta", "haut", 3);
    await moveBlockRepeatedly(second.page, "bravo", "bas", 2);
    await Promise.all([waitForEditorSettled(page), waitForEditorSettled(second.page)]);

    await reconnectOpenDevice({ context, page });
    await reconnectOpenDevice({ context: second.context, page: second.page });
    await expect
      .poll(async () => JSON.stringify(await visibleBlocks(page)), { timeout: 30_000 })
      .toBe(JSON.stringify(await visibleBlocks(second.page)));

    const converged = await visibleBlocks(page);
    expect(converged).toHaveLength(4);
    expect(new Set(converged.map(({ id }) => id)).size).toBe(4);
    expect(converged.map(({ text }) => text).sort()).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
    await expect(page.getByTestId("ambiguity-notice")).toHaveCount(0);
    await expect(second.page.getByTestId("ambiguity-notice")).toHaveCount(0);
  } finally {
    await second.context.close().catch(() => undefined);
    await context.setOffline(false);
  }
});

test("a restarted device drains a closed page without reopening it", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const second = await openSecondDevice(browser, baseURL);
  try {
    const pageName = uniqueName("ClosedPageQueue");
    const landingName = uniqueName("DifferentLandingPage");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await createRootItem(page, "page", landingName);
    await waitForSynchronized(page);
    await selectItem(page, pageName);
    await createSharedStartingPoint(page);
    await waitForPageSynchronized(page);

    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await waitForPageSynchronized(second.page);
    await goOffline({ context: second.context, page: second.page });

    const beforeEdit = await editorChangeSequence(second.page);
    const shared = inlineContent(blockContaining(second.page, "bloc partagé"));
    await placeCaret(second.page, shared, "end");
    await editor(second.page).pressSequentially(" — repris sans rouvrir la page");
    await waitForEditorSettled(second.page, { afterSequence: beforeEdit });
    await expect(second.page.getByTestId("editor-sync-status")).toHaveAttribute(
      "data-durable",
      "true",
    );

    // Close the edited document before the process boundary. Persisting a
    // different active item means the following online boot cannot
    // accidentally pass by remounting the page and relying on its editor hook.
    // Reloading while the browser context is offline is deliberately avoided:
    // Chromium rejects that navigation before the service worker can answer,
    // which tests the automation transport rather than application recovery.
    await selectItem(second.page, landingName);
    await expect(second.page.getByTestId("active-item-title")).toHaveValue(landingName);
    await second.page.close();

    await second.context.setOffline(false);
    second.page = await second.context.newPage();
    await openWorkspace(second.page);
    await expect(second.page.getByTestId("active-item-title")).toHaveValue(landingName);

    // Device A keeps the edited page open. Device B must publish its durable
    // queue from boot discovery alone; no selection, reload or save-shaped
    // action may be needed on the page that owns the update.
    await expect(page.getByTestId("block-editor")).toContainText("repris sans rouvrir la page", {
      timeout: 30_000,
    });
    await waitForPageSynchronized(page);
    await waitForSynchronized(second.page);
  } finally {
    await second.context.close();
    // The fixture context remains online for its own cleanup regardless of
    // which assertion failed after the second device went offline.
    await context.setOffline(false);
  }
});
