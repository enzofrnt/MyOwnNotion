/**
 * Trusting the connection (T069, US5, FR-023, FR-024).
 *
 * The default single-installation path works without any of this, which is
 * exactly why it matters: it becomes load-bearing at the moment someone moves
 * to a real deployment, and getting it wrong there is a security problem rather
 * than an inconvenience.
 *
 * The tests run against the local server, so the *presence* of the insecure
 * warning cannot be exercised end to end here — loopback is a secure context
 * and warning about it would be wrong. What is asserted end to end is the half
 * that can be: the panel reports the server it is talking to and whether that
 * server is reachable. The rule deciding when to warn is a pure function and is
 * tested directly, over the cases a journey cannot reach.
 */

import { expect, test } from "./fixtures.ts";
import { openSettings, openWorkspace } from "./helpers.ts";

async function openConnectionPanel(page: import("@playwright/test").Page): Promise<void> {
  await openWorkspace(page);
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Connexion", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("what the owner is told about the connection", () => {
  test("names the server it is talking to", async ({ page }) => {
    // An owner with more than one installation — a laptop and a server — needs
    // to know which one they are about to write into.
    await openConnectionPanel(page);
    // The host as the browser sees it, whatever the harness dialled — asserting
    // a specific address would pin the test to how the suite happens to be
    // started rather than to what the panel promises.
    await expect(page.getByTestId("connection-server")).toContainText(/localhost|127\.0\.0\.1/);
  });

  test("says whether the server is reachable", async ({ page }) => {
    await openConnectionPanel(page);
    await expect(page.getByTestId("connection-reachability")).toHaveAttribute(
      "data-state",
      "reachable",
      { timeout: 30_000 },
    );
  });

  test("says the work is kept locally when the server is gone", async ({ page }) => {
    // The reassurance that matters at that moment: unreachable is not lost.
    await page.route("**/health", (route) => route.abort("connectionrefused"));
    await openConnectionPanel(page);

    await expect(page.getByTestId("connection-reachability")).toHaveAttribute(
      "data-state",
      "unreachable",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("connection-reachability")).toContainText(
      /reste sur cet appareil/i,
    );
  });

  test("does not warn about the supported local default", async ({ page }) => {
    // The product ships publishing local HTTP and expects a reverse proxy for
    // anything public. Warning on the supported default is how an owner learns
    // to ignore the warning that matters.
    await openConnectionPanel(page);
    await expect(page.getByTestId("insecure-channel")).toBeHidden();
  });
});
