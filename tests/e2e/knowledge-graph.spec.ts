import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  attachReviewScreenshot,
  createRootItem,
  openWorkspace,
  savePageAndSynchronize,
  selectItem,
  uniqueName,
} from "./helpers.ts";

async function linkPage(page: Page, sourceName: string, targetName: string): Promise<void> {
  await selectItem(page, sourceName);
  const editor = page.getByRole("textbox", { name: "Page content" });
  await editor.focus();
  await page.keyboard.type(`[[${targetName.slice(0, 10)}`);
  await page.getByRole("option", { name: new RegExp(targetName) }).click();
  await savePageAndSynchronize(page);
}

test.describe("knowledge graph (US3)", () => {
  test("explores local and global connections with pointer, keyboard, filter, and semantic list", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page);
    const alpha = uniqueName("GraphAlpha");
    const beta = uniqueName("GraphBeta");
    const gamma = uniqueName("GraphGamma");
    await createRootItem(page, "page", alpha);
    await createRootItem(page, "page", beta);
    await createRootItem(page, "page", gamma);
    await linkPage(page, alpha, beta);
    await linkPage(page, gamma, beta);
    await selectItem(page, beta);

    const localGraph = page.getByTestId("knowledge-graph-local");
    await expect(localGraph).toBeVisible();
    await expect(localGraph.getByRole("button", { name: `Open ${alpha}` })).toBeVisible();
    const alphaNode = localGraph.locator(`.knowledge-graph-node[aria-label^="${alpha},"]`);
    await alphaNode.click();
    await expect(
      localGraph
        .locator(".knowledge-node-summary")
        .getByText(new RegExp(`${alpha}.*0 incoming,.*1 outgoing`)),
    ).toBeVisible();
    await alphaNode.focus();
    await page.keyboard.press("Enter");
    await expect(alphaNode).toHaveAttribute("data-selected", "true");

    await page.getByRole("button", { name: "Global graph" }).click();
    const globalGraph = page.getByTestId("knowledge-graph-global");
    await expect(globalGraph).toBeVisible();
    await page.getByLabel("Filter graph pages").fill(gamma);
    await expect(globalGraph.locator(".knowledge-graph-node[data-match='true']")).toHaveAttribute(
      "aria-label",
      new RegExp(`^${gamma},`),
    );
    await attachReviewScreenshot(page, testInfo, "knowledge-graph");

    await globalGraph.getByRole("button", { name: `Open ${gamma}` }).click();
    await expect(page.getByTestId(`tree-item-${gamma}`)).toHaveAttribute("aria-selected", "true");

    const axe = await new AxeBuilder({ page }).include(".knowledge-panel").analyze();
    expect(axe.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(24);
  });
});
