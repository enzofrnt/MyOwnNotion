/**
 * Shared Playwright helpers: unique names per run and common journeys.
 *
 * The security section at the bottom adds the virtual-authenticator, mounted
 * secret, and readiness helpers the feature-002 journeys need (T003).
 */
import { generateUuidV7, type PageDocument, PROTOCOL_VERSION } from "@myownnotion/domain";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type ElementHandle,
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { seedSessionOnNewDevice } from "./reset-installation.ts";

export interface CssTransitionSample {
  readonly height: number;
  readonly transform: string;
  readonly width: number;
}

/**
 * Freezes a real CSS transition at an exact progress point before measuring it.
 *
 * A fixed sleep does not prove an intermediate frame: on a busy runner 70 ms
 * can take longer than a 210 ms transition. Reading the browser animation and
 * seeking it to its midpoint makes the assertion deterministic while still
 * exercising the production CSS rather than a test-only animation.
 */
export async function sampleCssTransition(
  locator: Locator,
  transitionProperty: string,
  progress = 0.5,
): Promise<CssTransitionSample> {
  await expect(locator).toBeAttached();
  return await locator.evaluate(
    async (element, options): Promise<CssTransitionSample> => {
      const findTransition = (): CSSTransition | undefined =>
        element
          .getAnimations()
          .find(
            (animation): animation is CSSTransition =>
              "transitionProperty" in animation &&
              animation.transitionProperty === options.transitionProperty,
          );

      let transition = findTransition();
      for (let frame = 0; transition === undefined && frame < 12; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        transition = findTransition();
      }
      if (transition === undefined) {
        throw new Error(`No active ${options.transitionProperty} transition was found`);
      }

      transition.pause();
      const timing = transition.effect?.getComputedTiming();
      const duration = typeof timing?.duration === "number" ? timing.duration : 0;
      if (duration <= 0) {
        throw new Error(`${options.transitionProperty} transition has no measurable duration`);
      }
      transition.currentTime = duration * options.progress;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const rectangle = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const sample = {
        height: rectangle.height,
        transform: style.transform,
        width: rectangle.width,
      };
      transition.finish();
      return sample;
    },
    { progress, transitionProperty },
  );
}

export interface CssTransitionTarget {
  readonly locator: Locator;
  readonly property: string;
}

/**
 * Starts an interaction and freezes its transitions without a driver round trip.
 *
 * Firefox runs in a Linux container on macOS. Clicking through Playwright and
 * asking for the animation in a second command can therefore arrive after a
 * short production transition has already finished. Starting the click and
 * observing the resulting animations in one browser task proves the same real
 * intermediate frame without making the assertion depend on host latency.
 */
export async function triggerAndSampleCssTransitions(
  trigger: Locator,
  targets: readonly CssTransitionTarget[],
  progress = 0.5,
): Promise<CssTransitionSample[]> {
  if (targets.length === 0) {
    throw new Error("At least one CSS transition target is required");
  }
  await expect(trigger).toBeVisible();
  for (const target of targets) {
    await expect(target.locator).toBeAttached();
  }

  const triggerElement = await trigger.elementHandle();
  if (triggerElement === null) throw new Error("The transition trigger is not attached");
  const targetHandles: ElementHandle[] = [];
  try {
    for (const target of targets) {
      const handle = await target.locator.elementHandle();
      if (handle === null) {
        throw new Error(`The ${target.property} transition target is not attached`);
      }
      targetHandles.push(handle);
    }

    return await triggerElement.evaluate(
      async (button, options): Promise<CssTransitionSample[]> => {
        const nextFrame = (): Promise<void> =>
          new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        const findTransition = (
          element: Element,
          transitionProperty: string,
        ): CSSTransition | undefined =>
          element
            .getAnimations()
            .find(
              (animation): animation is CSSTransition =>
                "transitionProperty" in animation &&
                animation.transitionProperty === transitionProperty,
            );

        const control = button as HTMLElement;
        control.focus();
        control.click();

        const elements = options.targets.map((target) => target.element as unknown as Element);
        const transitions: Array<CSSTransition | undefined> = elements.map((element, index) => {
          const property = options.targets[index]?.property;
          return property === undefined ? undefined : findTransition(element, property);
        });
        for (
          let frame = 0;
          transitions.some((transition) => transition === undefined) && frame < 12;
          frame += 1
        ) {
          await nextFrame();
          for (const [index, element] of elements.entries()) {
            const property = options.targets[index]?.property;
            if (transitions[index] === undefined && property !== undefined) {
              transitions[index] = findTransition(element, property);
            }
          }
        }

        const missing = transitions.indexOf(undefined);
        if (missing !== -1) {
          throw new Error(
            `No active ${options.targets[missing]?.property ?? "unknown"} transition was found`,
          );
        }

        for (const [index, transition] of transitions.entries()) {
          if (transition === undefined) continue;
          transition.pause();
          const timing = transition.effect?.getComputedTiming();
          const duration = typeof timing?.duration === "number" ? timing.duration : 0;
          if (duration <= 0) {
            throw new Error(
              `${options.targets[index]?.property ?? "unknown"} transition has no measurable duration`,
            );
          }
          transition.currentTime = duration * options.progress;
        }
        await nextFrame();

        const samples: CssTransitionSample[] = [];
        for (const [index, transition] of transitions.entries()) {
          if (transition === undefined) continue;
          const element = elements[index];
          if (element === undefined) continue;
          const rectangle = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          samples.push({
            height: rectangle.height,
            transform: style.transform,
            width: rectangle.width,
          });
          transition.finish();
        }
        return samples;
      },
      {
        progress,
        targets: targets.map((target, index) => ({
          element: targetHandles[index],
          property: target.property,
        })),
      },
    );
  } finally {
    await Promise.all([
      triggerElement.dispose(),
      ...targetHandles.map((handle) => handle.dispose()),
    ]);
  }
}

export async function triggerAndSampleCssTransition(
  trigger: Locator,
  locator: Locator,
  transitionProperty: string,
  progress = 0.5,
): Promise<CssTransitionSample> {
  const [sample] = await triggerAndSampleCssTransitions(
    trigger,
    [{ locator, property: transitionProperty }],
    progress,
  );
  if (sample === undefined) {
    throw new Error(`No active ${transitionProperty} transition was found`);
  }
  return sample;
}

/**
 * Starts an interaction that mounts its animated target, then freezes it.
 *
 * A collapsed hierarchy region is deliberately absent from the DOM. Resolving
 * its locator before the opening click therefore cannot be correct. Querying
 * the stable test identity after the click, in the same browser task, keeps
 * Firefox's host/container latency outside the transition window.
 */
export async function triggerAndSampleMountedCssTransition(
  trigger: Locator,
  targetTestId: string,
  transitionProperty: string,
  progress = 0.5,
): Promise<CssTransitionSample> {
  await expect(trigger).toBeVisible();
  return await trigger.evaluate(
    async (button, options): Promise<CssTransitionSample> => {
      const triggerElement = button as HTMLElement;
      triggerElement.focus();
      triggerElement.click();

      let target: HTMLElement | undefined;
      let transition: CSSTransition | undefined;
      for (let frame = 0; transition === undefined && frame < 12; frame += 1) {
        target = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (element) => element.dataset["testid"] === options.targetTestId,
        );
        transition = target
          ?.getAnimations()
          .find(
            (animation): animation is CSSTransition =>
              "transitionProperty" in animation &&
              animation.transitionProperty === options.transitionProperty,
          );
        if (transition === undefined) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      if (target === undefined) {
        throw new Error(`The mounted transition target ${options.targetTestId} was not found`);
      }
      if (transition === undefined) {
        throw new Error(`No active ${options.transitionProperty} transition was found`);
      }

      transition.pause();
      const timing = transition.effect?.getComputedTiming();
      const duration = typeof timing?.duration === "number" ? timing.duration : 0;
      if (duration <= 0) {
        throw new Error(`${options.transitionProperty} transition has no measurable duration`);
      }
      transition.currentTime = duration * options.progress;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const rectangle = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      const sample = {
        height: rectangle.height,
        transform: style.transform,
        width: rectangle.width,
      };
      transition.finish();
      return sample;
    },
    { progress, targetTestId, transitionProperty },
  );
}

interface E2ELocalContentService {
  synchronize(): Promise<string>;
  getItem(itemId: string): Promise<{
    readonly currentRevisionId: string;
    readonly kind: string;
    readonly pageDocument: unknown;
  } | null>;
  mutate(
    commandType: string,
    payload: Record<string, unknown>,
    baseRevisionIds: string[],
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly error: { readonly code: string } }
  >;
  readonly outbox: {
    all(): Promise<
      Array<{
        readonly mutationId: string;
        readonly commandType: string;
        readonly payload: Record<string, unknown>;
        readonly localRevisionIds: string[];
      }>
    >;
    captureConflict(
      mutationId: string,
      competingRevisionIds: string[],
      errorCode: string,
    ): Promise<void>;
    conflicts(): Promise<unknown[]>;
    activeConflicts(): Promise<unknown[]>;
  };
  readonly db: {
    readonly legacySyncRecoveries: { clear(): Promise<void> };
    readonly revisionHeaders: {
      get(revisionId: string): Promise<{ readonly canonicalRevisionId?: string } | undefined>;
    };
  };
  readonly legacyConflictRecovery: {
    list(): Promise<
      Array<{
        readonly mutationId: string;
        readonly reasonCode: string | null;
        readonly status: string;
      }>
    >;
  };
  readonly pageOperationLog: {
    getState(pageId: string): Promise<{ readonly status: string } | null>;
    getLegacyBranch(pageId: string): Promise<{ readonly status: string } | null>;
  };
}

declare global {
  interface Window {
    readonly __MYOWNNOTION_E2E_LOCAL_CONTENT__?: () => E2ELocalContentService;
  }
}

/** Headers for direct API setup calls made by the current E2E client. */
export const CURRENT_PROTOCOL_HEADERS = {
  "x-myownnotion-client-protocol": String(PROTOCOL_VERSION),
} as const;

// A second isolated WebKit context loads the complete Vite module graph again.
// On the two-core reference runner that cold boot can legitimately exceed the
// generic assertion budget while the app is still making forward progress.
// Keep interaction assertions strict; only the initial application boundary
// receives the same 30-second allowance already used by authentication boots.
const WORKSPACE_BOOT_TIMEOUT_MS = 30_000;

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Creates server content without opening its editor in the browser.
 *
 * Historical-protocol and large-document journeys need to prepare the exact
 * document that exists before a modern client first opens it. Creating through
 * the navigation is intentionally unsuitable: page creation now navigates to
 * the new page, and mounting that editor activates convergent synchronization
 * before the fixture can be installed.
 */
export async function createUnopenedPage(
  request: APIRequestContext,
  name: string,
  document: PageDocument = {
    format: "myownnotion.document+json",
    formatVersion: 1,
    body: {},
  },
): Promise<{ itemId: string; revisionId: string }> {
  const itemId = generateUuidV7();
  const response = await request.post(`${apiOrigin()}/v1/items`, {
    headers: { ...CURRENT_PROTOCOL_HEADERS, "idempotency-key": generateUuidV7() },
    data: {
      id: itemId,
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      pageDocument: document,
    },
  });
  const raw = await response.text();
  expect(response.status(), raw).toBe(201);
  const body = JSON.parse(raw) as { revisionIds?: string[] };
  const revisionId = body.revisionIds?.[0];
  if (revisionId === undefined) throw new Error("unopened page creation returned no revision");
  return { itemId, revisionId };
}

export async function openWorkspace(page: Page): Promise<void> {
  // A caller that has just reloaded is already on the workspace URL. Sending a
  // second navigation immediately afterwards is redundant for users and trips
  // a WebKit internal navigation race, especially while API routes are
  // deliberately offline. Initial pages still start at `about:blank` and take
  // the ordinary navigation path.
  const currentUrl = page.url();
  const atWorkspaceRoute =
    currentUrl !== "about:blank" &&
    (() => {
      try {
        const pathname = new URL(currentUrl).pathname;
        return pathname === "/" || pathname === "/notes" || pathname.startsWith("/notes/");
      } catch {
        return false;
      }
    })();
  const transientNetworkChanges: string[] = [];
  const recordTransientNetworkChange = (request: Request) => {
    const errorText = request.failure()?.errorText;
    if (errorText?.includes("ERR_NETWORK_CHANGED") === true) {
      transientNetworkChanges.push(request.url());
    }
  };
  if (!atWorkspaceRoute) page.on("requestfailed", recordTransientNetworkChange);

  try {
    if (!atWorkspaceRoute) await page.goto("/notes", { waitUntil: "domcontentloaded" });
    const shell = page.getByTestId("workspace-shell");
    try {
      await expect(shell).toBeVisible({ timeout: WORKSPACE_BOOT_TIMEOUT_MS });
    } catch (error) {
      // The local matrix starts and tears down isolated browser stacks in
      // parallel. Chromium can observe that host-network transition between
      // receiving Vite's HTML and fetching one of its source modules, leaving
      // an otherwise healthy app on a permanently blank page. Retry only that
      // exact transport failure, and only for a navigation performed here; an
      // application boot error or a deliberately offline existing page still
      // fails at the original assertion.
      if (atWorkspaceRoute || transientNetworkChanges.length === 0) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(shell).toBeVisible({ timeout: WORKSPACE_BOOT_TIMEOUT_MS });
    }
    await expect(
      page
        .locator(
          '[data-testid="active-item-title"], [data-testid="active-item-heading"], .entry-panel',
        )
        .first(),
    ).toBeVisible();
    // Wait for the initial load (tree or empty state) to settle. On a phone the
    // navigation is a closed modal drawer, so readiness is represented by the
    // settled content being attached rather than necessarily visible. Derived
    // services such as search are forbidden from holding this readiness boundary
    // open; a timeout here therefore reports a real boot failure.
    await expect(page.locator('[role="tree"], [data-testid="empty-state"]').first()).toBeAttached({
      timeout: 15_000,
    });
  } finally {
    if (!atWorkspaceRoute) page.off("requestfailed", recordTransientNetworkChange);
  }
}

export async function openRootCreation(page: Page): Promise<void> {
  await ensureNavigationVisible(page);
  const trigger = page.getByTestId("toggle-root-creation");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(page.getByTestId("new-root-page")).toBeVisible();
  await expect(page.getByTestId("new-root-folder")).toBeVisible();
}

export async function openRootDatabaseCreation(page: Page): Promise<void> {
  await ensureNavigationVisible(page);
  // The database control is a visually-hidden test hook. A pointer click lands
  // on the Notes heading that covers its 1×1 box, and opening the adjacent
  // create envelope first treats that click as outside the envelope. Activate
  // the node directly; owners reach the same form through the product UI.
  await page.getByTestId("new-root-database").evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("new-root-database is not a button");
    }
    element.click();
  });
}

export async function clickEditorInsertBlock(page: Page): Promise<void> {
  const insert = page.getByRole("button", { name: "Ajouter un bloc" });
  await expect(insert).toBeVisible();
  // The BlockNote side control sits in the editor gutter. The sidebar column
  // covers that gutter for hit-testing, so a pointer click never reaches the
  // button even though it is visible.
  await insert.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Ajouter un bloc is not a button");
    }
    element.click();
  });
}

async function nameNewlyCreatedItem(page: Page, name: string): Promise<void> {
  const title = page.getByTestId("active-item-title");
  await expect(title).toBeVisible({ timeout: 15_000 });
  await expect(title).toBeFocused({ timeout: 15_000 });
  await expect(title).toHaveValue("");
  await title.fill(name);
  await expect(title).toHaveValue(name);
  await title.press("Enter");
  await expect(title).toHaveValue(name, { timeout: 15_000 });
}

export async function createRootItem(
  page: Page,
  kind: "page" | "folder",
  name: string,
): Promise<void> {
  await openRootCreation(page);
  await page.getByTestId(kind === "page" ? "new-root-page" : "new-root-folder").click();
  await nameNewlyCreatedItem(page, name);
  // A successful page creation deliberately closes the mobile drawer and
  // opens the new page. Assert its projected presence without reopening navigation:
  // doing so would both undo the product outcome and race the asynchronous
  // close that follows the mutation. Callers that need the row interactively
  // use `ensureNavigationRowVisible` afterwards.
  await expect(page.getByTestId(`tree-item-${name}`)).toBeAttached({ timeout: 15_000 });
}

export async function createChildItem(
  page: Page,
  parentName: string,
  kind: "page" | "folder",
  name: string,
): Promise<void> {
  await clickItemAction(page, parentName, `new-${kind}-inside-${parentName}`);
  await nameNewlyCreatedItem(page, name);
  // Page creation is navigation on mobile, so the drawer closing is success,
  // not a reason for this helper to reopen it. The child remains mounted in the
  // tree and later row interactions reopen navigation explicitly.
  await expect(page.getByTestId(`tree-item-${name}`)).toBeAttached({ timeout: 15_000 });
}

export async function ensureNavigationVisible(page: Page): Promise<void> {
  // Observe the actual interactive surface. The structural `workspace-tree`
  // wrapper may have no box of its own on desktop even while its tree is fully
  // visible, which makes Playwright correctly report the wrapper itself as
  // hidden.
  const navigation = page.locator('[role="tree"], [data-testid="empty-state"]').first();
  const trigger = page.getByTestId("toggle-tree");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect
      .poll(async () => (await navigation.isVisible()) || (await trigger.isVisible()), {
        timeout: 15_000,
      })
      .toBe(true);
    if (await navigation.isVisible()) return;
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    try {
      await expect(navigation).toBeVisible({ timeout: 3_000 });
      return;
    } catch {
      // A reload can replace the responsive trigger between resolution and
      // click. Retry against the current trigger instead of waiting on the
      // detached interaction for the rest of the test budget.
    }
  }
  await expect(navigation).toBeVisible({ timeout: 15_000 });
}

export async function ensureNavigationRowVisible(page: Page, itemName: string): Promise<Locator> {
  await ensureNavigationVisible(page);
  const row = page.getByTestId(`tree-item-${itemName}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

/** Opens content attachments without conflating them with hierarchy children. */
export async function openPageAttachments(page: Page, pageName: string): Promise<void> {
  const row = await ensureNavigationRowVisible(page, pageName);
  await row.focus();
  const trigger = page.getByRole("button", { name: `Pièces jointes de ${pageName}` });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(page.getByTestId(`page-attachments-${pageName}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("attachment-panel")).toBeVisible({ timeout: 15_000 });
}

/** Opens one compact attachment row's detailed facts and file actions. */
export async function openAttachmentDetails(page: Page, fileName: string): Promise<void> {
  const trigger = page.getByTestId(`attachment-actions-${fileName}`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId(`attachment-details-${fileName}`)).toBeVisible();
}

/** Opens one row's accessible action menu without relying on hover state. */
export async function openItemActions(page: Page, itemName: string): Promise<void> {
  const row = await ensureNavigationRowVisible(page, itemName);
  await row.focus();
  const trigger = page.getByTestId(`item-actions-${itemName}`);
  await trigger.click();
  await expect(page.getByRole("menu", { name: `Actions pour ${itemName}` })).toBeVisible();
}

/** Dismisses the modal navigation before interacting with mobile page content. */
export async function closeMobileNavigation(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Fermer" });
  if (await dismiss.isVisible()) {
    await dismiss.click();
  }
}

/** Chooses one action from a hierarchy row's menu. */
export async function clickItemAction(
  page: Page,
  itemName: string,
  actionTestId: string,
): Promise<void> {
  await openItemActions(page, itemName);
  await page.getByTestId(actionTestId).click();
}

export async function renameItem(page: Page, itemName: string, nextName: string): Promise<void> {
  const submitted = page.waitForResponse(
    (response) => {
      if (!response.url().endsWith("/v1/mutations/batch")) return false;
      try {
        const body = response.request().postDataJSON() as {
          readonly mutations?: readonly {
            readonly commandType?: unknown;
            readonly payload?: { readonly name?: unknown };
          }[];
        };
        return (
          body.mutations?.some(
            ({ commandType, payload }) =>
              commandType === "item.rename" && payload?.name === nextName,
          ) === true
        );
      } catch {
        return false;
      }
    },
    { timeout: 20_000 },
  );
  page.once("dialog", (dialog) => void dialog.accept(nextName));
  await clickItemAction(page, itemName, `rename-${itemName}`);
  // The click handler intentionally runs asynchronously. A generic "queue is
  // empty" assertion can therefore pass before this specific rename has even
  // reached the outbox. Observe its own batch response so following actions
  // cannot accidentally race the mutation they are meant to follow.
  const response = await submitted;
  expect(response.ok(), `rename batch returned HTTP ${response.status()}`).toBe(true);
  const request = response.request().postDataJSON() as {
    readonly mutations: readonly { readonly mutationId: string; readonly payload: unknown }[];
  };
  const mutationId = request.mutations.find(
    ({ payload }) =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { readonly name?: unknown }).name === nextName,
  )?.mutationId;
  const body = (await response.json()) as {
    readonly results?: readonly { readonly mutationId: string; readonly status: string }[];
  };
  expect(body.results?.find((result) => result.mutationId === mutationId)?.status).toMatch(
    /^(?:accepted|already-accepted)$/u,
  );
  await expect(page.getByTestId(`tree-item-${nextName}`)).toBeVisible({ timeout: 15_000 });
}

export async function trashItem(
  page: Page,
  itemName: string,
  options: { readonly confirm?: boolean } = {},
): Promise<void> {
  await clickItemAction(page, itemName, `trash-${itemName}`);
  const confirmation = page.getByTestId("trash-confirmation");
  await expect(confirmation).toBeVisible();
  if (options.confirm === false) return;
  await confirmation.getByTestId("confirm-trash").click();
  await expect(confirmation).toBeHidden();
}

export async function moveItemToRoot(page: Page, itemName: string): Promise<void> {
  await clickItemAction(page, itemName, `move-root-${itemName}`);
}

export async function moveItemUp(page: Page, itemName: string): Promise<void> {
  await clickItemAction(page, itemName, `move-up-${itemName}`);
}

export async function moveSelectedItemInto(page: Page, targetName: string): Promise<void> {
  await clickItemAction(page, targetName, `move-selected-inside-${targetName}`);
}

/** Reveals and activates conversion from the row's complementary actions. */
export async function convertItem(page: Page, itemName: string): Promise<void> {
  await openItemActions(page, itemName);
  await page.getByTestId(`convert-${itemName}`).click();
}

type SettingsSection =
  | "security"
  | "navigation"
  | "backups"
  | "local-data"
  | "trash"
  | "page-details";

/** Opens the settings destination from its only workspace entry point. */
export async function openSettings(page: Page): Promise<void> {
  if (await page.getByTestId("settings-shell").isVisible()) return;
  await ensureNavigationVisible(page);
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings-shell")).toBeVisible({ timeout: 15_000 });
}

/** Opens an operational destination without treating it as document content. */
export async function openSettingsSection(page: Page, section: SettingsSection): Promise<void> {
  await openSettings(page);
  const destination = page.getByTestId(`settings-nav-${section}`);
  if ((await destination.getAttribute("aria-current")) !== "page") {
    await destination.click();
  }
  await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible({ timeout: 15_000 });
}

/** Opens storage and synchronization diagnostics in their dedicated settings destination. */
export async function openWorkspaceDiagnostics(page: Page): Promise<void> {
  await openSettingsSection(page, "local-data");
  await expect(page.getByTestId("diagnostics-panel")).toBeVisible({ timeout: 15_000 });
}

/** Returns to the retained document workspace after an operational visit. */
export async function returnToWorkspace(page: Page): Promise<void> {
  await page.getByTestId("back-to-workspace").click();
  await expect(page.getByTestId("workspace-surface")).toBeVisible({ timeout: 15_000 });
}

/** Selects a tree item by clicking its name (never the action buttons). */
export async function selectItem(page: Page, name: string): Promise<void> {
  const row = await ensureNavigationRowVisible(page, name);
  await row.locator(".tree-name").click();
  await expect(row).toHaveAttribute("aria-selected", "true", {
    timeout: 15_000,
  });
}

/** Creates one database entry and waits for the form handler to finish. */
export async function createDatabaseEntry(page: Page, title: string): Promise<Locator> {
  const form = page.locator(".database-entry-create");
  const input = form.getByLabel("Nouvelle entrée");
  const submit = form.getByRole("button", { name: "Nouvelle entrée" });
  await expect(input).toBeEnabled({ timeout: 15_000 });
  await input.fill(title);
  await expect(input).toHaveValue(title);
  await submit.click();

  // The exact row is the local mutation acknowledgement. Waiting for the
  // form to unlock as well proves that the async handler from this creation
  // can no longer clear or disable the next user's input.
  const trigger = page.locator("[data-entry-trigger]").filter({ hasText: title }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeEnabled({ timeout: 15_000 });
  return trigger;
}

/** Saves structured values only after the local mutation is observably accepted. */
export async function saveEntryProperties(page: Page): Promise<void> {
  const panel = page.locator(".entry-panel");
  await panel.getByRole("button", { name: "Enregistrer les propriétés" }).click();
  // Waiting for an empty queue immediately after the click can return before
  // the async handler has enqueued anything. This acknowledgement proves the
  // local write happened, so the synchronization wait below cannot race ahead
  // of the action it is meant to observe.
  await expect(panel.getByTestId("entry-properties-saved")).toHaveText(
    "Propriétés enregistrées localement.",
    { timeout: 15_000 },
  );
  await waitForSynchronized(page);
}

/** Waits for an acknowledged database-definition edit to finish locally. */
export async function waitForDatabaseDefinitionIdle(page: Page): Promise<void> {
  await expect(page.locator(".database-page")).toHaveAttribute("data-definition-state", "idle", {
    timeout: 20_000,
  });
}

/** Waits for an acknowledged database-definition edit to finish locally and remotely. */
export async function waitForDatabaseDefinitionSaved(page: Page): Promise<void> {
  await waitForDatabaseDefinitionIdle(page);
  await waitForSynchronized(page);
}

export async function waitForSynchronized(page: Page): Promise<void> {
  // The compact workspace status is derived from the aggregate durable queue:
  // `synced` is impossible while a workspace mutation, page operation, legacy
  // branch, or conflict is pending. Detailed queue rows live in settings and
  // must not be mounted below every document just to provide a test hook.
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced", {
    timeout: 20_000,
  });
}

/**
 * Reads the tree order as a list of item names.
 *
 * Used to assert an optimistic reorder landed in the DOM *before* waiting for
 * synchronization. `waitForSynchronized` alone is not enough after an action:
 * it proves "nothing is pending right now", not "the thing I just did
 * finished". If the click has not yet reached the outbox, the queue is already
 * empty, the wait returns instantly, and a following `page.reload()` discards
 * the change — the assertion then fails on a correct application.
 */
export async function readTreeOrder(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="tree-item-"]');
  return rows.evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute("data-testid") ?? "").replace("tree-item-", "")),
  );
}

/** Waits until `earlier` precedes `later` in the rendered tree. */
export async function expectTreeOrder(page: Page, earlier: string, later: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const names = await readTreeOrder(page);
        const earlierIndex = names.indexOf(earlier);
        const laterIndex = names.indexOf(later);
        return earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex;
      },
      { timeout: 15_000, message: `expected ${earlier} to precede ${later} in the tree` },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Security journeys (feature 002)
// ---------------------------------------------------------------------------

/**
 * A virtual WebAuthn authenticator attached over CDP, so passkey ceremonies
 * run without a real platform authenticator.
 *
 * CDP is Chromium-only. Journeys that need a passkey must therefore either run
 * on a Chromium project or use the password alternative; `supported` lets a
 * journey skip cleanly on Firefox and WebKit instead of failing.
 */
export interface VirtualAuthenticatorHandle {
  readonly supported: boolean;
  readonly authenticatorId: string | null;
  /** Credentials the authenticator currently holds. */
  credentials(): Promise<Array<{ credentialId: string; signCount: number }>>;
  /** Forces the next assertion to be rejected by the site's replay checks. */
  setUserVerified(verified: boolean): Promise<void>;
  remove(): Promise<void>;
}

const NO_AUTHENTICATOR: VirtualAuthenticatorHandle = {
  supported: false,
  authenticatorId: null,
  credentials: async () => [],
  setUserVerified: async () => {},
  remove: async () => {},
};

export async function attachVirtualAuthenticator(
  page: Page,
  options: { userVerified?: boolean; hasResidentKey?: boolean } = {},
): Promise<VirtualAuthenticatorHandle> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName !== "chromium") {
    return NO_AUTHENTICATOR;
  }

  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: options.hasResidentKey ?? true,
      hasUserVerification: true,
      isUserVerified: options.userVerified ?? true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    supported: true,
    authenticatorId,
    credentials: async () => {
      const result = await session.send("WebAuthn.getCredentials", { authenticatorId });
      return result.credentials.map((credential) => ({
        credentialId: credential.credentialId,
        signCount: credential.signCount,
      }));
    },
    setUserVerified: async (verified) => {
      await session.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: verified });
    },
    remove: async () => {
      await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await session.detach();
    },
  };
}

/** Waits for the installation-status banner to report a specific state. */
export async function waitForInstallationState(
  page: Page,
  state:
    | "uninitialized"
    | "bootstrap-in-progress"
    | "recovery-required"
    | "ready"
    | "migration-in-progress"
    | "degraded",
): Promise<void> {
  await expect(page.getByTestId("installation-status")).toHaveAttribute("data-state", state, {
    timeout: 30_000,
  });
}

/**
 * Asserts the committed owner/workspace counts the bootstrap journeys hinge
 * on: `0/0` before the atomic promotion, `1/1` for every initialized state.
 */
export async function expectCommittedCounts(
  page: Page,
  expected: { ownerCount: 0 | 1; workspaceCount: 0 | 1 },
): Promise<void> {
  const status = page.getByTestId("installation-status");
  await expect(status).toHaveAttribute("data-owner-count", String(expected.ownerCount));
  await expect(status).toHaveAttribute("data-workspace-count", String(expected.workspaceCount));
}

/**
 * Reads the session cookie the API issued, so a journey can assert the
 * production `__Host-mn_session` policy or the loopback `mn_dev_session`
 * exception rather than trusting the UI.
 */
export async function readSessionCookie(
  page: Page,
): Promise<{ name: string; secure: boolean; httpOnly: boolean; sameSite: string } | null> {
  const cookies = await page.context().cookies();
  const session = cookies.find(
    (cookie) => cookie.name === "__Host-mn_session" || cookie.name === "mn_dev_session",
  );
  return session === undefined
    ? null
    : {
        name: session.name,
        secure: session.secure,
        httpOnly: session.httpOnly,
        sameSite: session.sameSite,
      };
}

/**
 * Types into the block editor (feature 003).
 *
 * Replaces the raw-JSON textarea the earlier suites filled. Clearing first
 * because a page opened for the second time already holds content, and `type`
 * appends rather than replaces — a difference that silently turned "version 2"
 * into "version 1version 2" and made a revision assertion pass for the wrong
 * reason.
 */
/**
 * Waits for the editor to be on screen and ready to take a click.
 *
 * On a phone-sized viewport the editor arrives later than the tree row that
 * opens it, so a journey that selects an item and types immediately is racing
 * the layout. It failed as `locator.click` timing out after a minute, pointing
 * at the click rather than at the wait that was missing — which is the least
 * useful place for it to point.
 */
export async function waitForEditor(page: Page): Promise<void> {
  const editor = page.getByTestId("block-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveAttribute("data-editor-settled", /^(?:true|false)$/u, {
    timeout: 15_000,
  });
}

/** Browser input observed by the editor, including work not durable yet. */
export async function editorChangeSequence(page: Page): Promise<number> {
  const value = await page.getByTestId("block-editor").getAttribute("data-editor-change-sequence");
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`invalid editor change sequence: ${String(value)}`);
  }
  return sequence;
}

/** Canonical editor batches handed to the operational engine. */
export async function editorApplyCount(page: Page): Promise<number> {
  const value = await page.getByTestId("block-editor").getAttribute("data-editor-apply-count");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`invalid editor apply count: ${String(value)}`);
  }
  return count;
}

/**
 * Waits for both sides of the editor boundary: the last browser gesture has
 * reached the adapter, and every resulting local transaction is durable.
 */
export async function waitForEditorSettled(
  page: Page,
  options: { readonly afterApplyCount?: number; readonly afterSequence?: number } = {},
): Promise<void> {
  await waitForEditor(page);
  if (options.afterApplyCount !== undefined) {
    await expect
      .poll(() => editorApplyCount(page), {
        timeout: 15_000,
        message: "the editor did not hand the gesture to the operational engine",
      })
      .toBeGreaterThan(options.afterApplyCount);
  }
  if (options.afterSequence !== undefined) {
    await expect
      .poll(() => editorChangeSequence(page), {
        timeout: 15_000,
        message: "the editor did not observe the browser gesture",
      })
      .toBeGreaterThan(options.afterSequence);
  }
  await expect(page.getByTestId("block-editor")).toHaveAttribute("data-editor-settled", "true", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("block-editor")).toHaveAttribute("data-editor-apply-failures", "0");
}

export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await waitForEditorSettled(page);
  const beforeSequence = await editorChangeSequence(page);
  const surface = page.getByTestId("block-editor").locator(".ProseMirror");
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await surface.pressSequentially(text);
  await waitForEditorSettled(page, { afterSequence: beforeSequence });
  await expect(surface).toContainText(text);
}

/**
 * Asserts the page does not scroll sideways, and names the culprit when it does.
 *
 * A bare `scrollWidth > clientWidth` assertion says the page overflows and
 * nothing else, which is close to useless when the failure only happens on an
 * engine you cannot run locally: scrollbar width and system fonts both differ
 * between macOS and the Linux runners, and both change the answer. This reports
 * every element extending past the viewport, so the next failure names itself
 * instead of costing three rounds of guessing.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth;
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll("*"))) {
      const box = element.getBoundingClientRect();
      if (box.right > limit + 1) {
        const label =
          element.getAttribute("data-testid") ??
          (typeof element.className === "string" && element.className !== ""
            ? element.className
            : element.tagName);
        offenders.push(
          `${String(label).slice(0, 60)} right=${Math.round(box.right)} width=${Math.round(box.width)}`,
        );
      }
    }
    return { overflow: root.scrollWidth - limit, limit, offenders: offenders.slice(0, 8) };
  });

  expect(
    report.overflow,
    `viewport ${report.limit}px, overflow ${report.overflow}px, offenders:\n${report.offenders.join("\n")}`,
  ).toBeLessThanOrEqual(1);
}

/**
 * Opens a second signed-in device (feature 006).
 *
 * The shared fixture seeds a session cookie onto the *test's* context, so a
 * context created inside a test would land on the sign-in page and every
 * multi-device journey would fail as an authentication problem. This mints a
 * second session and seeds it, which is also what a second device genuinely is:
 * its own session against the same owner.
 *
 * It is a *distinct* device row, not a second session on the seeded one. Two
 * contexts sharing one device cannot be told apart, so a journey that revokes
 * "the other device" would revoke the one it is watching from.
 *
 * The caller closes the context. Returning it rather than a page makes that
 * ownership obvious — a leaked context holds a browser alive for the whole run.
 */
export async function openSecondDevice(
  browser: Browser,
  baseURL: string | undefined,
  name = "Second end-to-end device",
): Promise<{ context: BrowserContext; page: Page; deviceId: string | null }> {
  const context = await browser.newContext();
  const seeded = await seedSessionOnNewDevice(name);
  if (seeded !== null && baseURL !== undefined) {
    await context.addCookies([
      {
        name: "mn_dev_session",
        value: seeded.secret,
        url: baseURL,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
  }
  const page = await context.newPage();
  return { context, page, deviceId: seeded?.deviceId ?? null };
}

/**
 * Waits until the open document is durably saved on this device.
 *
 * The editor autosaves: every gesture is committed encrypted to IndexedDB
 * before the interface acknowledges it, so there is no save button to click.
 * A journey that types and then synchronizes is a journey that measures
 * nothing unless it first waits for durability — and durability here means the
 * local commit, not a network round-trip. Waiting for the status line rather
 * than for a timeout is what makes the following assertions about the *saved*
 * document.
 *
 * The compatibility path (a page that cannot open a session) still shows the
 * legacy button; both roads end at "the words are safe", which is what the
 * caller cares about.
 */
export async function saveDocument(
  page: Page,
  options: { readonly until?: "durable" | "synced" } = {},
): Promise<void> {
  const status = page.getByTestId("editor-sync-status");
  const legacySave = page.getByTestId("save-document");
  // Selecting or reloading a page first renders a loading boundary. Counting
  // controls in that instant used to mistake a not-yet-mounted operational
  // editor for the legacy form, then wait forever for a save button that would
  // never exist on slower Firefox runs. Wait until one editing path has
  // actually declared itself before choosing it.
  await expect
    .poll(async () => (await status.count()) > 0 || (await legacySave.count()) > 0, {
      timeout: 30_000,
      message: "the page did not expose an operational status or a legacy save control",
    })
    .toBe(true);
  if (await status.count()) {
    await waitForEditorSettled(page);
    await expect(status).not.toHaveAttribute("data-state", "local-saving", { timeout: 15_000 });
    await expect(status).toHaveAttribute("data-durable", "true", { timeout: 15_000 });
    if (options.until === "synced") {
      // The transport state, not the user-facing kind: an open ambiguity wraps
      // the kind as « attention » while the frontier itself is confirmed.
      await expect(status).toHaveAttribute("data-sync", "synced", { timeout: 20_000 });
    }
    return;
  }
  await legacySave.click();
  await expect(page.getByTestId("document-saved")).toBeVisible({ timeout: 15_000 });
}

/**
 * Selects a page after its operational editor has finished activating.
 *
 * Use this for journeys that immediately interact with a sibling page surface
 * such as attachments. Activation refreshes the selected item; on a constrained
 * browser that refresh can otherwise land between pointer-down and pointer-up,
 * so the browser completes the gesture against two different layouts and React
 * receives no click.
 */
export async function selectSettledPage(page: Page, name: string): Promise<void> {
  await selectItem(page, name);
  await saveDocument(page, { until: "synced" });
}

/**
 * Where the API this run is talking to actually lives.
 *
 * A journey that needs to act as "another device" goes straight to the API
 * rather than through the browser, and until now each one wrote
 * `http://127.0.0.1:3001` itself. That was already fragile — a dev server from
 * another checkout on 3001 made those journeys silently exercise foreign code —
 * and it becomes wrong outright once the local matrix runs several stacks at
 * once, each on its own port: the request would land on another project's API,
 * or on nothing at all.
 *
 * Derived from the same variable the Playwright config gives the server, so the
 * two cannot disagree.
 */
export function apiOrigin(): string {
  return `http://127.0.0.1:${process.env["MYOWNNOTION_API_PORT"] ?? "3001"}`;
}
