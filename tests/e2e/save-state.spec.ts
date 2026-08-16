/**
 * Knowing whether the work is saved (T044-T047, US2).
 *
 * The journey a note-taking application lives or dies by. Feature 001 already
 * reconciled correctly; what was missing was telling the owner what it was
 * doing — and the failure this suite guards against is not silence but
 * *optimism*: an interface that says "saved" before the server has agreed
 * destroys trust exactly as thoroughly as one that loses the work.
 *
 * So the strongest assertion here is a negative one: at no point between typing
 * and the server confirming does the indicator read "Saved".
 */

import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";
import { setDataKeyWriteBlock } from "./reset-installation.ts";

function indicator(page: import("@playwright/test").Page) {
  return page.getByTestId("save-state");
}

async function openPage(page: import("@playwright/test").Page, name: string): Promise<void> {
  await openWorkspace(page);
  await createRootItem(page, "page", name);
  await waitForSynchronized(page);
  await selectItem(page, name);
  await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
}

test.describe("the four states", () => {
  test("settles on saved once the server has confirmed", async ({ page }) => {
    const name = uniqueName("SaveStates");
    await openPage(page, name);

    await typeIntoEditor(page, "some words");
    await page.getByTestId("save-document").click();
    await waitForSynchronized(page);

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
    await expect(page.getByTestId("save-state-label")).toHaveText("Saved");
  });

  test("never says saved before the server has confirmed", async ({ page }) => {
    // FR-008, stated as the negative it is. The server is unreachable, so the
    // only honest answers are "not saved yet" or "kept on this device" — and
    // "Saved" must not appear at any point.
    const name = uniqueName("NeverPremature");
    await openPage(page, name);

    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await typeIntoEditor(page, "written while the server is gone");
    await page.getByTestId("save-document").click();

    // Give the interface every chance to be wrong.
    await page.waitForTimeout(2_000);
    await expect(indicator(page)).not.toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("save-state-label")).not.toHaveText("Saved");
  });

  test("says the work is kept on this device while offline", async ({ page }) => {
    // US2 scenario 2. The owner's question offline is different — will this
    // survive? — so the wording answers that rather than reporting a state.
    const name = uniqueName("OfflineWording");
    await openPage(page, name);

    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await typeIntoEditor(page, "offline words");
    await page.getByTestId("save-document").click();

    await expect(indicator(page)).toHaveAttribute("data-state", "unsaved", { timeout: 30_000 });
    await expect(page.getByTestId("save-state-detail")).toContainText(/offline/i);
    await expect(page.getByTestId("save-state-detail")).toContainText(/sent when/i);
  });

  test("resolves to saved once the connection returns", async ({ page }) => {
    const name = uniqueName("Resolves");
    await openPage(page, name);

    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await typeIntoEditor(page, "written offline");
    await page.getByTestId("save-document").click();
    await expect(indicator(page)).toHaveAttribute("data-state", "unsaved", { timeout: 30_000 });

    await page.unroute("**/v1/**");
    // The client reconciles when it starts and when asked, not on a timer.
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  });
});

test.describe("what survives an unexpected close", () => {
  test("the last completed edit is there when the application reopens", async ({ page }) => {
    // FR-009. Not a graceful shutdown: the page is reloaded out from under the
    // editor, which is what a closed laptop lid looks like from here.
    const name = uniqueName("Survives");
    await openPage(page, name);

    await typeIntoEditor(page, "typed before the crash");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    await expect(page.getByTestId("block-editor")).toContainText("typed before the crash", {
      timeout: 30_000,
    });
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
    await expect(page.getByTestId("save-state-label")).not.toBeEmpty();
  });
});

test.describe("when the server refuses the write", () => {
  // A real refusal, produced by a real rotation deadline rather than by an
  // intercepted response. What is being tested is that the three statements
  // FR-010 requires reach the owner through the whole stack — a mocked 4xx
  // would prove the component renders and nothing about the path that gets
  // there.
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
   * the shape of the real situation: an owner has notes already, and saving
   * stops working.
   */
  async function pageThenBlock(page: import("@playwright/test").Page, name: string): Promise<void> {
    await openWorkspace(page);
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await setDataKeyWriteBlock(true);
  }

  test("says what is refused, that the content is readable, and what would fix it", async ({
    page,
  }) => {
    const name = uniqueName("Blocked");
    await pageThenBlock(page, name);
    await typeIntoEditor(page, "Notes taken while saving was paused");
    await page.getByTestId("save-document").click();

    const notice = page.getByTestId("blocked-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("blocked-what")).not.toBeEmpty();
    // The one an owner is really asking. "Is my work gone" deserves an answer
    // in words, on the screen where the refusal appeared.
    await expect(page.getByTestId("blocked-readable")).toContainText(/still here|still readable/i);
    await expect(page.getByTestId("blocked-resolution")).not.toBeEmpty();
    // Announced, not merely shown (FR-020).
    await expect(notice).toHaveAttribute("role", "alert");
  });

  test("the indicator agrees with the notice", async ({ page }) => {
    const name = uniqueName("BlockedState");
    await pageThenBlock(page, name);
    await typeIntoEditor(page, "More notes");
    await page.getByTestId("save-document").click();

    // Two views of one derivation. If they could disagree, one of them would be
    // reading something other than the outbox — which is the whole point of
    // deriving the state rather than tracking it.
    await expect(page.getByTestId("blocked-notice")).toBeVisible({ timeout: 30_000 });
    await expect(indicator(page)).toHaveAttribute("data-state", "blocked");
    await expect(indicator(page)).not.toContainText("Saved");
  });
});

test.describe("the same page open in two tabs", () => {
  // The spec edge case, and it was a real defect until this batch: the stale
  // tab saved over newer content and reported a clean "Saved".
  //
  // Worth restating why, because the obvious diagnosis is wrong. The causal
  // check was never at fault. Both tabs share one IndexedDB and the save path
  // re-reads the item immediately before submitting, so the base revision it
  // used was genuinely current and nothing conflicted. The write was causally
  // correct and still destroyed work, because the document it carried had been
  // composed against a version that tab last saw minutes earlier.
  //
  // Nor could a watcher fix it: `service.subscribe` is a set of listeners held
  // in memory, so no tab is ever told what another one wrote. The check has to
  // happen where both facts are available at once — at save time.
  test("the tab that fell behind refuses to overwrite the newer version", async ({
    page,
    context,
  }) => {
    const name = uniqueName("TwoTabs");
    await openPage(page, name);
    await typeIntoEditor(page, "written in the first tab");
    await page.getByTestId("save-document").click();
    await waitForSynchronized(page);

    // A second tab opens the same page and gets ahead of the first.
    const second = await context.newPage();
    await openWorkspace(second);
    await selectItem(second, name);
    await expect(second.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await typeIntoEditor(second, "written in the second tab, later");
    await second.getByTestId("save-document").click();
    await waitForSynchronized(second);

    // The first tab is now showing a document that is no longer current, and
    // it does not know it. Saving from here is the moment that used to lose
    // the second tab's work.
    await typeIntoEditor(page, " and more from the stale tab");
    await page.getByTestId("save-document").click();

    const refusal = page.getByTestId("save-error");
    await expect(refusal).toBeVisible({ timeout: 30_000 });
    // Named, so the owner can act: which version is at risk, and what to do.
    await expect(refusal).toContainText(/changed somewhere else/i);
    await expect(page.getByTestId("document-saved")).toHaveCount(0);

    await second.close();
  });

  test("the newer version is what survives", async ({ page, context }) => {
    // The refusal is only worth having if it protects the content. This is the
    // assertion that would have caught the original defect: it reads the
    // document back and finds the second tab's words, not the stale tab's.
    const name = uniqueName("TwoTabsKeeps");
    await openPage(page, name);
    await typeIntoEditor(page, "first tab text");
    await page.getByTestId("save-document").click();
    await waitForSynchronized(page);

    const second = await context.newPage();
    await openWorkspace(second);
    await selectItem(second, name);
    await expect(second.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });
    await typeIntoEditor(second, "second tab wins");
    await second.getByTestId("save-document").click();
    await waitForSynchronized(second);

    await typeIntoEditor(page, " stale words");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("save-error")).toBeVisible({ timeout: 30_000 });

    // Reload the stale tab: it now shows the version that was kept.
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, name);
    await expect(page.getByTestId("block-editor")).toContainText("second tab wins", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("block-editor")).not.toContainText("stale words");

    await second.close();
  });
});
