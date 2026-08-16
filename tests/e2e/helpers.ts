/**
 * Shared Playwright helpers: unique names per run and common journeys.
 *
 * The security section at the bottom adds the virtual-authenticator, mounted
 * secret, and readiness helpers the feature-002 journeys need (T003).
 */
import { expect, type Page } from "@playwright/test";

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
  // The same 15-second budget `createChildItem` already uses, and for the same
  // reason. These two helpers do the same work, but only the child one was
  // hardened when it last flaked; this one kept Playwright's 5-second default
  // and went on failing intermittently on WebKit, which is slow enough to
  // exceed it under a loaded CI runner. Two identical waits with different
  // budgets is not a policy, it is an oversight that took two red runs on
  // `main` to surface.
  await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
}

export async function createChildItem(
  page: Page,
  parentName: string,
  kind: "page" | "folder",
  name: string,
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(name);
  // No explicit `scrollIntoViewIfNeeded`: `click()` already scrolls, and it
  // retries when the element is replaced. The explicit call was the only step
  // here that does not retry, so a re-render landing between resolving the
  // locator and scrolling it detached the element and failed the journey —
  // intermittently, which is the worst way for it to fail.
  await page.getByRole("button", { name: `New ${kind} inside ${parentName}` }).click();
  await expect(page.getByTestId(`tree-item-${name}`)).toBeVisible({ timeout: 15_000 });
}

/** Selects a tree item by clicking its name (never the action buttons). */
export async function selectItem(page: Page, name: string): Promise<void> {
  await page.getByTestId(`tree-item-${name}`).locator(".tree-name").click();
  await expect(page.getByTestId(`tree-item-${name}`)).toHaveAttribute("aria-selected", "true", {
    timeout: 15_000,
  });
}

export async function waitForSynchronized(page: Page): Promise<void> {
  // The queue must drain (no pending/conflict rows) and the state settle.
  await expect(page.getByTestId("mutation-status-empty")).toBeVisible({ timeout: 20_000 });
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
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  const surface = page.getByTestId("block-editor").locator(".ProseMirror");
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await surface.pressSequentially(text);
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
