/**
 * Shared end-to-end test fixture (T106).
 *
 * Every journey starts from empty canonical content. Playwright's project
 * `dependencies` cannot provide this: it runs all dependency projects up front
 * rather than immediately before each dependent project, so content still
 * accumulated across the matrix. An auto fixture resets before each test
 * instead, which keeps the tree at a handful of items regardless of how many
 * projects or journeys exist.
 *
 * Import `test` and `expect` from here rather than from `@playwright/test` so a
 * new journey cannot silently opt out of the reset.
 */
import { test as base } from "@playwright/test";
import { resetCanonicalContent } from "./reset-content.ts";
import { seedCommittedOwner } from "./reset-installation.ts";

export const test = base.extend<{ freshContent: null }>({
  freshContent: [
    // Playwright inspects the destructuring pattern to discover a fixture's
    // dependencies and rejects any other first-argument form ("First argument
    // must use the object destructuring pattern"). This fixture depends on none.
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright, see above
    async ({}, use) => {
      await resetCanonicalContent();
      // The application shows the first-run page until an owner exists, so a
      // content journey needs one. It is seeded directly rather than through
      // the ceremony: the passkey ceremony needs a virtual authenticator that
      // only Chromium exposes, and driving it here would cut the browser
      // matrix down to one engine for every journey in the suite. The
      // bootstrap journeys reset back to `0/0` and drive the real flow.
      await seedCommittedOwner();
      await use(null);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
