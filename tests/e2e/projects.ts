/**
 * The browser matrix, named once.
 *
 * Both `playwright.config.ts` and the local parallel runner need this list, and
 * they need to agree: the runner allocates one isolated stack — database, ports,
 * blob root — per entry, and a project the runner does not know about would be
 * launched against another project's stack. Two copies of a list are two copies
 * that drift, and this one drifts silently.
 */

export interface BrowserProject {
  readonly name: string;
  /** A Playwright device descriptor name. */
  readonly device: string;
  /**
   * Whether Playwright's patched Firefox can run on the host on macOS.
   *
   * It cannot: it hangs before opening a page on the macOS development runtime,
   * so that project runs inside the pinned Linux image instead. Recorded here
   * rather than as a name check in the runner, so the reason travels with the
   * fact.
   */
  readonly containerOnMac?: boolean;
}

export const BROWSER_PROJECTS: readonly BrowserProject[] = [
  { name: "chromium-desktop", device: "Desktop Chrome" },
  { name: "firefox-desktop", device: "Desktop Firefox", containerOnMac: true },
  { name: "webkit-desktop", device: "Desktop Safari" },
  { name: "chromium-mobile", device: "Pixel 7" },
  { name: "webkit-mobile", device: "iPhone 14" },
];
