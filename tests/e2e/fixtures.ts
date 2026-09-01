/**
 * Shared end-to-end test fixture (T106, extended by T003 and T047).
 *
 * Every journey starts from empty canonical content, an installation that has
 * an owner, and a signed-in browser. Playwright's project `dependencies`
 * cannot provide this: it runs all dependency projects up front rather than
 * immediately before each dependent project, so content still accumulated
 * across the matrix. An auto fixture resets before each test instead, which
 * keeps the tree at a handful of items regardless of how many projects or
 * journeys exist.
 *
 * Import `test` and `expect` from here rather than from `@playwright/test` so a
 * new journey cannot silently opt out of the reset.
 */
import { test as base } from "@playwright/test";
import { BROWSER_PROJECTS } from "./projects.ts";
import { resetCanonicalContent } from "./reset-content.ts";
import { seedCommittedOwner, seedSession } from "./reset-installation.ts";

/**
 * Refuses engines that require the pinned Linux runtime on a macOS host,
 * before a browser is launched.
 *
 * Playwright's patched Firefox hangs before opening a page on the macOS
 * development runtime. Patched WebKit can fail internally after a long corpus,
 * leaving later page loads and context teardown to time out. Both failures
 * describe the host runtime rather than the application, so the local matrix
 * runs those projects in the same pinned Linux image used by CI instead.
 *
 * Refused here rather than by leaving the project out of the config: the project
 * list must be the same on every platform, or "CI runs all five" stops being
 * checkable from a developer machine — and a contract test checks it.
 *
 * Inside the pinned Linux image the platform is Linux, so nothing is refused,
 * which is the whole point.
 */
function assertBrowserRunsHere(projectName: string): void {
  const project = BROWSER_PROJECTS.find((candidate) => candidate.name === projectName);
  if (project?.containerOnMac === true && process.platform === "darwin") {
    throw new Error(
      `${projectName} cannot run reliably in Playwright's macOS runtime. Run \`bun run test:e2e:local -- --project=${projectName}\` (which routes it to the pinned Linux image) or \`bun run test:e2e:browser-container -- --project=${projectName}\` to run it alone.`,
    );
  }
}

interface FreshContentState {
  readonly cookies: Array<{
    readonly name: string;
    readonly value: string;
    readonly domain: string;
    readonly path: string;
    readonly expires: number;
    readonly httpOnly: boolean;
    readonly secure: boolean;
    readonly sameSite: "Strict";
  }>;
  readonly origins: [];
}

export const test = base.extend<{ runnableHere: null; freshContent: FreshContentState }>({
  /**
   * Declared before `freshContent`, and depending on nothing.
   *
   * Fixture order is what makes this work. Playwright creates a fixture's
   * dependencies before the fixture itself, so a guard that asked for `context`
   * would launch the browser it is trying to prevent — which is exactly what the
   * first attempt did, and it hung for four hundred seconds before being killed.
   * This one takes only `testInfo`, so it runs and throws while the browser is
   * still unrequested.
   *
   * The empty destructuring pattern is how Playwright is told a fixture depends
   * on nothing: it reads the destructured names to resolve dependencies, so a
   * plain parameter would request the whole fixture object — `context` included,
   * which is the browser this guard exists to keep from launching.
   */
  runnableHere: [
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright to declare no fixture dependencies; see above.
    async ({}, use, testInfo) => {
      assertBrowserRunsHere(testInfo.project.name);
      await use(null);
    },
    { auto: true },
  ],
  freshContent: [
    async ({ baseURL }, use) => {
      // Reset and seed before Playwright creates a browser context. Making the
      // reset depend on `context` placed database setup behind WebKit's process
      // lifecycle; a stalled engine then surfaced as a two-minute
      // "freshContent" timeout even though the test body never started.
      await base.step("reset canonical content", resetCanonicalContent);
      // The application shows the first-run page until an owner exists, and
      // the sign-in page until this browser holds a session. Both are seeded
      // directly rather than driven through the UI: the passkey ceremony needs
      // a virtual authenticator that only Chromium exposes, and putting a
      // sign-in in front of every content journey would make an authentication
      // regression look like a hierarchy failure in thirty places at once.
      // The real flows are exercised by bootstrap.spec.ts and
      // authentication.spec.ts.
      await base.step("seed committed owner", seedCommittedOwner);
      const secret = await base.step("seed signed-in session", seedSession);
      const url = baseURL === undefined ? undefined : new URL(baseURL);
      await use({
        cookies:
          secret === null || url === undefined
            ? []
            : [
                {
                  name: "mn_dev_session",
                  value: secret,
                  domain: url.hostname,
                  path: "/",
                  expires: -1,
                  httpOnly: true,
                  secure: url.protocol === "https:",
                  sameSite: "Strict",
                },
              ],
        origins: [],
      });
    },
    { auto: true },
  ],
  // The built-in context fixture consumes storageState, so this dependency
  // guarantees freshContent has completed before browser.newContext().
  storageState: async ({ freshContent }, use) => {
    await use(freshContent);
  },
});

export { expect } from "@playwright/test";
