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
import { resetCanonicalContent } from "./reset-content.ts";
import { seedCommittedOwner, seedSession } from "./reset-installation.ts";

/**
 * Refuses a Firefox run on a macOS host, before a browser is launched.
 *
 * Playwright's patched Firefox hangs before opening a page on the macOS
 * development runtime, and the way it hangs is what makes this worth a guard: it
 * does not fail. It sits at 100% of a core until somebody notices, and one
 * forgotten instance burned more than twenty hours of CPU in a single day on a
 * laptop — slowing every other suite, including the ones with nothing to do with
 * it. A trap that expensive is closed where somebody steps in it, not in a
 * paragraph they read afterwards.
 *
 * Refused here rather than by leaving the project out of the config: the project
 * list must be the same on every platform, or "CI runs all five" stops being
 * checkable from a developer machine — and a contract test checks it.
 *
 * Inside the pinned Linux image the platform is Linux, so nothing is refused,
 * which is the whole point.
 */
function assertBrowserRunsHere(projectName: string): void {
  if (projectName === "firefox-desktop" && process.platform === "darwin") {
    throw new Error(
      "firefox-desktop cannot run on a macOS host: Playwright's Firefox hangs before opening a page and then burns a core indefinitely. Run `pnpm test:e2e:local` (which routes it to the pinned Linux image) or `pnpm test:e2e:firefox-container` to run it alone.",
    );
  }
}

export const test = base.extend<{ runnableHere: null; freshContent: null }>({
  /**
   * Declared before `freshContent`, and depending on nothing.
   *
   * Fixture order is what makes this work. Playwright creates a fixture's
   * dependencies before the fixture itself, so a guard that asked for `context`
   * would launch the browser it is trying to prevent — which is exactly what the
   * first attempt did, and it hung for four hundred seconds before being killed.
   * This one takes only `testInfo`, so it runs and throws while the browser is
   * still unrequested.
   */
  runnableHere: [
    async ({}, use, testInfo) => {
      assertBrowserRunsHere(testInfo.project.name);
      await use(null);
    },
    { auto: true },
  ],
  freshContent: [
    async ({ context, baseURL }, use) => {
      await resetCanonicalContent();
      // The application shows the first-run page until an owner exists, and
      // the sign-in page until this browser holds a session. Both are seeded
      // directly rather than driven through the UI: the passkey ceremony needs
      // a virtual authenticator that only Chromium exposes, and putting a
      // sign-in in front of every content journey would make an authentication
      // regression look like a hierarchy failure in thirty places at once.
      // The real flows are exercised by bootstrap.spec.ts and
      // authentication.spec.ts.
      await seedCommittedOwner();
      const secret = await seedSession();
      if (secret !== null && baseURL !== undefined) {
        await context.addCookies([
          {
            name: "mn_dev_session",
            value: secret,
            url: baseURL,
            httpOnly: true,
            sameSite: "Strict",
          },
        ]);
      }
      await use(null);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
