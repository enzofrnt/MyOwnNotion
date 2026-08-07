import { expect, test } from "@playwright/test";
import {
  createRootItem,
  openWorkspace,
  selectItem,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const BLOCK_COUNT = 2_000;
const apiPort = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] as number;
}

test("a 2,000-block Tiptap document updates the visible DOM below 100ms p95", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Chromium desktop is the reference device",
  );
  await openWorkspace(page);
  const pageName = uniqueName("EditorPerformance");
  await createRootItem(page, "page", pageName);
  await waitForSynchronized(page);
  await selectItem(page, pageName);
  const treeItem = page.getByTestId(`tree-item-${pageName}`);
  const itemId = await treeItem.getAttribute("data-item-id");
  if (itemId === null) {
    throw new Error("Performance page has no stable item id");
  }
  const current = await request.get(`http://127.0.0.1:${apiPort}/v1/items/${itemId}`);
  expect(current.ok()).toBe(true);
  const currentItem = (await current.json()) as { currentRevisionId: string };
  const replaced = await request.put(`http://127.0.0.1:${apiPort}/v1/pages/${itemId}/document`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      baseRevisionId: currentItem.currentRevisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: {
          type: "doc",
          content: Array.from({ length: BLOCK_COUNT }, (_, index) => ({
            type: "paragraph",
            content: [{ type: "text", text: `Representative block ${index}` }],
          })),
        },
      },
    },
  });
  expect(replaced.ok()).toBe(true);

  await page.reload();
  await openWorkspace(page);
  await waitForSynchronized(page);
  await selectItem(page, pageName);
  const blocks = page.locator(".ProseMirror > p");
  await expect(blocks).toHaveCount(BLOCK_COUNT);
  await blocks.last().click();
  await page.keyboard.press("End");

  const samples: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    await page.evaluate(() => {
      const measurement = window as typeof window & { editorVisibleUpdate?: Promise<number> };
      measurement.editorVisibleUpdate = new Promise<number>((resolve, reject) => {
        const editor = document.querySelector(".ProseMirror");
        if (editor === null) {
          reject(new Error("Editor DOM is unavailable"));
          return;
        }
        const started = performance.now();
        const timeout = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error("Editor DOM did not update after the measured keystroke"));
        }, 1_000);
        const observer = new MutationObserver(() => {
          observer.disconnect();
          window.clearTimeout(timeout);
          requestAnimationFrame(() => resolve(performance.now() - started));
        });
        observer.observe(editor, { characterData: true, childList: true, subtree: true });
      });
    });
    await page.keyboard.type("x");
    samples.push(
      await page.evaluate(() => {
        const measurement = window as typeof window & { editorVisibleUpdate?: Promise<number> };
        if (measurement.editorVisibleUpdate === undefined) {
          throw new Error("Editor visible-update measurement was not installed");
        }
        return measurement.editorVisibleUpdate;
      }),
    );
  }

  const p95 = percentile(samples, 0.95);
  console.info(`[perf] real 2,000-block Tiptap visible-update p95=${p95.toFixed(1)}ms`);
  expect(p95).toBeLessThan(100);
});
