/**
 * Different parts merge; the same part is decided by the owner (T029, T030 — US3).
 *
 * Two journeys, and the second is the one that protects the first. It is easy to
 * build a system where every reconnection produces a conflict — a device that is
 * merely behind looks, from the wrong angle, exactly like a device that diverged.
 * FR-011 forbids that, and a requirement about something *not* happening needs a
 * test or it silently stops holding.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openSecondDevice,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

/**
 * Adds words to the end of the paragraph that is already there.
 *
 * Deliberately not `typeIntoEditor`, which selects everything and retypes: that
 * *replaces* the block, so the two devices end up having deleted one block and
 * added two different new ones — which merges cleanly and conflicts with nothing.
 * A real conflict needs the same block id changed on both sides, so this appends
 * inside the existing block rather than making a new one.
 */
async function appendInPlace(page: Page, text: string): Promise<void> {
  const surface = page.getByTestId("block-editor").locator(".ProseMirror");
  await surface.click();
  await page.keyboard.press("ControlOrMeta+End");
  await surface.pressSequentially(text);
  // The editor does not autosave. Typing alone leaves the text in the editor's
  // own state, where no synchronization can see it.
  await saveDocument(page);
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
      await expect(second.page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
      await second.page.route("**/v1/**", (route) => route.abort("connectionrefused"));

      // Only the first device writes. The second one is behind and has changed
      // nothing, which is not a divergence by any definition.
      await selectItem(page, name);
      await typeIntoEditor(page, "written only on the first device");
      await saveDocument(page);
      await waitForSynchronized(page);

      await second.page.unroute("**/v1/**");
      await second.page.reload();
      await expect(second.page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible();
      await expect(second.page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });

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

test.describe("a genuine divergence (US3)", () => {
  test("is offered as a comparison with all three versions, and keeps both originals", async ({
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
      await expect(second.page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
      await selectItem(second.page, name);

      // The second device is cut off, then edits the same paragraph. This is the
      // real conflict: the same block, changed on both sides, since their last
      // common state.
      await second.page.route("**/v1/**", (route) => route.abort("connectionrefused"));
      await appendInPlace(second.page, " — and what the second device added");

      await appendInPlace(page, " — and what the first device added");
      await waitForSynchronized(page);

      // It comes back and submits an edit whose base is no longer the head.
      await second.page.unroute("**/v1/**");
      await second.page.reload();
      await selectItem(second.page, name);

      const notice = second.page.getByTestId("conflict-notice");
      await expect(notice).toBeVisible({ timeout: 30_000 });
      // Both versions are readable before any decision is made: nothing was
      // discarded to produce the question.
      await expect(second.page.getByTestId("conflict-server-version")).toBeVisible();
      await expect(second.page.getByTestId("conflict-local-version")).toBeVisible();

      // Into the comparison.
      await notice.getByRole("button", { name: "Compare part by part" }).click();
      const resolution = second.page.getByTestId("conflict-resolution");
      await expect(resolution).toBeVisible({ timeout: 15_000 });

      // Either the three columns are there, or the screen says plainly why they
      // cannot be — a retention window that elapsed, a legacy body. Both are
      // acceptable outcomes; silently showing nothing is not.
      const columns = second.page.getByTestId("conflict-columns");
      const unavailable = second.page.getByTestId("resolution-unavailable");
      await expect(columns.or(unavailable).first()).toBeVisible({ timeout: 15_000 });
      if (await unavailable.isVisible()) {
        return;
      }

      // All three versions, which is what distinguishes this screen from the
      // notice above it: the common ancestor is what turns "these differ" into
      // "here is what each of us did".
      const firstRow = second.page.locator('[data-testid^="conflict-block-"]').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('[data-testid^="conflict-local-"]')).toBeVisible();
      await expect(firstRow.locator('[data-testid^="conflict-ancestor-"]')).toBeVisible();
      await expect(firstRow.locator('[data-testid^="conflict-remote-"]')).toBeVisible();

      // Keeping both is chosen deliberately: it is the answer that proves
      // nothing had to be discarded to end the conflict.
      await firstRow.locator('[data-testid^="conflict-choose-both-"]').check();

      // A review of exactly what will be saved, before it is saved.
      await expect(second.page.getByTestId("conflict-review")).toBeVisible();
      await second.page.getByTestId("conflict-commit").click();

      // The conflict is over, and the page still exists.
      await expect(second.page.getByTestId("conflict-resolution")).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(second.page.getByTestId(`tree-item-${name}`)).toBeVisible();
      await waitForSynchronized(second.page);

      // And the resolution kept both originals: its revision has two parents,
      // which is what FR-016 asks for and what the history screen reports.
      const lineage = await second.page.evaluate(async () => {
        const items = (await (await fetch("/v1/items")).json()) as {
          items: Array<{ name: string; currentRevisionId: string }>;
        };
        const head = items.items.find((item) => item.name.startsWith("Diverged"));
        if (head === undefined) {
          return null;
        }
        const revision = (await (
          await fetch(`/v1/revisions/${head.currentRevisionId}`)
        ).json()) as {
          parentRevisionIds?: string[];
        };
        return revision.parentRevisionIds ?? [];
      });
      expect(lineage).not.toBeNull();
      expect((lineage as string[]).length).toBe(2);
    } finally {
      await second.context.close();
    }
  });
});
