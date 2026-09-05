import { test } from "@playwright/test";

/** Desktop Electron journeys stay out of the browser matrix unless explicitly requested. */
export function applyDesktopJourneySkip(): void {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      process.env["MYOWNNOTION_DESKTOP_E2E"] !== "1",
      "Requires MYOWNNOTION_DESKTOP_E2E=1 on a native desktop runner.",
    );
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Desktop Electron journeys run once on chromium-desktop.",
    );
  });
}
