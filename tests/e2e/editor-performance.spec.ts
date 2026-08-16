/**
 * The editor at 500 blocks (T071, SC-005, SC-006).
 *
 * Two numbers the specification names, and they are about the same thing from
 * two angles: whether a document large enough to be someone's real notes stays
 * usable. A block editor that is pleasant at ten blocks and sluggish at five
 * hundred is one an owner abandons after a month, when the abandoning is most
 * expensive.
 *
 * Measured in the browser rather than inferred from unit timings, because what
 * SC-005 asks about is the delay between a key going down and something
 * appearing — which involves the schema, React, and layout, none of which a
 * pure benchmark exercises.
 *
 * The thresholds are deliberately the specification's, not comfortable ones. If
 * they fail on a loaded machine that is worth knowing; the run is short enough
 * to repeat.
 */

import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures.ts";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const BLOCK_COUNT = 500;

/** A document of `BLOCK_COUNT` paragraphs, written straight to the server. */
function largeDocument(): { blocks: Array<Record<string, unknown>> } {
  return {
    blocks: Array.from({ length: BLOCK_COUNT }, (_, index) => ({
      type: "paragraph",
      // Deterministic identifiers so a failure is reproducible.
      id: `01924f8e-7c1a-7000-8000-${String(index).padStart(12, "0")}`,
      content: [{ text: `Line ${index} of a document that is large but not absurd.` }],
    })),
  };
}

test.describe(`a document of ${BLOCK_COUNT} blocks`, () => {
  test("opens and becomes editable within 2 seconds (SC-006)", async ({ page, request }) => {
    await openWorkspace(page);
    const name = uniqueName("LargeDoc");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    const itemId = await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id");
    const current = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;
    const seeded = await request.put(`http://127.0.0.1:3001/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: head,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: largeDocument(),
        },
      },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);

    // Timed from the moment the page is asked for to the moment the editor is
    // there with content in it — which is what "opens and becomes editable"
    // means to someone waiting for it.
    const started = Date.now();
    await selectItem(page, name);
    const surface = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(surface).toContainText("Line 499", { timeout: 30_000 });
    const elapsed = Date.now() - started;

    expect(elapsed, `opening took ${elapsed}ms`).toBeLessThan(2_000);
  });

  test("keeps typing responsive at the 95th percentile (SC-005)", async ({ page, request }) => {
    await openWorkspace(page);
    const name = uniqueName("TypingDoc");
    await createRootItem(page, "page", name);
    await waitForSynchronized(page);
    await selectItem(page, name);

    const itemId = await page.getByTestId(`tree-item-${name}`).getAttribute("data-item-id");
    const current = await request.get(`http://127.0.0.1:3001/v1/items/${itemId}`);
    const head = ((await current.json()) as { currentRevisionId: string }).currentRevisionId;
    await request.put(`http://127.0.0.1:3001/v1/pages/${itemId}/document`, {
      headers: { "idempotency-key": randomUUID() },
      data: {
        baseRevisionId: head,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: largeDocument(),
        },
      },
    });

    await page.reload();
    await openWorkspace(page);
    await waitForSynchronized(page);
    await selectItem(page, name);

    const surface = page.getByTestId("block-editor").locator(".ProseMirror");
    await expect(surface).toContainText("Line 0", { timeout: 30_000 });
    await surface.click();

    // Each sample is one keystroke to the DOM reflecting it. Measured in the
    // page so the number is the browser's, not the test runner's round trip.
    const samples: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const elapsed = await page.evaluate(async () => {
        const start = performance.now();
        document.execCommand("insertText", false, "x");
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        return performance.now() - start;
      });
      samples.push(elapsed);
    }

    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    expect(p95, `p95 keystroke latency was ${Math.round(p95)}ms`).toBeLessThan(100);
  });
});
