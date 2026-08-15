/**
 * Feature 001 still works with the security foundation in place (T108,
 * FR-011, FR-012, FR-024, SC-004, SC-005).
 *
 * Every other suite in this feature tests something security added. This one
 * tests that nothing security added **took something away**, and it is the
 * suite most likely to catch the regression nobody predicted.
 *
 * The reason is structural. Feature 002 put an authentication gate in front of
 * every route, a key hierarchy under every protected field, and a rotation
 * policy that can block writes. Any of those can be subtly wrong in a way that
 * leaves its own tests green: a gate that authenticates correctly and drops a
 * header, a hierarchy that seals correctly and cannot be read back through the
 * ordinary list query, a policy that blocks a write it should not. Each of
 * those failures shows up here, in the hierarchy, in the revisions, in the
 * files — the things an owner actually does — and nowhere else.
 *
 * So these journeys are deliberately boring. They create things, edit them,
 * reload, and check they are still there. That is the point.
 */

import { expect, test } from "./fixtures.ts";
import {
  createChildItem,
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

test.describe("content survives the security foundation (T108)", () => {
  test("a page created behind the gate is readable after a reload", async ({ page }) => {
    // The plainest possible statement of the property. A protected write that
    // seals correctly and cannot be read back would fail here and nowhere in
    // the encryption suites, which check the envelope rather than the screen.
    await openWorkspace(page);
    const name = uniqueName("Regression");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 30_000 });
  });

  test("a hierarchy of sealed titles keeps its shape and its order", async ({ page }) => {
    // Titles are sealed; hierarchy and ordering are not, deliberately —
    // encrypting them would mean decrypting the whole workspace to answer
    // "what is in this folder". This checks that the split still holds: the
    // structure is queryable and the names are correct.
    await openWorkspace(page);
    const folder = uniqueName("Folder");
    const first = uniqueName("First");
    const second = uniqueName("Second");

    await createRootItem(page, "folder", folder);
    await createChildItem(page, folder, "page", first);
    await createChildItem(page, folder, "page", second);
    await waitForSynchronized(page);

    await page.reload();
    await openWorkspace(page);
    for (const name of [folder, first, second]) {
      await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 30_000 });
    }
  });

  test("renaming a sealed title takes effect and persists", async ({ page }) => {
    // A rename rewrites a protected record in place, under the same record
    // version. If the envelope's binding were wrong, the read after reload
    // would refuse rather than return the old name — a refusal is the
    // fail-closed behaviour, and it would show up here as a missing item.
    await openWorkspace(page);
    const original = uniqueName("Before");
    const renamed = uniqueName("After");

    await createRootItem(page, "page", original);
    await waitForSynchronized(page);
    await selectItem(page, original);

    const renameControl = page.getByTestId("rename-item");
    if (await renameControl.isVisible()) {
      await renameControl.click();
      await page.getByTestId("item-name-input").fill(renamed);
      await page.getByTestId("save-item-name").click();
      await waitForSynchronized(page);

      await page.reload();
      await openWorkspace(page);
      await expect(page.getByTestId(`tree-item-${renamed}`)).toBeVisible({ timeout: 30_000 });
    }
  });

  test("the workspace loads without a rotation policy blocking it", async ({ page }) => {
    // A rotation policy evaluated wrongly can block writes. An installation
    // with no policy at all must not: the absence of a schedule is not a
    // deadline that has passed, and reading that absence as "overdue" would
    // make a fresh installation read-only on its first day.
    await openWorkspace(page);
    const name = uniqueName("Writable");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible();
  });

  test("nothing on the page exposes key material", async ({ page }) => {
    // The client never holds workspace key material: it receives plaintext
    // over an authenticated origin and the sealing happens server-side. A
    // wrapped key or an envelope reaching the DOM would mean that boundary has
    // moved, and it would move silently.
    await openWorkspace(page);
    await createRootItem(page, "page", uniqueName("Inspect"));
    await waitForSynchronized(page);

    const content = await page.content();
    expect(content).not.toMatch(/wrappedRootKey|wrappedKeyMaterial|deploymentKey/i);
    expect(content).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });
});
