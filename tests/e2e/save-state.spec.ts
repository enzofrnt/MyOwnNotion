/**
 * Knowing whether the work is saved (T044-T047, T112-T113; US4).
 *
 * The journey a note-taking application lives or dies by. The failure this
 * suite guards against is not silence but *optimism*: an interface that says
 * « synchronisé » before the server has agreed destroys trust exactly as
 * thoroughly as one that loses the work.
 *
 * Under the operational path there is no save button: every gesture is
 * committed encrypted to this device before it is acknowledged, and only the
 * server's causal acknowledgement promotes the status to « synchronisé ». So
 * the strongest assertion here is still a negative one: with the server gone,
 * the label may promise device durability — never synchronization.
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";
import { setDataKeyWriteBlock } from "./reset-installation.ts";
import { nextPageSyncProblem, recordAttribute } from "./waits/observation.ts";

function indicator(page: import("@playwright/test").Page) {
  return page.getByTestId("editor-sync-status");
}

async function setDeviceOffline(
  page: import("@playwright/test").Page,
  offline: boolean,
): Promise<void> {
  await page.context().setOffline(offline);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
}

async function openPage(page: import("@playwright/test").Page, name: string): Promise<void> {
  await openWorkspace(page);
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  await selectItem(page, name);
  await expect(page.locator('[data-testid="block-editor"]:visible')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("the honest states", () => {
  test("settles on synchronized once the server has confirmed", async ({ page }) => {
    const name = uniqueName("SaveStates");
    await openPage(page, name);

    await typeIntoEditor(page, "some words");
    await saveDocument(page, { until: "synced" });

    await expect(indicator(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
    await expect(page.getByTestId("editor-sync-label")).toHaveText("Synchronisé");
  });

  test("never says synchronized before the server has confirmed", async ({ page }) => {
    // FR-026, stated as the negative it is. The server is unreachable, so the
    // only honest answers are « enregistré sur cet appareil » or « en attente
    // d'envoi » — and « synchronisé » must not appear at any point.
    const name = uniqueName("NeverPremature");
    await openPage(page, name);

    await setDeviceOffline(page, true);
    try {
      // Every value the indicator takes from the first keystroke onward, not
      // one look after an arbitrary delay. The page was synchronized before
      // going offline; that earlier state is not part of the claim.
      await expect(indicator(page)).toHaveAttribute("data-sync", "offline");
      const sync = await recordAttribute(page, '[data-testid="editor-sync-status"]', "data-sync");
      await typeIntoEditor(page, "written while the server is gone");
      await saveDocument(page);
      // The window closes on the honest answer, observed positively: the
      // write is durable here and the indicator reports the missing server.
      await expect(indicator(page)).toHaveAttribute("data-sync", "offline");
      await expect(indicator(page)).toHaveAttribute("data-durable", "true");
      expect(await sync.values()).not.toContain("synced");
      await expect(page.getByTestId("editor-sync-label")).not.toHaveText("Synchronisé");
    } finally {
      await setDeviceOffline(page, false);
    }
  });

  test("says the work is kept on this device while offline", async ({ page }) => {
    // US4 scenario 3. The owner's question offline is different — will this
    // survive? — so the wording answers that rather than reporting a queue.
    const name = uniqueName("OfflineWording");
    await openPage(page, name);

    await setDeviceOffline(page, true);
    try {
      await typeIntoEditor(page, "offline words");
      await saveDocument(page);

      await expect(indicator(page)).toHaveAttribute("data-state", "offline", { timeout: 30_000 });
      await expect(page.getByTestId("editor-sync-label")).toContainText("hors ligne");
      await expect(page.getByTestId("editor-sync-label")).toContainText(
        "Enregistré sur cet appareil",
      );
    } finally {
      await setDeviceOffline(page, false);
    }
  });

  test("resolves to synchronized once the connection returns", async ({ page }) => {
    const name = uniqueName("Resolves");
    await openPage(page, name);

    await setDeviceOffline(page, true);
    await typeIntoEditor(page, "written offline");
    await saveDocument(page);
    await expect(indicator(page)).not.toHaveAttribute("data-sync", "synced");

    await setDeviceOffline(page, false);
    // Reopening also proves a persisted queue resumes after the connection
    // comes back rather than relying on the still-mounted editor.
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await saveDocument(page, { until: "synced" });
    await expect(page.getByTestId("editor-sync-label")).toHaveText("Synchronisé", {
      timeout: 30_000,
    });
  });
});

test.describe("what survives an unexpected close", () => {
  test("the last completed edit is there when the application reopens", async ({ page }) => {
    // FR-028, proven without any button: durability is the local commit, so
    // waiting for it is enough — reloading is what a closed laptop lid looks
    // like from here.
    const name = uniqueName("Survives");
    await openPage(page, name);

    await typeIntoEditor(page, "typed before the crash");
    // `data-durable` is set from the session's committed local frontier. A
    // reload keeps the browser's storage, so nothing else has to settle; if a
    // committed edit were lost here, the application acknowledged it too early.
    await saveDocument(page);

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await expect(page.locator('[data-testid="block-editor"]:visible')).toContainText(
      "typed before the crash",
      {
        timeout: 30_000,
      },
    );
  });
});

test.describe("as assistive technology sees it", () => {
  test("is a polite live region rather than an interruption", async ({ page }) => {
    // FR-020. Polite on purpose: this changes with every queued change, and a
    // region that interrupts constantly is one an owner switches off — after
    // which it announces nothing at all, including the states that matter.
    const name = uniqueName("Announced");
    await openPage(page, name);

    await expect(indicator(page)).toHaveAttribute("role", "status");
    await expect(indicator(page)).toHaveAttribute("aria-live", "polite");
  });

  test("says more than a colour", async ({ page }) => {
    // SC-010 asks for four distinct states. Distinguishing them by colour alone
    // would leave an owner who cannot see the difference with no answer at all.
    const name = uniqueName("NotJustColour");
    await openPage(page, name);
    await expect(page.getByTestId("editor-sync-label")).not.toBeEmpty();
  });
});

test.describe("when the server refuses the write", () => {
  // A real refusal, produced by a real rotation deadline rather than by an
  // intercepted response. Local-first means the refusal changes the wording,
  // not the safety of the words: they are already durable on this device, and
  // they stay visible until sending can resume.
  test.afterEach(async () => {
    // Unconditional: a policy left in place blocks writes for every journey
    // that follows, and those failures point nowhere near this file.
    await setDataKeyWriteBlock(false);
  });

  /**
   * A page that exists, and then a block.
   *
   * The block has to arrive second. It refuses *every* protected write, so
   * installing it first means the page cannot be created either — which is also
   * the shape of the real situation: an owner has notes already, and saving to
   * the server stops working.
   */
  async function pageThenBlock(page: import("@playwright/test").Page, name: string): Promise<void> {
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.locator('[data-testid="block-editor"]:visible')).toBeVisible({
      timeout: 30_000,
    });
    await setDataKeyWriteBlock(true);
  }

  test("keeps the work durable and readable while sending is refused", async ({ page }) => {
    const name = uniqueName("Blocked");
    // The claim is about a refused send, so the window closes on one. Frames
    // are events: listen before the page opens its synchronization socket.
    const refused = nextPageSyncProblem(page);
    await pageThenBlock(page, name);
    // The page starts synchronized: that state belongs to before the edit and
    // is the value the history excludes, so it must be in place first.
    await expect(indicator(page)).toHaveAttribute("data-sync", "synced", { timeout: 30_000 });
    const sync = await recordAttribute(page, '[data-testid="editor-sync-status"]', "data-sync");
    await typeIntoEditor(page, "Notes taken while saving was paused");
    await saveDocument(page);
    await refused;

    // Whatever the transport decides — retry later or report the block — the
    // two facts an owner needs are unchanged: the words are on this device,
    // and the server has not confirmed them.
    await expect(indicator(page)).toHaveAttribute("data-durable", "true", { timeout: 30_000 });
    await expect(indicator(page)).not.toHaveAttribute("data-sync", "synced");
    expect(await sync.values()).not.toContain("synced");
    await expect(page.locator('[data-testid="block-editor"]:visible')).toContainText(
      "Notes taken while saving was paused",
    );
    await expect(page.getByTestId("editor-sync-label")).not.toHaveText("Synchronisé");
  });
});
