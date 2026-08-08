/**
 * Shared Playwright helpers: unique names per run and common journeys.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import pg from "pg";

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Clears durable content so each journey starts from an empty workspace. */
export async function resetCanonicalContent(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE items, placements, page_documents, logical_files, file_contents,
        relationships, revisions, revision_parents, mutations, changes,
        lifecycle_events, exports CASCADE`,
    );
  } finally {
    await client.end();
  }
}

export async function openWorkspace(page: Page): Promise<void> {
  // Fresh contexts start on about:blank; reloads keep the app origin and must
  // preserve the content the journey just wrote.
  if (page.url() === "about:blank" || page.url() === "") {
    await resetCanonicalContent();
  }
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

/**
 * Simulate API unavailability for offline journeys.
 *
 * The Vite PWA service worker can bypass Playwright `page.route` aborts on
 * WebKit (and occasionally Firefox), so outbox offline tests unregister
 * workers first. The document shell stays loadable from the Vite server.
 * Pass `{ preserveServiceWorker: true }` when the journey itself exercises
 * CacheFirst file-revision caching (Chromium).
 */
export async function goOffline(
  page: Page,
  options: { readonly preserveServiceWorker?: boolean } = {},
): Promise<void> {
  if (options.preserveServiceWorker !== true) {
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) {
        return;
      }
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    });
  }
  const context = page.context();
  await context.route("**/v1/**", (route) => route.abort("connectionrefused"));
  await context.route("**/health", (route) => route.abort("connectionrefused"));
}

export async function goOnline(page: Page): Promise<void> {
  const context = page.context();
  await context.unroute("**/v1/**");
  await context.unroute("**/health");
}

/** Reload while keeping the simulated API outage (routes + no service worker). */
export async function reloadWhileOffline(
  page: Page,
  options: { readonly preserveServiceWorker?: boolean } = {},
): Promise<void> {
  await page.reload();
  await goOffline(page, options);
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
