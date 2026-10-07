import { type BlockDocumentV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { expect, test } from "./fixtures.ts";
import {
  clickEditorInsertBlock,
  createUnopenedPage,
  openWorkspace,
  saveDocument,
  selectItem,
  uniqueName,
} from "./helpers.ts";

const pageDocument = (body: BlockDocumentV3) => ({
  format: "myownnotion.document+json" as const,
  formatVersion: 3 as const,
  body: { ...body },
});

test("edits math, preserves invalid source and supports history, slash and offline navigation", async ({
  page,
  request,
  context,
}) => {
  const math = generateUuidV7(),
    blank = generateUuidV7(),
    name = uniqueName("Math");
  await createUnopenedPage(
    request,
    name,
    pageDocument({
      blocks: [
        { type: "equation", id: math, expression: "\\frac{1}{2}" },
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [
            { text: "Énergie : " },
            {
              text: "E=mc^2",
              marks: [{ type: "equation", equationId: generateUuidV7(), expression: "E=mc^2" }],
            },
          ],
        },
        { type: "paragraph", id: blank, content: [] },
      ],
    }),
  );
  await openWorkspace(page);
  await selectItem(page, name);
  const editor = page.locator('[data-testid="block-editor"]:visible');
  const equation = editor.locator(`[data-id="${math}"]`).first();
  await expect(equation.locator(".katex")).toHaveCount(1);
  await equation.getByRole("button", { name: "Modifier l’équation LaTeX" }).click();
  const input = equation.getByRole("textbox", { name: "Source LaTeX" });
  await expect(input).toBeFocused();
  await input.fill("\\frac{");
  await input.press("ControlOrMeta+Enter");
  await expect(equation).toContainText("Expression LaTeX à corriger");
  await saveDocument(page, { until: "synced" });
  await equation.getByRole("button", { name: "Modifier l’équation LaTeX" }).click();
  await input.fill("cancelled");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(equation).toContainText("\\frac{");
  await page.getByTestId("undo").click();
  await expect(equation.locator(".katex")).toHaveCount(1);
  await saveDocument(page);
  await page.getByTestId("redo").click();
  await expect(equation).toContainText("Expression LaTeX à corriger");
  await saveDocument(page, { until: "synced" });
  await page.reload();
  await expect(equation).toContainText("Expression LaTeX à corriger");
  await equation.getByRole("button", { name: "Modifier l’équation LaTeX" }).click();
  await input.fill("\\sqrt{x}");
  await input.press("ControlOrMeta+Enter");
  const inline = editor.locator(".editor-inline-equation");
  await inline.getByRole("button", { name: "Modifier l’équation LaTeX" }).click();
  await inline.getByRole("textbox", { name: "Source LaTeX" }).fill("E=mc^3");
  await inline.getByRole("button", { name: "Appliquer", exact: true }).click();
  await editor.locator(`[data-id="${blank}"] .bn-block-content`).first().click();
  await page.keyboard.type("/latex");
  await page.getByRole("option", { name: /^Équation/ }).click();
  await editor.getByRole("textbox", { name: "Source LaTeX" }).fill("a^2+b^2=c^2");
  await editor.getByRole("button", { name: "Appliquer", exact: true }).click();
  await clickEditorInsertBlock(page);
  await page.keyboard.type("/sommaire");
  await page.getByRole("option", { name: /^Sommaire/ }).click();
  await expect(editor.locator(".editor-contents-empty")).toContainText("Ajoutez des titres");
  await saveDocument(page, { until: "synced" });
  await page.reload();
  await expect(editor.locator(".editor-equation .katex")).toHaveCount(2);
  await expect(inline).toContainText("3");
  await context.setOffline(true);
  await selectItem(page, name);
  await expect(editor.locator(".editor-equation .katex")).toHaveCount(2);
  await context.setOffline(false);
});

test("updates both contents projections, scrolls nested headings and leaves no stale outline", async ({
  page,
  request,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7()] as const,
    blank = generateUuidV7();
  const heading = (id: Uuid, text: string) => ({
    type: "heading" as const,
    id,
    level: 2 as const,
    content: [{ text }],
  });
  const firstName = uniqueName("Contents"),
    secondName = uniqueName("Other contents");
  const first = await createUnopenedPage(
    request,
    firstName,
    pageDocument({
      blocks: [
        { type: "tableOfContents", id: generateUuidV7() },
        heading(ids[0], "Introduction actuelle"),
        ...Array.from({ length: 14 }, () => ({
          type: "paragraph" as const,
          id: generateUuidV7(),
          content: [{ text: "Un paragraphe assez long pour vérifier la navigation. ".repeat(8) }],
        })),
        heading(ids[1], "Suite actuelle"),
        ...Array.from({ length: 12 }, () => ({
          type: "paragraph" as const,
          id: generateUuidV7(),
          content: [
            {
              text: "La suite conserve assez de contenu pour aligner le titre en haut du viewport. ".repeat(
                8,
              ),
            },
          ],
        })),
        {
          type: "toggle",
          id: generateUuidV7(),
          content: [{ text: "Détails" }],
          children: [heading(ids[2], "Titre replié")],
        },
        { type: "paragraph", id: blank, content: [] },
      ],
    }),
  );
  const second = await createUnopenedPage(
    request,
    secondName,
    pageDocument({
      blocks: [
        heading(generateUuidV7(), "Autre introduction"),
        heading(generateUuidV7(), "Autre conclusion"),
      ],
    }),
  );
  await openWorkspace(page);
  await selectItem(page, firstName);
  const editor = page.locator('[data-testid="block-editor"]:visible');
  await expect(editor.locator(".editor-contents-link")).toHaveCount(3);
  await editor.locator(".editor-contents-link").filter({ hasText: "Suite actuelle" }).click();
  await expect
    .poll(() =>
      editor
        .locator(`[data-id="${ids[1]}"]`)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeLessThan(180);
  await expect
    .poll(async () =>
      page.evaluate((id) => {
        const main = document.querySelector(".workspace-main");
        const h = document.querySelector(`.bn-block-outer[data-id="${id}"]`);
        const active = document.querySelector(
          '.page-outline__item[data-active="true"]',
        )?.textContent;
        return {
          active,
          top: h?.getBoundingClientRect().top,
          rootTop: main?.getBoundingClientRect().top,
          scroll: main?.scrollTop,
        };
      }, ids[1]),
    )
    .toMatchObject({ active: "Suite actuelle" });
  await page.locator(".page-outline__link").filter({ hasText: "Titre replié" }).click();
  await expect(editor.locator('.bn-toggle-button[aria-expanded="true"]')).toHaveCount(1);
  // Wait for the disclosure and the scheduled navigation before simulating a new scroll.
  await expect
    .poll(() =>
      editor
        .locator(`[data-id="${ids[2]}"]`)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeLessThan(900);
  await page.getByTestId("workspace-main").evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(page.locator('.page-outline__item[data-active="true"]')).toContainText(
    "Introduction actuelle",
  );
  const header = editor.locator(`[data-id="${ids[0]}"] .bn-inline-content`).first();
  await header.fill("Introduction actuelle — modifiée");
  await expect(editor.locator(".editor-contents-link").first()).toContainText("modifiée");
  await expect(page.getByTestId("page-outline")).toContainText("modifiée");
  await saveDocument(page, { until: "synced" });
  expect(pageErrors).toEqual([]);
  if (testInfo.repeatEachIndex === 0) {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: testInfo.outputPath(`current-headings-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  for (let i = 0; i < 20; i++) {
    const alternate = i % 2 === 0;
    await page.evaluate(
      (id) => {
        history.pushState({}, "", `/notes/${id}`);
        dispatchEvent(new PopStateEvent("popstate"));
      },
      alternate ? second.itemId : first.itemId,
    );
    await expect(page.getByTestId("page-outline")).toHaveCount(1);
    await expect(page.getByTestId("page-outline")).toContainText(
      alternate ? "Autre introduction" : "Introduction actuelle",
    );
    await expect(page.getByTestId("page-outline")).not.toContainText(
      alternate ? "Introduction actuelle" : "Autre introduction",
    );
  }
  await editor.locator(`[data-id="${blank}"] .bn-block-content`).first().click();
  await page.keyboard.type("/sommaire");
  await page.getByRole("option", { name: /^Sommaire/ }).click();
  await expect(editor.locator(".editor-contents")).toHaveCount(2);
  await saveDocument(page, { until: "synced" });
  await page.setViewportSize({ width: 320, height: 1000 });
  await editor
    .locator(".editor-contents-link")
    .filter({ hasText: "Introduction actuelle" })
    .last()
    .click();
  await expect
    .poll(() =>
      editor
        .locator(`[data-id="${ids[0]}"]`)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeLessThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

test("keeps list values aligned and property names out of visual rows at narrow widths", async ({
  page,
}, testInfo) => {
  await page.goto("/__ui-lab?review=database&format=list");
  for (const theme of ["light", "dark"])
    for (const width of [1440, 320]) {
      await page.evaluate((t) => localStorage.setItem("myownnotion.theme", t), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      // Exercise the ordinary page reading column as well as the wide lab.
      if (width === 1440)
        await page.locator(".ui-lab__review-content").evaluate((el) => {
          el.style.maxWidth = "688px";
        });
      const list = page.locator(".database-list");
      await expect(list).toBeVisible();
      await expect(list.locator(".database-list__title .item-icon").first()).toBeVisible();
      await expect(list.locator("dt:not(.sr-only)")).toHaveCount(0);
      await expect(list.locator(".database-list__value").first()).not.toBeEmpty();
      if (width === 1440)
        expect(
          await list
            .locator(".option-pill__label")
            .evaluateAll((labels) =>
              labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
            ),
        ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      await list.locator(".database-list__title").first().focus();
      await expect(list.locator(".database-list__title").first()).toBeFocused();
      await page.keyboard.press("Enter");
      await list.screenshot({ path: testInfo.outputPath(`list-${theme}-${width}.png`) });
    }
});
