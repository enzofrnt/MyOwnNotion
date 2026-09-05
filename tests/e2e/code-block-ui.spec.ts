import { generateUuidV7 } from "@myownnotion/domain";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  createUnopenedPage,
  openSecondDevice,
  openWorkspace,
  saveDocument,
  selectItem,
  uniqueName,
} from "./helpers.ts";

const SOURCE =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source code, not this test's interpolation.
  '// Keep source readable\nconst message: string = "Bonjour, café 漢字 🚀";\n\nfunction greet(name: string) {\n\treturn `${message}, ${name}`;\n}\n';

async function seedCode(page: Page, request: APIRequestContext, extra = false) {
  const name = uniqueName("Code");
  const blockId = generateUuidV7();
  const { itemId } = await createUnopenedPage(request, name, {
    format: "myownnotion.document+json",
    formatVersion: 2,
    body: {
      blocks: [
        { type: "code", id: blockId, text: SOURCE, language: "typescript" },
        ...(extra
          ? [
              {
                type: "code",
                id: generateUuidV7(),
                text: "an unbroken line ".repeat(25),
                language: "future-language",
              },
              { type: "code", id: generateUuidV7(), text: "", language: null },
            ]
          : []),
      ],
    },
  });
  await openWorkspace(page);
  await selectItem(page, name);
  const block = page.getByRole("region", { name: "Bloc de code", exact: true }).first();
  const code = block.locator("code");
  await expect.poll(() => code.textContent()).toBe(SOURCE);
  await expect(code.locator('span[style*="--shiki-light"]').first()).toBeVisible();
  await saveDocument(page, { until: "synced" });
  return { name, itemId, blockId, block, code };
}

async function placeCaret(code: Locator, edge: "start" | "end" = "end") {
  await code.evaluate((node, position) => {
    (node.closest(".ProseMirror") as HTMLElement).focus();
    const range = document.createRange();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode())
      texts.push(text as Text);
    const text = position === "start" ? texts[0] : texts.at(-1);
    if (text === undefined) throw new Error("code fixture has no text node");
    range.setStart(text, position === "start" ? 0 : text.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, edge);
}

async function storedCode(page: Page, itemId: string, blockId: string) {
  return page.evaluate(
    async ({ itemId, blockId }) => {
      const body = await (await fetch(`/v1/items/${itemId}`)).json();
      return body.pageDocument.body.blocks.find((block: { id: string }) => block.id === blockId);
    },
    { itemId, blockId },
  );
}

test("code stays colored, editable and confined in both themes at desktop and 320 px", async ({
  page,
  request,
}, testInfo) => {
  const { block, code, itemId, blockId } = await seedCode(page, request, true);
  const language = block.getByRole("combobox", { name: "Langage du code" });
  await expect(language).toHaveValue("typescript");
  const unknown = page.getByRole("region", { name: "Bloc de code", exact: true }).nth(1);
  await expect(unknown.getByRole("combobox")).toHaveValue("future-language");
  await expect(unknown.getByRole("combobox").locator("option:checked")).toHaveText(
    "future-language",
  );
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const colors = await code
      .locator('span[style*="--shiki-light"]')
      .evaluateAll((tokens) => [...new Set(tokens.map((token) => getComputedStyle(token).color))]);
    expect(colors.length).toBeGreaterThan(2);
    await page.screenshot({ path: testInfo.outputPath(`code-${theme}.png`) });
  }
  await language.focus();
  await expect(language).toBeFocused();
  await language.selectOption("python");
  await saveDocument(page);
  await placeCaret(code);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(language).toHaveValue("typescript");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(language).toHaveValue("python");
  await language.selectOption("typescript");
  await saveDocument(page);
  await code
    .locator("span")
    .filter({ hasText: /^message$/u })
    .first()
    .evaluate((token) => {
      (token.closest(".ProseMirror") as HTMLElement).focus();
      const range = document.createRange();
      range.selectNodeContents(token);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
  await page.keyboard.insertText("greeting");
  await expect.poll(() => code.textContent()).toBe(SOURCE.replace("message", "greeting"));
  await saveDocument(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => code.textContent()).toBe(SOURCE);
  await saveDocument(page);
  await placeCaret(code);
  await page.keyboard.type("// typed");
  await expect.poll(() => code.textContent()).toBe(`${SOURCE}// typed`);
  await saveDocument(page, { until: "synced" });
  expect(await storedCode(page, itemId, blockId)).toMatchObject({
    id: blockId,
    type: "code",
    text: `${SOURCE}// typed`,
    language: "typescript",
  });

  await page.setViewportSize({ width: 320, height: 780 });
  await expect.poll(async () => (await block.boundingBox())?.width ?? 0).toBeGreaterThan(250);
  await expect(unknown.getByRole("button", { name: "Copier" })).toBeVisible();
  const overflow = await unknown.locator("pre").evaluate((pre) => ({
    inner: pre.scrollWidth > pre.clientWidth,
    page: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(overflow).toEqual({ inner: true, page: false });
  await page.screenshot({ path: testInfo.outputPath("code-narrow.png") });
});

test("copy writes exact plain source with stable semantic activation and visible refusal/retry", async ({
  page,
  request,
}) => {
  const { block } = await seedCode(page, request);
  await page.evaluate(() => {
    const state = { values: [] as string[], refused: false };
    Object.assign(window, { codeClipboard: state });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          state.values.push(value);
          if (state.refused) throw new DOMException("refused", "NotAllowedError");
        },
      },
    });
  });
  const copy = block.getByRole("button", { name: "Copier", exact: true });
  const bounds = await copy.boundingBox();
  if (bounds === null) throw new Error("copy has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(block.getByRole("status", { includeHidden: true })).toBeEmpty();
  await copy.focus();
  await copy.press("Enter");
  await expect(block.getByRole("status")).toHaveText("Code copié.");
  await expect(copy).toBeFocused();
  expect(await copy.boundingBox()).toEqual(bounds);
  const state = () =>
    page.evaluate(
      () => (window as unknown as { codeClipboard: { values: string[] } }).codeClipboard.values,
    );
  expect(await state()).toEqual([SOURCE]);
  await page.evaluate(() => {
    (window as unknown as { codeClipboard: { refused: boolean } }).codeClipboard.refused = true;
  });
  await copy.press("Space");
  await expect(block.getByRole("status")).toHaveText("Impossible de copier le code.");
  await page.evaluate(() => {
    (window as unknown as { codeClipboard: { refused: boolean } }).codeClipboard.refused = false;
  });
  await copy.click();
  await expect(block.getByRole("status")).toHaveText("Code copié.");
  expect(await state()).toEqual([SOURCE, SOURCE, SOURCE]);
});

test("code retains composition, incoming owner-device edits and language across offline reload", async ({
  page,
  request,
  browser,
  baseURL,
  context,
}) => {
  test.setTimeout(90_000);
  const { name, code, block, itemId, blockId } = await seedCode(page, request);
  const second = await openSecondDevice(browser, baseURL);
  try {
    await openWorkspace(second.page);
    await selectItem(second.page, name);
    const remoteCode = second.page
      .getByRole("region", { name: "Bloc de code", exact: true })
      .locator("code");
    await expect.poll(() => remoteCode.textContent()).toBe(SOURCE);
    await placeCaret(code);
    // Browser composition events keep the real ProseMirror composition guard
    // active; insertText commits the composed text without simulating an OS IME.
    await code.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      document.execCommand("insertText", false, "// 日本語");
      node.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "// 日本語" }),
      );
    });
    await saveDocument(page, { until: "synced" });
    await expect.poll(() => remoteCode.textContent()).toBe(`${SOURCE}// 日本語`);
    await placeCaret(code, "start");
    await placeCaret(remoteCode);
    await second.page.keyboard.type(" remote");
    await saveDocument(second.page, { until: "synced" });
    await expect.poll(() => code.textContent()).toBe(`${SOURCE}// 日本語 remote`);
    await page.keyboard.type("// local");
    await page.keyboard.press("Enter");
    await expect.poll(() => code.textContent()).toBe(`// local\n${SOURCE}// 日本語 remote`);
    await saveDocument(page, { until: "synced" });

    await context.setOffline(true);
    await block.getByRole("combobox").selectOption("javascript");
    await saveDocument(page);
    await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
    await page.route("**/health", (route) => route.abort("connectionrefused"));
    await page.routeWebSocket("**/v1/page-sync/socket", (socket) => socket.close());
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await selectItem(page, name);
    await expect.poll(() => code.textContent()).toBe(`// local\n${SOURCE}// 日本語 remote`);
    await expect(block.getByRole("combobox")).toHaveValue("javascript");
    await expect(code.locator('span[style*="--shiki-light"]').first()).toBeVisible();
    await page.unroute("**/v1/**");
    await page.unroute("**/health");
    // HTTP reconciliation is sufficient with this journey's closed socket.
    await page.reload();
    await openWorkspace(page);
    await selectItem(page, name);
    await saveDocument(page, { until: "synced" });
    const stored = await storedCode(page, itemId, blockId);
    expect(stored).toMatchObject({
      text: `// local\n${SOURCE}// 日本語 remote`,
      language: "javascript",
    });
    expect(JSON.stringify(stored)).not.toContain("shiki");
  } finally {
    await second.context.close();
  }
});
