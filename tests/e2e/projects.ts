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
   * Whether this Playwright engine must use the pinned Linux image on macOS.
   *
   * Patched Firefox hangs before opening a page there. Patched WebKit can enter
   * an internal WebLoaderStrategy failure after a long corpus and strand later
   * contexts. Recorded here rather than as name checks in the runner, so the
   * runtime decision stays aligned with the matrix declaration.
   */
  readonly containerOnMac?: boolean;
}

export const BROWSER_PROJECTS: readonly BrowserProject[] = [
  { name: "chromium-desktop", device: "Desktop Chrome" },
  { name: "firefox-desktop", device: "Desktop Firefox", containerOnMac: true },
  { name: "webkit-desktop", device: "Desktop Safari", containerOnMac: true },
  { name: "chromium-mobile", device: "Pixel 7" },
  { name: "webkit-mobile", device: "iPhone 14", containerOnMac: true },
];
