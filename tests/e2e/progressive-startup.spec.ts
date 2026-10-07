/** Current roots and cached pages remain usable while ordered catch-up continues. */

import { writeFile } from "node:fs/promises";
import { generateUuidV7 } from "@myownnotion/domain";
import type { APIRequestContext, Locator, Page, Route, TestInfo } from "@playwright/test";
import { META_KEYS } from "../../packages/client-core/src/local-store/schema.ts";
import { expect, test } from "./fixtures.ts";
import {
  apiOrigin,
  CURRENT_PROTOCOL_HEADERS,
  closeMobileNavigation,
  createRootItem,
  createUnopenedPage,
  ensureNavigationRowVisible,
  ensureNavigationVisible,
  entryTrigger,
  expectNoHorizontalOverflow,
  openWorkspace,
  saveDocument,
  selectItem,
  typeIntoEditor,
  uniqueName,
  waitForSynchronized,
} from "./helpers.ts";

const CHANGE_FEED = /\/v1\/changes(?:\?|$)/u;
const DELAY_MS = 5_000;

function editor(page: Page) {
  return page.locator('[data-testid="block-editor"]:visible').locator(".ProseMirror");
}

async function attachStartupVisuals(page: Page, testInfo: TestInfo, phase: string) {
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const path = testInfo.outputPath(`${phase}-${colorScheme}.png`);
      await page.screenshot({ path, fullPage: false, animations: "disabled" });
      await testInfo.attach(`${phase}-${colorScheme}`, {
        path,
        contentType: "image/png",
      });
    }
  } finally {
    await page.emulateMedia({ colorScheme: null });
  }
}

async function attachNarrowStartupVisuals(
  page: Page,
  testInfo: TestInfo,
  phase: string,
  surface: Locator,
  state: "loading" | "offline",
) {
  const previousViewport = page.viewportSize();
  if (previousViewport === null) throw new Error("Startup visual tests need a configured viewport");
  const navigation = page.locator(".workspace-sidebar-slot");
  const navigationWasOpen = (await navigation.getAttribute("data-open")) === "true";
  try {
    await page.setViewportSize({ width: 320, height: previousViewport.height });
    await expect(navigation).toHaveAttribute("data-mode", "mobile");
    await closeMobileNavigation(page);
    await expect(navigation).toHaveAttribute("data-open", "false");
    await surface.scrollIntoViewIfNeeded();
    await expect(surface).toBeVisible();
    if (state === "loading") {
      await expect(surface).toContainText("Chargement de la base de données");
      await expect(surface.getByRole("grid")).toHaveCount(0);
    } else {
      await expect(surface.getByRole("grid")).toBeVisible();
      await expect(surface.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
      await expect(surface.getByTestId("database-discovery-state")).toBeVisible();
      await expect(surface.getByTestId("database-discovery-state")).toHaveAttribute(
        "data-state",
        "offline",
      );
    }
    // Wide database columns may scroll in their own container. The document
    // itself must remain bounded so the notice is readable at 320 px.
    await expectNoHorizontalOverflow(page);
    await attachStartupVisuals(page, testInfo, `${phase}-320`);
  } finally {
    if (!page.isClosed()) {
      await page.setViewportSize(previousViewport);
      await expect(navigation).toHaveAttribute(
        "data-mode",
        previousViewport.width < 768 ? "mobile" : /^(desktop|tablet)$/,
      );
      if (navigationWasOpen) {
        await ensureNavigationVisible(page);
      } else if ((await navigation.getAttribute("data-open")) === "true") {
        await page.getByTestId("toggle-sidebar").click();
        await expect(navigation).toHaveAttribute("data-open", "false");
      }
    }
  }
}

async function attachStartupMeasurement(
  testInfo: TestInfo,
  name: string,
  measurement: Record<string, number>,
) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, `${JSON.stringify(measurement, null, 2)}\n`);
  await testInfo.attach(name, { path, contentType: "application/json" });
}

/** A controlled late request proves readiness without assuming a fast test host. */
async function holdChanges(page: Page, afterFirstPage: boolean) {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let heldAt = 0;
  let released = false;
  let disposal: Promise<void> | undefined;
  const pendingHandlers = new Set<Promise<void>>();
  const handler = async (route: Route) => {
    const handling = (async () => {
      requests += 1;
      if (!released && (!afterFirstPage || requests > 1)) {
        if (heldAt === 0) heldAt = Date.now();
        await gate;
      }
      if (page.isClosed()) return;
      try {
        await route.continue();
      } catch (error) {
        if (!page.isClosed()) throw error;
      }
    })();
    pendingHandlers.add(handling);
    try {
      await handling;
    } finally {
      pendingHandlers.delete(handling);
    }
  };
  await page.route(CHANGE_FEED, handler);
  return {
    get heldAt() {
      return heldAt;
    },
    get released() {
      return released;
    },
    async waitForHeld() {
      await expect.poll(() => heldAt, { timeout: 30_000 }).toBeGreaterThan(0);
    },
    async waitForDelay() {
      await this.waitForHeld();
      const remaining = Math.max(0, DELAY_MS - (Date.now() - heldAt));
      if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    },
    async dispose() {
      disposal ??= (async () => {
        released = true;
        release();
        // Unrouting a still-held request lets Playwright handle it itself.
        // Finish our continuation first, then unregister exactly this handler.
        while (pendingHandlers.size > 0) await Promise.all([...pendingHandlers]);
        if (page.isClosed()) return;
        try {
          await page.unroute(CHANGE_FEED, handler);
        } catch (error) {
          if (!page.isClosed()) throw error;
        }
      })();
      await disposal;
    },
  };
}

async function seedBranch(request: APIRequestContext, name: string, childCount: number) {
  const itemId = generateUuidV7();
  const created = await request.post(`${apiOrigin()}/v1/items`, {
    headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": generateUuidV7() },
    data: {
      id: itemId,
      kind: "folder",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "A" },
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  const children = Array.from({ length: childCount }, (_, index) => ({
    id: generateUuidV7(),
    name: `${name} ${String(index).padStart(3, "0")}`,
    positionKey: `V${String(index).padStart(3, "0")}`,
  }));
  for (let offset = 0; offset < children.length; offset += 100) {
    const batch = children.slice(offset, offset + 100);
    const response = await request.post(`${apiOrigin()}/v1/mutations/batch`, {
      headers: CURRENT_PROTOCOL_HEADERS,
      data: {
        mutations: batch.map((child) => ({
          mutationId: generateUuidV7(),
          commandType: "item.create",
          baseRevisionIds: [],
          payload: {
            id: child.id,
            kind: "folder",
            name: child.name,
            placement: {
              kind: "hierarchy",
              parentItemId: itemId,
              positionKey: child.positionKey,
            },
          },
        })),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const result = (await response.json()) as { results: Array<{ status: string }> };
    expect(result.results).toHaveLength(batch.length);
    expect(result.results.every(({ status }) => status === "accepted")).toBe(true);
  }
  return { itemId, children };
}

async function pendingWorkspaceWrites(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
    if (service === undefined) throw new Error("The local-content test hook is unavailable");
    return (await service.outbox.all()).length;
  });
}

test.describe("progressive startup (feature 040)", () => {
  test("a fresh device opens current roots before 300 descendants finish, then searches the final data", async ({
    page,
    request,
  }, testInfo) => {
    // Bulk setup is outside the startup measurement and does not open the app:
    // this browser still has neither projection rows nor cached page journals.
    test.setTimeout(120_000);
    const pageName = uniqueName("ReadableRoot");
    const rootText = "Root content is usable before the remaining descendants arrive.";
    await createUnopenedPage(request, pageName, {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: {
        blocks: [{ id: generateUuidV7(), type: "paragraph", content: [{ text: rootText }] }],
      },
    });
    const hostName = uniqueName("InlineRoot");
    const sourceName = uniqueName("ProgressiveInlineSource");
    const entryName = uniqueName("LateInlineEntry");
    const sourceItemId = generateUuidV7();
    const viewId = generateUuidV7();
    const host = await createUnopenedPage(request, hostName, {
      format: "myownnotion.document+json",
      formatVersion: 3,
      body: {
        blocks: [
          { id: generateUuidV7(), type: "paragraph", content: [{ text: "Inline database" }] },
          { id: generateUuidV7(), type: "databaseView", containerItemId: sourceItemId, viewId },
          { id: generateUuidV7(), type: "paragraph", content: [] },
        ],
      },
    });
    const source = await request.post(`${apiOrigin()}/v1/databases`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": generateUuidV7() },
      data: {
        id: sourceItemId,
        name: sourceName,
        hostPageId: host.itemId,
        titlePropertyId: generateUuidV7(),
        initialViewId: viewId,
        initialViewName: "Tableau",
        placement: { id: generateUuidV7(), parentItemId: host.itemId, positionKey: "a0" },
      },
    });
    expect(source.status(), await source.text()).toBe(201);

    const branchName = uniqueName("ProgressiveRoot");
    const branch = await seedBranch(request, branchName, 300);
    // The source definition is in the first feed page; its only membership and
    // item land after the 300 descendants, in the intentionally held page.
    const entry = await request.post(`${apiOrigin()}/v1/databases/${sourceItemId}/entries`, {
      headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": generateUuidV7() },
      data: {
        id: generateUuidV7(),
        title: entryName,
        kind: "page",
        values: {},
        relationTargets: {},
      },
    });
    expect(entry.status(), await entry.text()).toBe(201);
    const lastChild = branch.children.at(-1);
    if (lastChild === undefined) throw new Error("The fixture has no final descendant");

    const delayed = await holdChanges(page, true);
    const startedAt = Date.now();
    try {
      await openWorkspace(page);
      const root = await ensureNavigationRowVisible(page, branchName);
      const rootReadyMs = Date.now() - startedAt;
      await delayed.waitForHeld();
      expect(delayed.released).toBe(false);
      await expect(page.getByTestId(`tree-item-${lastChild.name}`)).toHaveCount(0);

      // The loading message belongs to this branch, including when the first
      // catch-up page has already revealed some of its children.
      await root.focus();
      if ((await root.getAttribute("aria-expanded")) !== "true") await root.press("ArrowRight");
      await expect(root).toHaveAttribute("aria-expanded", "true");
      const children = page.getByTestId(`children-${branchName}`);
      await expect(children.getByTestId("branch-state-loading")).toBeVisible();
      await expect(children.getByTestId("branch-state-empty")).toHaveCount(0);
      await expect.poll(() => children.getByRole("treeitem").count()).toBeGreaterThan(0);
      expect(await children.getByRole("treeitem").count()).toBeLessThan(300);
      await expect(page.getByTestId(`tree-item-${lastChild.name}`)).toHaveCount(0);
      await attachStartupVisuals(page, testInfo, "fresh-partial");

      // Opening the current root page does not wait for the held historical
      // feed and must display its real body rather than an empty document.
      await selectItem(page, pageName);
      await expect(editor(page)).toContainText(rootText, { timeout: 30_000 });
      expect(delayed.released).toBe(false);

      await selectItem(page, hostName);
      const hostRow = await ensureNavigationRowVisible(page, hostName);
      await hostRow.focus();
      if ((await hostRow.getAttribute("aria-expanded")) !== "true") {
        await hostRow.press("ArrowRight");
      }
      // This child cannot come from the current-root preload. Its appearance
      // proves the first feed page already applied the source definition.
      await expect(page.getByTestId(`tree-item-${sourceName}`)).toBeVisible();
      await closeMobileNavigation(page);
      const inline = page.getByTestId("database-view-block");
      await expect(inline).toBeVisible();
      await expect(inline).toContainText("Chargement de la base de données");
      await expect(inline.getByRole("alert")).toHaveCount(0);
      await expect(inline.locator(".database-table")).toHaveCount(0);
      await expect(entryTrigger(inline, entryName)).toHaveCount(0);
      await attachStartupVisuals(page, testInfo, "fresh-inline-partial");
      await attachNarrowStartupVisuals(page, testInfo, "fresh-inline-partial", inline, "loading");
      await delayed.waitForDelay();
      const heldMs = Date.now() - delayed.heldAt;
      expect(heldMs).toBeGreaterThanOrEqual(DELAY_MS);
      await delayed.dispose();

      await waitForSynchronized(page, { timeoutMs: 30_000 });
      await expect(entryTrigger(inline, entryName)).toBeVisible();
      await expect(inline).not.toContainText("Chargement de la base de données");
      await expect(inline.getByRole("alert")).toHaveCount(0);
      await attachStartupVisuals(page, testInfo, "fresh-inline-complete");
      await selectItem(page, pageName);
      await expect(editor(page)).toContainText(rootText);
      await ensureNavigationVisible(page);
      await expect(children.getByRole("treeitem")).toHaveCount(300, { timeout: 30_000 });
      await expect(children.getByTestId("branch-state-loading")).toHaveCount(0);
      await expect(page.getByTestId(`tree-item-${pageName}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(root).toHaveAttribute("aria-expanded", "true");
      expect(
        await children
          .getByRole("treeitem")
          .evaluateAll((rows) =>
            rows.map((row) => (row.getAttribute("data-testid") ?? "").replace("tree-item-", "")),
          ),
      ).toEqual(branch.children.map(({ name }) => name));
      await root.scrollIntoViewIfNeeded();
      await attachStartupVisuals(page, testInfo, "fresh-complete");

      // Search was never opened during discovery. Its first use must include
      // the final batch, and selecting the result uses the retained hierarchy.
      await closeMobileNavigation(page);
      await page.keyboard.press("ControlOrMeta+k");
      const search = page.getByRole("dialog", { name: "Rechercher dans l’espace de travail" });
      await expect(search).toBeVisible();
      await search.getByLabel("Recherche", { exact: true }).fill(lastChild.name);
      await search.getByRole("button", { name: "Rechercher", exact: true }).click();
      const result = search.getByRole("listitem").filter({ hasText: lastChild.name });
      await expect(result).toHaveCount(1);
      await result.getByRole("button").click();
      await expect(search).toBeHidden();
      await expect(page.getByTestId(`tree-item-${lastChild.name}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await attachStartupMeasurement(testInfo, "progressive-startup-measurement", {
        descendants: 300,
        rootReadyMs,
        heldMs,
      });

      // An older cache predates the discovery marker, while its existing rows
      // and page journals remain valid. Removing only this metadata on the
      // disposable device models that upgrade without altering cached content.
      await waitForSynchronized(page);
      await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
      await page.route("**/health", (route) => route.abort("connectionrefused"));
      await page.routeWebSocket("**/v1/page-sync/socket", (socket) => socket.close());
      await page.evaluate(async (key) => {
        const service = window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.();
        if (service === undefined) throw new Error("The local-content test hook is unavailable");
        const meta = (
          service.db as typeof service.db & {
            readonly meta: {
              get(key: string): Promise<{ readonly value: unknown } | undefined>;
              delete(key: string): Promise<unknown>;
            };
          }
        ).meta;
        if ((await meta.get(key))?.value !== true) {
          throw new Error("The completed fixture has no durable discovery marker");
        }
        await meta.delete(key);
        if ((await meta.get(key)) !== undefined) {
          throw new Error("The legacy cache fixture retained its discovery marker");
        }
      }, META_KEYS.projectionComplete);
      await page.reload({ waitUntil: "domcontentloaded" });
      await openWorkspace(page);
      await selectItem(page, hostName);
      await closeMobileNavigation(page);
      const cachedInline = page.getByTestId("database-view-block");
      await expect(entryTrigger(cachedInline, entryName)).toBeVisible();
      await expect(cachedInline.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
      await expect(cachedInline.getByTestId("database-discovery-state")).toHaveAttribute(
        "data-state",
        "offline",
      );
      await expect(cachedInline.getByTestId("database-discovery-state")).toContainText(
        "Données locales disponibles. Reconnectez-vous pour charger les autres entrées.",
      );
      await expect(cachedInline.getByRole("alert")).toHaveCount(0);
      await attachStartupVisuals(page, testInfo, "legacy-cache-inline-offline");
      await attachNarrowStartupVisuals(
        page,
        testInfo,
        "legacy-cache-inline-offline",
        cachedInline,
        "offline",
      );

      await selectItem(page, sourceName);
      await closeMobileNavigation(page);
      const cachedNative = page.getByRole("main").locator(".database-container-page:visible");
      await expect(cachedNative).toHaveCount(1);
      await expect(entryTrigger(cachedNative, entryName)).toBeVisible();
      await expect(cachedNative.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
      await expect(cachedNative.getByTestId("database-discovery-state")).toHaveAttribute(
        "data-state",
        "offline",
      );
      await expect(cachedNative.getByTestId("database-discovery-state")).toContainText(
        "Données locales disponibles. Reconnectez-vous pour charger les autres entrées.",
      );
      await expect(cachedNative.getByRole("alert")).toHaveCount(0);
      await attachStartupVisuals(page, testInfo, "legacy-cache-native-offline");
      await attachNarrowStartupVisuals(
        page,
        testInfo,
        "legacy-cache-native-offline",
        cachedNative,
        "offline",
      );
    } finally {
      await delayed.dispose();
      if (!page.isClosed()) {
        await page.unroute("**/v1/**");
        await page.unroute("**/health");
      }
    }
  });

  test("cached content appears before a slow feed and preserves concurrent local work through restart", async ({
    page,
    context,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageName = uniqueName("CachedRoot");
    const { itemId } = await createUnopenedPage(request, pageName);
    const initialText = "This page is already stored on this device.";
    const localText = "This offline edit survives restart and catch-up.";
    const pendingName = uniqueName("CreatedDuringCatchup");
    await openWorkspace(page);
    await selectItem(page, pageName);
    await typeIntoEditor(page, initialText);
    await saveDocument(page, { until: "synced" });
    await waitForSynchronized(page);

    const delayed = await holdChanges(page, false);
    const startedAt = Date.now();
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await openWorkspace(page);
      await expect(editor(page)).toContainText(initialText);
      const cachedReadyMs = Date.now() - startedAt;
      await delayed.waitForHeld();
      expect(delayed.released).toBe(false);
      await attachStartupVisuals(page, testInfo, "cached-held");

      // This optimistic workspace write lands while the slow read is in
      // flight. Refusing submission keeps the queue durable so releasing that
      // older read exercises the projection guard rather than a lucky server
      // acknowledgement arriving first.
      await page.route("**/v1/mutations/batch", (route) => route.abort("connectionrefused"));
      await createRootItem(page, "folder", pendingName);
      await expect.poll(() => pendingWorkspaceWrites(page)).toBeGreaterThan(0);
      await delayed.waitForDelay();
      const heldMs = Date.now() - delayed.heldAt;
      expect(heldMs).toBeGreaterThanOrEqual(DELAY_MS);
      await delayed.dispose();
      await ensureNavigationRowVisible(page, pendingName);
      await expect.poll(() => pendingWorkspaceWrites(page)).toBeGreaterThan(0);

      await context.setOffline(true);
      await selectItem(page, pageName);
      await typeIntoEditor(page, localText);
      await saveDocument(page);
      await expect(page.getByTestId("editor-sync-status")).toHaveAttribute("data-sync", "offline");

      // The shell remains reachable for a restart, while both production sync
      // transports are unavailable. HTTP fallback later proves convergence
      // without depending on a live socket reconnecting at just the right time.
      await page.route("**/v1/**", (route) => route.abort("connectionrefused"));
      await page.route("**/health", (route) => route.abort("connectionrefused"));
      await page.routeWebSocket("**/v1/page-sync/socket", (socket) => socket.close());
      await context.setOffline(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await openWorkspace(page);
      await ensureNavigationRowVisible(page, pendingName);
      await expect.poll(() => pendingWorkspaceWrites(page)).toBeGreaterThan(0);
      await selectItem(page, pageName);
      await expect(editor(page)).toContainText(localText);
      await saveDocument(page);
      await expect(page.getByTestId("conflict-notice")).toHaveCount(0);

      await page.unroute("**/v1/**");
      await page.unroute("**/health");
      await page.unroute("**/v1/mutations/batch");
      await page.reload({ waitUntil: "domcontentloaded" });
      await openWorkspace(page);
      await waitForSynchronized(page, { timeoutMs: 30_000 });
      await selectItem(page, pageName);
      await saveDocument(page, { until: "synced" });
      await expect(editor(page)).toContainText(localText);
      await expect.poll(() => pendingWorkspaceWrites(page)).toBe(0);

      const canonical = await request.get(`${apiOrigin()}/v1/items/${itemId}`, {
        headers: CURRENT_PROTOCOL_HEADERS,
      });
      expect(canonical.status(), await canonical.text()).toBe(200);
      expect(JSON.stringify((await canonical.json()).pageDocument)).toContain(localText);
      const roots = await request.get(`${apiOrigin()}/v1/items?parentItemId=root`, {
        headers: CURRENT_PROTOCOL_HEADERS,
      });
      expect(roots.status(), await roots.text()).toBe(200);
      const current = (await roots.json()) as { items: Array<{ name: string }> };
      expect(current.items.filter(({ name }) => name === pendingName)).toHaveLength(1);
      await attachStartupVisuals(page, testInfo, "cached-complete");
      await attachStartupMeasurement(testInfo, "cached-startup-measurement", {
        cachedReadyMs,
        heldMs,
      });
    } finally {
      await delayed.dispose();
      if (!page.isClosed()) {
        await context.setOffline(false);
        await page.unroute("**/v1/**");
        await page.unroute("**/health");
        await page.unroute("**/v1/mutations/batch");
      }
    }
  });
});
