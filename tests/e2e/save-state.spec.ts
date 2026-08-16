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

// KNOWN DEFECT, deliberately recorded here rather than asserted as passing.
//
// The spec edge case "a page open in two tabs: the second must not silently
// overwrite the first tab-s newer content" does not hold today. A journey
// written for it fails: the second tab settles on a clean "Saved".
//
// The cause is worth writing down because it is not the obvious one. Both tabs
// share one IndexedDB, and the save path re-reads the item immediately before
// submitting -- so the second tab picks up the *current* revision as its base
// and the write is causally correct. Nothing conflicts. What is stale is only
// what the second tab is showing, and the editor does not notice that the
// document changed underneath it.
//
// Fixing it means the editor watching for external changes to the open
// document and telling the owner, not tightening the causal check, which is
// already doing its job. Tracked rather than patched late.
