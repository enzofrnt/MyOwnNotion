/**
 * Converting a page into a folder, and back (T023, T024, T031, T032, US1, US2).
 *
 * The journeys an owner actually takes. Three things are asserted here that no
 * lower level can reach:
 *
 *   - **the warning says what is lost, and for how long it can be undone.**
 *     A dialog that says "are you sure?" is one an owner learns to click
 *     through; one that names the content and the retention limit is one they
 *     can act on.
 *   - **declining changes nothing.** The most important property of a
 *     destructive control is what happens when it is refused.
 *   - **children survive on screen**, not only in the database. The integration
 *     suite proves the rows are there; this proves the owner can still see
 *     them.
 */

import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  expectNoHorizontalOverflow,
  openWorkspace,
  readTreeOrder,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

function convertButton(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId(`convert-${name}`);
}

/**
 * Clicks the conversion control and waits for the *item* to have changed.
 *
 * Waiting only on the sync queue is not enough: the click starts asynchronous
 * work, and the queue can look settled before that work has enqueued anything.
 * The control's own label is the observable outcome — it says "to folder" on a
 * page and "to page" on a folder — so waiting for it to flip waits for the
 * thing the test is actually about.
 */
async function convertAndSettle(
  page: import("@playwright/test").Page,
  name: string,
  becomes: "page" | "folder",
): Promise<void> {
  await convertButton(page, name).click();
  await expect(convertButton(page, name)).toHaveText(becomes === "page" ? "to folder" : "to page", {
    timeout: 30_000,
  });
  await waitForSynchronized(page);
}

test.describe("turning a folder into a page", () => {
  test("keeps every child and gains somewhere to write", async ({ page }) => {
    // US1 end to end. The non-destructive direction, which needs no
    // confirmation because nothing is at stake.
    await openWorkspace(page);
    const folder = uniqueName("Container");
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);

    const first = uniqueName("Alpha");
    const second = uniqueName("Beta");
    await createChildItem(page, folder, "page", first);
    // Between the two, not only after: the tree re-renders as each creation
    // reconciles, and a second creation launched into that re-render loses the
    // element it was about to act on. WebKit is slow enough to show it.
    await waitForSynchronized(page);
    await createChildItem(page, folder, "page", second);
    await waitForSynchronized(page);

    await convertAndSettle(page, folder, "page");

    // No dialog: nothing was lost, so nothing was asked.
    await expect(page.getByTestId("convert-confirmation")).toBeHidden();

    await selectItem(page, folder);
    await expect(page.getByTestId("block-editor")).toBeVisible({ timeout: 30_000 });

    // Both children are still in the tree, in the order they were created.
    const order = await readTreeOrder(page);
    expect(order.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(second)).toBeGreaterThan(order.indexOf(first));
  });

  test("the converted page accepts and keeps content", async ({ page }) => {
    await openWorkspace(page);
    const folder = uniqueName("WillHoldText");
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);

    await convertAndSettle(page, folder, "page");
    await selectItem(page, folder);

    await typeIntoEditor(page, "now it has words");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, folder);
    await expect(page.getByTestId("block-editor")).toContainText("now it has words", {
      timeout: 30_000,
    });
  });
});

test.describe("turning a page into a folder", () => {
  test("converts an empty page without warning about content it does not have", async ({
    page,
  }) => {
    // US2 scenario 6. Every page has a document from the moment it is created,
    // so warning here would fire on a page made a minute ago and never typed
    // in — which is how an owner learns to dismiss the warning that matters.
    await openWorkspace(page);
    const empty = uniqueName("NeverTyped");
    await createRootItem(page, "page", empty);
    await waitForSynchronized(page);

    await convertAndSettle(page, empty, "folder");

    await expect(page.getByTestId("convert-confirmation")).toBeHidden();
  });

  test("warns before destroying content, naming what goes and for how long it can be undone", async ({
    page,
  }) => {
    await openWorkspace(page);
    const written = uniqueName("HasWords");
    await createRootItem(page, "page", written);
    await waitForSynchronized(page);
    await selectItem(page, written);
    await typeIntoEditor(page, "something worth keeping");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, written).click();

    const dialog = page.getByTestId("convert-confirmation");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // Names the loss rather than asking a vague question.
    await expect(dialog).toContainText(/deleted/i);
    // And says the recovery is bounded, so the owner is not promised a
    // reversibility that expires in silence.
    await expect(page.getByTestId("convert-retention-notice")).toContainText(
      /only for as long as/i,
    );
    // And says what is *not* lost, which is most of what they have.
    await expect(dialog).toContainText(/underneath/i);
  });

  test("declining leaves the page exactly as it was", async ({ page }) => {
    // The property that matters most about a destructive control.
    await openWorkspace(page);
    const kept = uniqueName("Declined");
    await createRootItem(page, "page", kept);
    await waitForSynchronized(page);
    await selectItem(page, kept);
    await typeIntoEditor(page, "still here afterwards");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, kept).click();
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("cancel-convert").click();
    await expect(page.getByTestId("convert-confirmation")).toBeHidden();

    await selectItem(page, kept);
    await expect(page.getByTestId("block-editor")).toContainText("still here afterwards");
  });

  test("accepting destroys the content and keeps every child", async ({ page }) => {
    await openWorkspace(page);
    const parent = uniqueName("Sacrificed");
    await createRootItem(page, "page", parent);
    await waitForSynchronized(page);

    const child = uniqueName("Survivor");
    await createChildItem(page, parent, "page", child);
    await waitForSynchronized(page);

    await selectItem(page, parent);
    await typeIntoEditor(page, "about to be deleted");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, parent).click();
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("confirm-convert").click();
    await waitForSynchronized(page);

    // The child is still in the tree: what is *under* an item is never what a
    // conversion destroys.
    await expect(page.getByTestId(`tree-item-${child}`)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("the confirmation as a dialog", () => {
  test("closes on Escape and returns focus to the control that opened it", async ({ page }) => {
    // FR-018. Focus landing on <body> after a dialog closes is the usual way a
    // keyboard journey ends without anyone noticing.
    await openWorkspace(page);
    const name = uniqueName("Escapable");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await typeIntoEditor(page, "content that triggers the dialog");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, name).click();
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("convert-confirmation")).toBeHidden();
    await expect(convertButton(page, name)).toBeFocused();
  });

  test("is announced as an alert dialog", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("Announced");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await typeIntoEditor(page, "content that triggers the dialog");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, name).click();
    const dialog = page.getByTestId("convert-confirmation");
    await expect(dialog).toHaveAttribute("role", "alertdialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});

test.describe("at a narrow viewport", () => {
  test("the confirmation is readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openWorkspace(page);
    const name = uniqueName("Narrow");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await typeIntoEditor(page, "content that triggers the dialog");
    await page.getByTestId("save-document").click();
    await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 30_000 });
    await waitForSynchronized(page);

    await convertButton(page, name).click();
    await expect(page.getByTestId("convert-confirmation")).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page);
  });
});

test.describe("the two relations a page has", () => {
  test("hierarchy children and content attachments never appear in the same list", async ({
    page,
  }) => {
    // US3, FR-015 and FR-016. The distinction has existed in stored data since
    // feature 001 — a placement is either `hierarchy` or `attachment` — and the
    // failure this guards against is presentational: merge the two and a file
    // the owner filed under a page becomes indistinguishable from one embedded
    // in its text, or disappears from the tree entirely.
    await openWorkspace(page);
    const parent = uniqueName("TwoRelations");
    await createRootItem(page, "page", parent);
    await waitForSynchronized(page);

    const filed = uniqueName("FiledUnder");
    await createChildItem(page, parent, "page", filed);
    await waitForSynchronized(page);

    await selectItem(page, parent);

    // The hierarchy child is in the tree.
    await expect(page.getByTestId(`tree-item-${filed}`)).toBeVisible({ timeout: 30_000 });

    // The attachments panel is a separate region and does not list it.
    const attachments = page.getByRole("region", { name: /attachments/i });
    await expect(attachments).toBeVisible();
    await expect(attachments).not.toContainText(filed);
  });

  test("a folder offers no attachments panel at all", async ({ page }) => {
    // Not an empty one: a folder has no content, so it has nothing to attach
    // files to, and showing an empty panel would suggest otherwise.
    await openWorkspace(page);
    const folder = uniqueName("JustAFolder");
    await createRootItem(page, "folder", folder);
    await waitForSynchronized(page);
    await selectItem(page, folder);

    await expect(page.getByRole("region", { name: /attachments/i })).toBeHidden();
  });

  test("converting a page to a folder takes its attachments panel with it", async ({ page }) => {
    await openWorkspace(page);
    const name = uniqueName("LosesPanel");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);
    await expect(page.getByRole("region", { name: /attachments/i })).toBeVisible();

    await convertAndSettle(page, name, "folder");
    await selectItem(page, name);

    await expect(page.getByRole("region", { name: /attachments/i })).toBeHidden();
  });
});

test.describe("order and placement", () => {
  test("a conversion leaves sibling order untouched", async ({ page }) => {
    // US4. The order is the owner's, and a conversion is not an occasion to
    // renegotiate it.
    await openWorkspace(page);
    const first = uniqueName("AAFirst");
    const middle = uniqueName("BBMiddle");
    const last = uniqueName("CCLast");
    for (const name of [first, middle, last]) {
      await createRootItem(page, "folder", name);
      await waitForSynchronized(page);
    }

    const before = await readTreeOrder(page);
    await convertAndSettle(page, middle, "page");
    const after = await readTreeOrder(page);

    expect(after.indexOf(first)).toBeLessThan(after.indexOf(middle));
    expect(after.indexOf(middle)).toBeLessThan(after.indexOf(last));
    expect(after).toEqual(before);
  });
});

test.describe("offline", () => {
  test("a conversion made offline reaches the server once it returns", async ({ page }) => {
    // The conversion is an ordinary mutation, so it queues and reconciles like
    // every other one. What is worth asserting is that it does not need a
    // special path — and that the outcome is the one the owner chose.
    await openWorkspace(page);
    const name = uniqueName("OfflineConvert");
    await createRootItem(page, "folder", name);
    await waitForSynchronized(page);

    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await convertButton(page, name).click();
    await expect(convertButton(page, name)).toHaveText("to folder", { timeout: 30_000 });

    await page.unroute("**/v1/**");
    // Reload before waiting: the client reconciles when it starts and when it
    // is asked to, not on a timer, so removing the route does not by itself
    // make the queue drain. The existing offline suite does the same, and
    // waiting first simply times out.
    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    // Still a page after the round trip: the queued conversion was accepted.
    await expect(convertButton(page, name)).toHaveText("to folder");
  });
});
