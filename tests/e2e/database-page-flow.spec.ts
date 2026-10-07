import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixtures.ts";
import {
  addDatabaseProperty,
  createDatabaseView,
  createRootDatabase,
  openWorkspace,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

for (const flow of ["full", "inline"]) {
  test(`database ${flow} flow pins original headers and reads 1000 cards/rows through the page`, async ({
    page,
  }, testInfo) => {
    test.slow();
    for (const format of ["board", "table"]) {
      await page.goto(`/__ui-lab?review=database&format=${format}&flow=${flow}&rows=1000`);
      const main = page.locator(".workspace-main");
      await main.evaluate((node) => {
        node.style.height = `${Math.min(600, innerHeight - 80)}px`;
        node.scrollIntoView({ block: "start" });
      });
      const surface = page.locator(
        format === "board" ? ".database-board-scroll" : ".database-table-scroll",
      );
      const headers = page.locator(
        format === "board" ? ".database-board__column header" : ".database-grid thead",
      );
      const sticky = surface.locator(".database-page-header");
      await expect(sticky).toHaveCount(1);
      await expect(headers.first()).toBeVisible();
      await main.evaluate((node) => {
        node.scrollTop = 700;
      });
      await expect
        .poll(async () =>
          sticky.evaluate((node) =>
            Math.round(
              node.getBoundingClientRect().top -
                (node.closest(".workspace-main")?.getBoundingClientRect().top ?? 0),
            ),
          ),
        )
        .toBeLessThanOrEqual(2);
      await expect
        .poll(async () =>
          sticky.evaluate((node) =>
            Math.round(
              node.getBoundingClientRect().top -
                (node.closest(".workspace-main")?.getBoundingClientRect().top ?? 0),
            ),
          ),
        )
        .toBeGreaterThanOrEqual(-2);
      expect(await surface.evaluate((node) => node.scrollTop)).toBe(0);
      const virtualNodes = page.locator(
        format === "board" ? ".database-card[data-index]" : ".database-grid tbody tr[data-index]",
      );
      await expect.poll(() => virtualNodes.count()).toBeGreaterThan(0);
      await expect.poll(() => virtualNodes.count()).toBeLessThan(100);
      if (format === "board") {
        const short = headers.nth(1);
        await expect
          .poll(async () =>
            short.evaluate((node) =>
              Math.abs(
                node.getBoundingClientRect().top -
                  (node
                    .closest(".database-page-header")
                    ?.querySelector("header")
                    ?.getBoundingClientRect().top ?? 0),
              ),
            ),
          )
          .toBeLessThanOrEqual(2);
        const collapse = headers.first().getByRole("button");
        await collapse.press("Enter");
        await expect(collapse).toHaveAttribute("aria-expanded", "false");
        await collapse.press("Enter");
      } else {
        const before = await headers.first().getByRole("button").first().boundingBox();
        await surface.locator(".database-table-body-scroll").evaluate((node) => {
          node.scrollLeft = 120;
        });
        await expect
          .poll(async () => {
            const after = await headers.first().getByRole("button").first().boundingBox();
            return (before?.x ?? 0) - (after?.x ?? 0);
          })
          .toBeCloseTo(120, 0);
      }
      await main.evaluate((node) => {
        node.scrollTop = node.scrollHeight - node.clientHeight - 450;
      });
      const last = page.locator("[data-entry-trigger]").filter({ hasText: "Carte 0999" });
      // Measured card heights replace estimates after the jump. Follow the
      // actual last card using the native page owner rather than stale heights.
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      expect(await surface.evaluate((node) => node.scrollTop)).toBe(0);
      await main.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(page.locator("[data-flow-after]")).toBeInViewport();
      await expect(headers.first()).not.toBeInViewport();
      await main.evaluate((node) => {
        node.scrollTop = 0;
      });
      if (format === "board") {
        const first = page.locator(".database-card").first();
        const long = page.locator(".database-card").filter({ hasText: "Un titre très long" });
        await expect(long).toBeVisible();
        const sizes = await Promise.all(
          [first, long].map((card) =>
            card.evaluate((node) => {
              const box = node.getBoundingClientRect();
              const text = node
                .querySelector(".database-card__title > span:last-child")
                ?.getBoundingClientRect();
              return {
                height: box.height,
                imbalance: text ? Math.abs(text.top - box.top - (box.bottom - text.bottom)) : 99,
              };
            }),
          ),
        );
        expect(sizes[0]?.imbalance).toBeLessThanOrEqual(2);
        expect(sizes[1]?.imbalance).toBeLessThanOrEqual(2);
        expect(sizes[1]?.height).toBeGreaterThan(sizes[0]?.height ?? 0);
        const footer = page
          .locator("[data-board-column]")
          .nth(1)
          .locator(".database-board__create");
        await expect(footer).toBeVisible();
        expect(
          await footer.evaluate(
            (node) =>
              node.getBoundingClientRect().top >=
              (node.parentElement?.querySelector(".database-card-list")?.getBoundingClientRect()
                .bottom ?? 0),
          ),
        ).toBe(true);
      }
      if (flow === "full") {
        for (const theme of ["light", "dark"]) {
          await page.evaluate((theme) => {
            document.documentElement.dataset["theme"] = theme;
          }, theme);
          await main.screenshot({ path: testInfo.outputPath(`${format}-${theme}-page-flow.png`) });
          await main.evaluate((node) => {
            node.scrollTop = 700;
          });
          await main.screenshot({ path: testInfo.outputPath(`${format}-${theme}-pinned.png`) });
          await main.evaluate((node) => {
            node.scrollTop = 0;
          });
        }
      }
    }
  });
}

test("column creation blocks pending duplicates and permits retry after refusal", async ({
  page,
}, testInfo) => {
  for (const state of ["pending", "refused"]) {
    await page.goto(`/__ui-lab?review=database&format=board&creation=${state}`);
    const column = page.locator("[data-board-column]").first();
    const create = column.getByRole("button", { name: /Nouvel élément dans/ });
    await create.press("Enter");
    if (state === "pending") {
      await expect(create).toBeDisabled();
      await expect(column.locator(".database-board__create")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".database-board__create button:enabled")).toHaveCount(0);
    } else {
      await expect(column.getByRole("alert")).toContainText("Réessayez");
      await expect(create).toBeEnabled();
      await create.press("Enter");
      await expect(column.getByRole("alert")).toBeVisible();
    }
    await expect(page.locator(".database-card")).toHaveCount(2);
    await column.screenshot({ path: testInfo.outputPath(`creation-${state}.png`) });
  }
});

test("keeps Nouvel élément below the edited card, creates successive durable entries and uses full column colors", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await createRootDatabase(page, uniqueName("Persistent creation source"));
  await addDatabaseProperty(page, "État", "select");
  await createDatabaseView(page, "Kanban");
  const add = page.getByRole("button", { name: "Nouvel élément dans En cours", exact: true });
  const column = page.locator("[data-board-column]").filter({ has: add });
  await add.click();
  const title = column.getByRole("textbox", { name: /^Nom de/ });
  await expect(title).toBeFocused();
  await expect(add).toBeVisible();
  await expect(add).toBeEnabled();
  await expect(column.locator(".database-card")).toHaveCount(1);
  await column.screenshot({ path: testInfo.outputPath("creation-expanded.png") });
  const firstName = uniqueName("First immediate entry");
  await title.fill(firstName);
  // A new command saves this card and opens the next without an extra Enter.
  await add.click();
  await expect(column.locator(".database-card")).toHaveCount(2);
  await expect(column.locator('[data-editing="true"]')).toHaveCount(1);
  await expect(title).toBeFocused();
  await expect(title).toHaveText("Nouvelle page");
  const secondName = uniqueName("Second immediate entry");
  await title.fill(secondName);
  await title.press("Escape");
  await expect(title).toBeHidden();
  await expect(column.locator(".database-card")).toHaveCount(2);
  await expect(page.locator(".entry-panel")).toBeHidden();
  await waitForSynchronized(page);
  await page.reload();
  await expect(column.locator(".database-card").filter({ hasText: firstName })).toHaveCount(1);
  await expect(column.locator(".database-card").filter({ hasText: secondName })).toHaveCount(1);
  for (const width of [1133, 320]) {
    await page.setViewportSize({ width, height: 909 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset["theme"] = theme;
      }, theme);
      await add.scrollIntoViewIfNeeded();
      const colors = () =>
        column.evaluate((node) => {
          const button = node.querySelector(".database-board__add");
          const card = node.querySelector(".database-card");
          const dot =
            node.closest(".database-board__column")?.querySelector(".option-pill__dot") ??
            document.querySelector(
              '.database-board--headers .database-board__column[data-tone="blue"] .option-pill__dot',
            );
          if (!button || !card || !dot) throw new Error("Missing color surfaces");
          return {
            button: getComputedStyle(button).color,
            buttonBorder: getComputedStyle(button).borderTopColor,
            cardBorder: getComputedStyle(card).borderTopColor,
            dot: getComputedStyle(dot).backgroundColor,
          };
        });
      // Theme changes animate the button; inspect its settled paint, not an
      // intermediate interpolated color from the previous theme.
      await expect
        .poll(async () => {
          const color = await colors();
          return color.buttonBorder === color.cardBorder && color.cardBorder !== color.dot;
        })
        .toBe(true);
      await column.screenshot({
        path: testInfo.outputPath(`persistent-create-${width}-${theme}.png`),
      });
    }
  }
});

test("production content colors keep distinct surfaces and readable text in both themes", async ({
  page,
}, testInfo) => {
  await page.goto("/__ui-lab");
  await page.setViewportSize({ width: 320, height: 909 });
  const palette = page.locator(".ui-lab__swatches");
  await expect(palette.locator("[data-content-color]")).toHaveCount(9);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    const colors = await palette.evaluate((node) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Missing color canvas");
      const probe = document.createElement("span");
      node.append(probe);
      const read = (variable: string) => {
        probe.style.backgroundColor = `var(${variable})`;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = getComputedStyle(probe).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      };
      const result = Array.from(node.querySelectorAll<HTMLElement>("[data-content-color]")).map(
        (swatch) => {
          const tone = swatch.dataset["contentColor"];
          if (!tone) throw new Error("Missing color family");
          return {
            tone,
            accent: read(`--ui-content-${tone}-accent`),
            wash: read(`--ui-content-${tone}-wash`),
            soft: read(`--ui-content-${tone}-soft`),
            badge: read(`--ui-content-${tone}-badge`),
            foreground: read(`--ui-content-${tone}-foreground`),
            text: read("--ui-color-text"),
          };
        },
      );
      probe.remove();
      return result;
    });
    const luminance = (rgb: number[]) => {
      const channels = rgb.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
      );
    };
    const contrast = (a: number[], b: number[]) => {
      const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
      return ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05);
    };
    for (const color of colors) {
      const message = `${theme}/${color.tone}`;
      expect(
        new Set([color.wash, color.soft, color.badge].map((value) => value.join(","))).size,
        message,
      ).toBe(3);
      for (const surface of [color.wash, color.soft, color.badge]) {
        expect(surface, message).not.toEqual(color.accent);
        expect(surface[3], message).toBe(255);
      }
      expect(contrast(color.text, color.badge), message).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color.text, color.soft), message).toBeGreaterThanOrEqual(4.5);
      // Colored commands sit on wash at rest and soft on hover.
      expect(contrast(color.foreground, color.wash), message).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color.foreground, color.soft), message).toBeGreaterThanOrEqual(4.5);
    }
    await writeFile(
      testInfo.outputPath(`content-colors-${theme}.json`),
      JSON.stringify(colors, null, 2),
    );
    await palette.screenshot({ path: testInfo.outputPath(`content-colors-${theme}-320.png`) });
  }
});

test("creates canonical pages and folders in multi-select columns, reloads and queues offline", async ({
  page,
  context,
}) => {
  test.slow();
  await openWorkspace(page);
  await createRootDatabase(page, uniqueName("Column source"));
  await addDatabaseProperty(page, "Matières", "multi-select", ["Alpha", "Beta"]);
  await createDatabaseView(page, "Kanban");
  await expect(page.locator(".database-entry-create")).toHaveCount(0);
  const create = async (label: string, kind: "page" | "folder", title: string) => {
    const add = page.getByRole("button", { name: `Nouvel élément dans ${label}`, exact: true });
    const column = page.locator("[data-board-column]").filter({ has: add });
    await add.click();
    const titleInput = column.getByRole("textbox", { name: /^Nom de/ });
    await expect(titleInput).toBeFocused();
    await expect(add).toBeVisible();
    await expect(add).toBeEnabled();
    await expect(page.locator(".entry-panel")).toBeHidden();
    await titleInput.fill(title);
    if (kind === "folder") {
      const choice = column.getByRole("group", { name: "Type d’élément", exact: true });
      await choice.getByRole("button", { name: "Dossier", exact: true }).click();
      await expect(choice.getByRole("button", { name: "Dossier", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    await titleInput.press("Enter");
    await expect(titleInput).toBeHidden();
    const card = column.locator(".database-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    return card;
  };
  const pageName = uniqueName("Alpha page");
  await create("Alpha", "page", pageName);
  const folderName = uniqueName("Beta folder");
  const folder = await create("Beta", "folder", folderName);
  await expect(folder.locator(".item-icon")).toBeVisible();
  await waitForSynchronized(page);
  await page.reload();
  await expect(page.locator(".database-card").filter({ hasText: pageName })).toBeVisible();
  await expect(page.locator(".database-card").filter({ hasText: folderName })).toBeAttached();
  await context.setOffline(true);
  const missing = uniqueName("No subject");
  await create("Sans matières", "page", missing);
  await expect(page.locator(".database-card").filter({ hasText: missing })).toHaveCount(1);
  await context.setOffline(false);
  await waitForSynchronized(page);
  await page.reload();
  await expect(page.locator(".database-card").filter({ hasText: missing })).toBeAttached();
});
