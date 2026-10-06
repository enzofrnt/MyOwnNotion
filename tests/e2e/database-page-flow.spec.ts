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
      await main.evaluate(node => { node.style.height = `${Math.min(600, innerHeight - 80)}px`; node.scrollIntoView({block: "start"}); });
      const surface = page.locator(
        format === "board" ? ".database-board-scroll" : ".database-table-scroll",
      );
      const headers = page.locator(
        format === "board" ? ".database-board__column header" : ".database-grid thead",
      );
      await expect(headers.first()).toBeVisible();
      await main.evaluate((node) => {
        node.scrollTop = 700;
      });
      await expect
        .poll(async () =>
          headers
            .first()
            .evaluate((node) =>
              Math.round(
                node.getBoundingClientRect().top -
                  (node.closest(".workspace-main")?.getBoundingClientRect().top ?? 0),
              ),
            ),
        )
        .toBeLessThanOrEqual(2);
      await expect
        .poll(async () =>
          headers
            .first()
            .evaluate((node) =>
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
        const short = page.locator("[data-board-column]").nth(1).locator("header");
        await expect
          .poll(async () =>
            short.evaluate((node) =>
              Math.abs(
                node.getBoundingClientRect().top -
                  (node.closest(".workspace-main")?.getBoundingClientRect().top ?? 0),
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
        await surface.evaluate((node) => {
          node.scrollLeft = 120;
        });
        const after = await headers.first().getByRole("button").first().boundingBox();
        expect((before?.x ?? 0) - (after?.x ?? 0)).toBeCloseTo(120, 0);
      }
      await main.evaluate((node) => {
        node.scrollTop = node.scrollHeight - node.clientHeight - 450;
      });
      const last = page.locator("[data-entry-trigger]").filter({ hasText: "Carte 0999" });
      await expect(last).toBeInViewport();
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
    const create = column.getByRole("button", { name: /Nouvelle page dans/ });
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
    await page
      .getByRole("button", {
        name: `${kind === "page" ? "Nouvelle page" : "Nouveau dossier"} dans ${label}`,
        exact: true,
      })
      .click();
    await expect(page.locator(".entry-panel")).toBeVisible();
    const titleInput = page.getByTestId("active-item-title");
    await titleInput.fill(title);
    await titleInput.press("Enter");
    await page.getByRole("button", { name: "Fermer l'entrée", exact: true }).click();
    const card = page
      .locator("[data-board-column]")
      .filter({ has: page.getByRole("heading", { name: new RegExp(`^${label} ·`) }) })
      .locator(".database-card")
      .filter({ hasText: title });
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
