/** Connected two-device propagation through the persistent page channel. */

import type { Locator, Page } from "@playwright/test";
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
} from "./helpers.ts";

function editor(page: Page): Locator {
  return page.getByTestId("block-editor").locator(".ProseMirror");
}

function blocks(page: Page): Locator {
  return editor(page).locator(":scope > .bn-block-group > .bn-block-outer[data-id]");
}

/** Selects exact text without relying on engine-specific word-boundary shortcuts. */
async function selectExactText(page: Page, content: Locator, text: string): Promise<void> {
  await content.evaluate((node, requestedText) => {
    const surface = node.closest(".ProseMirror");
    if (!(surface instanceof HTMLElement)) throw new Error("the block is outside the editor");
    const fullText = node.textContent ?? "";
    const start = fullText.lastIndexOf(requestedText);
    if (start < 0) throw new Error(`text not found: ${requestedText}`);
    const end = start + requestedText.length;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;
    for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
      const textNode = current as Text;
      const nextOffset = offset + textNode.data.length;
      if (startNode === null && start >= offset && start <= nextOffset) {
        startNode = textNode;
        startOffset = start - offset;
      }
      if (end >= offset && end <= nextOffset) {
        endNode = textNode;
        endOffset = end - offset;
        break;
      }
      offset = nextOffset;
    }
    if (startNode === null || endNode === null) {
      throw new Error(`text range could not be resolved: ${requestedText}`);
    }
    surface.focus();
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    if (selection === null) throw new Error("the browser did not expose a text selection");
    selection.removeAllRanges();
    selection.addRange(range);
  }, text);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(text);
}

async function expectPropagated(
  destination: Page,
  startedAt: number,
  assertion: () => Promise<void>,
): Promise<number> {
  await assertion();
  const elapsed = Date.now() - startedAt;
  expect(elapsed, "connected page propagation exceeded the two-second product budget").toBeLessThan(
    2_000,
  );
  await expect(destination.getByTestId("conflict-notice")).toHaveCount(0);
  return elapsed;
}

test("connected devices exchange text, marks and block order without reload or replacement", async ({
  page,
  browser,
  baseURL,
}) => {
  const second = await openSecondDevice(browser, baseURL);
  const socketUrls = new Set<string>();
  const propagationMs: number[] = [];
  let watchReplacements = false;
  const fullReplacements: string[] = [];
  const observe = (current: Page) => {
    current.on("websocket", (socket) => socketUrls.add(socket.url()));
    current.on("request", (request) => {
      if (!watchReplacements || request.method() !== "POST") return;
      const body = request.postData() ?? "";
      if (body.includes("page.document.replace")) fullReplacements.push(body);
    });
  };
  observe(page);
  observe(second.page);

  try {
    const pageName = uniqueName("RealtimePage");
    await openWorkspace(page);
    await createRootItem(page, "page", pageName);
    await selectItem(page, pageName);
    await waitForEditor(page);
    const surface = editor(page);
    const initialSequence = await editorChangeSequence(page);
    await surface.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await surface.pressSequentially("premier bloc temps réel");
    await page.keyboard.press("ControlOrMeta+Alt+Enter");
    await surface.pressSequentially("second bloc temps réel");
    await waitForEditorSettled(page, { afterSequence: initialSequence });

    await openWorkspace(second.page);
    await selectItem(second.page, pageName);
    await waitForEditorSettled(second.page);
    await expect(second.page.getByTestId("block-editor")).toContainText("second bloc temps réel");
    await expect(page.getByTestId("live-connection-state")).toHaveAttribute("data-state", "live");
    await expect(second.page.getByTestId("live-connection-state")).toHaveAttribute(
      "data-state",
      "live",
    );
    expect(
      [...socketUrls].filter((url) => url.endsWith("/v1/page-sync/socket")).length,
    ).toBeGreaterThan(0);
    watchReplacements = true;

    const beforeText = await editorChangeSequence(page);
    const textStartedAt = Date.now();
    const firstBlock = blocks(page).first().locator(".bn-inline-content").first();
    await firstBlock.click();
    await editor(page).pressSequentially(" — écrit sur A");
    await waitForEditorSettled(page, { afterSequence: beforeText });
    propagationMs.push(
      await expectPropagated(second.page, textStartedAt, async () => {
        await expect(second.page.getByTestId("block-editor")).toContainText("écrit sur A", {
          timeout: 1_900,
        });
      }),
    );
    await expect(
      blocks(second.page),
      "the remote text merge must preserve sibling blocks",
    ).toHaveCount(2);

    const beforeFormat = await editorApplyCount(second.page);
    await selectExactText(
      second.page,
      blocks(second.page).nth(1).locator(".bn-inline-content").first(),
      "réel",
    );
    const toolbar = second.page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    const formatStartedAt = Date.now();
    await toolbar.getByRole("button", { name: "Gras" }).click();
    await waitForEditorSettled(second.page, { afterApplyCount: beforeFormat });
    propagationMs.push(
      await expectPropagated(page, formatStartedAt, async () => {
        await expect(editor(page).locator("strong").first()).toContainText("réel", {
          timeout: 1_900,
        });
      }),
    );
    await expect(
      blocks(second.page),
      "a local mark applied after a remote merge must preserve sibling blocks",
    ).toHaveCount(2);

    const beforeMove = await editorApplyCount(second.page);
    await second.page.keyboard.press("Escape");
    await expect(toolbar).toBeHidden();
    await blocks(second.page).first().locator(".bn-inline-content").first().click();
    const moveStartedAt = Date.now();
    await second.page.keyboard.press("Alt+Shift+ArrowDown");
    await waitForEditorSettled(second.page, { afterApplyCount: beforeMove });
    propagationMs.push(
      await expectPropagated(page, moveStartedAt, async () => {
        await expect(blocks(page).first()).toContainText("second bloc temps réel", {
          timeout: 1_900,
        });
      }),
    );

    expect(fullReplacements, "live edits must never use whole-document replacement").toEqual([]);
    await test.info().attach("realtime-propagation-ms", {
      body: Buffer.from(JSON.stringify(propagationMs)),
      contentType: "application/json",
    });
    console.info(`realtime-propagation-ms=${JSON.stringify(propagationMs)}`);
  } finally {
    await second.context.close().catch(() => undefined);
  }
});
