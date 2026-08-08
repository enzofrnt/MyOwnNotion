/**
 * Shared Playwright helpers: unique names per run and common journeys.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible();
  // Wait for the initial load (tree or empty state) to settle.
  await expect(page.locator('[role="tree"], [data-testid="empty-state"]').first()).toBeVisible({
    timeout: 15_000,
  });
}

export async function createRootItem(
  page: Page,
  kind: "page" | "folder",
  name: string,
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: kind === "page" ? "New root page" : "New root folder" })
    .click();
  await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible();
}

export async function createChildItem(
  page: Page,
  parentName: string,
  kind: "page" | "folder",
  name: string,
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  const button = page.getByRole("button", { name: `New ${kind} inside ${parentName}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
}

/** Selects a tree item by clicking its name (never the action buttons). */
export async function selectItem(page: Page, name: string): Promise<void> {
  await page.getByTestId(`tree-item-${name}`).locator(".tree-name").click();
  await expect(page.getByTestId(`tree-item-${name}`)).toHaveAttribute("aria-selected", "true");
}

export async function waitForSynchronized(page: Page): Promise<void> {
  // The queue must drain (no pending/conflict rows) and the state settle.
  await expect(page.getByTestId("mutation-status-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced", {
    timeout: 20_000,
  });
}

/** Waits for the save's own accepted batch, avoiding a stale pre-save synced state. */
export async function savePageAndSynchronize(page: Page): Promise<void> {
  const accepted = page.waitForResponse(
    (response) => response.url().includes("/v1/mutations/batch") && response.ok(),
  );
  await page.getByRole("button", { name: "Save page" }).click();
  await accepted;
  await waitForSynchronized(page);
}

/** Keeps principal review images in the Playwright HTML report/CI artifact. */
export async function attachReviewScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (!testInfo.project.name.startsWith("chromium")) {
    return;
  }
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}
