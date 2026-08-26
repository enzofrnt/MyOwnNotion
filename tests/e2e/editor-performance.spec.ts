/**
 * The editor at 500 blocks (SC-007).
 *
 * Two numbers the specification names, and they are about the same thing from
 * two angles: whether a document large enough to be someone's real notes stays
 * usable. A block editor that is pleasant at ten blocks and sluggish at five
 * hundred is one an owner abandons after a month, when the abandoning is most
 * expensive.
 *
 * Measured in the browser rather than inferred from unit timings, because what
 * SC-007 asks about is the delay between a key going down and something
 * appearing — which involves the schema, React, and layout, none of which a
 * pure benchmark exercises.
 *
 * The thresholds are deliberately the specification's, not comfortable ones. If
 * they fail on a loaded machine that is worth knowing; the run is short enough
 * to repeat.
 */

import { expect, test } from "./fixtures.ts";
import {
  createUnopenedPage,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const BLOCK_COUNT = 500;
const WARMUP_KEYSTROKES = 10;
const MEASURED_KEYSTROKES = 100;

/**
 * Leave the editor 50 ms after each rendered key to process its queued work.
 * Including the animation frame, this still drives roughly 15 keys per second
 * (about 180 words per minute), but does not turn a latency measurement into an
 * unbounded one-key-per-frame saturation test on a two-core CI runner.
 */
const KEYSTROKE_SETTLE_MS = 50;

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
  test("opens and becomes editable within 2 seconds (SC-007)", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Performance budgets use one controlled reference engine; every project still owns behavior.",
    );
    await openWorkspace(page);
    const name = uniqueName("LargeDoc");
    await createUnopenedPage(request, name, {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: largeDocument(),
    });

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

  test("keeps typing responsive at the 95th percentile (SC-007)", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Performance budgets use one controlled reference engine; every project still owns behavior.",
    );
    await openWorkspace(page);
    const name = uniqueName("TypingDoc");
    await createUnopenedPage(request, name, {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: largeDocument(),
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
    // A p95 estimated from 30 values only permits one scheduling outlier and
    // therefore jumps between green and red when the local browser matrix runs
    // two isolated stacks in parallel. Warm the editor, then use 100 measured
    // keys: this preserves the exact 100 ms budget while making "95 %" a real
    // percentile rather than the second-largest value of a tiny sample.
    //
    // A key on every animation frame is not human input: it queues mutations at
    // roughly 60 keys per second until a small runner falls behind, then reports
    // that accumulated queue as keystroke latency. Keep the browser-side timing
    // and the product's 100 ms threshold, but give each rendered key a short,
    // fixed settling interval before the next one. The resulting sustained rate
    // is still faster than realistic typing and remains a meaningful stress run.
    const samples = await page.evaluate(
      async ({ warmupKeystrokes, measuredKeystrokes, settleMs }) => {
        const measurements: number[] = [];
        const totalKeystrokes = warmupKeystrokes + measuredKeystrokes;

        for (let index = 0; index < totalKeystrokes; index += 1) {
          const start = performance.now();
          document.execCommand("insertText", false, "x");
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const elapsed = performance.now() - start;
          if (index >= warmupKeystrokes) measurements.push(elapsed);

          if (index + 1 < totalKeystrokes) {
            await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
          }
        }

        return measurements;
      },
      {
        warmupKeystrokes: WARMUP_KEYSTROKES,
        measuredKeystrokes: MEASURED_KEYSTROKES,
        settleMs: KEYSTROKE_SETTLE_MS,
      },
    );

    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
    console.info(
      `[editor-performance] ${samples.length} samples, ${KEYSTROKE_SETTLE_MS} ms settling interval: p95=${p95.toFixed(1)}ms`,
    );
    expect(p95, `p95 keystroke latency was ${Math.round(p95)}ms`).toBeLessThan(100);
  });
});
