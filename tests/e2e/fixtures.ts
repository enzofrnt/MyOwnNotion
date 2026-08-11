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

export const test = base.extend<{ freshContent: null }>({
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
