/**
 * First-run bootstrap journeys (T028, feature 002).
 *
 * These are the only journeys that must start from an installation with no
 * owner, so they do not use the shared fixture — that one seeds an owner so
 * content journeys have a workspace to open. Here the `0/0` → `1/1` transition
 * is the subject, and it has to be observed from both sides: what the page
 * shows, and what the database committed.
 *
 * **The ceremony needs a virtual authenticator, which only Chromium exposes
 * through CDP.** The journeys that drive a real passkey therefore skip on
 * Firefox and WebKit. The journeys that do not need a credential — the gate,
 * the counts, the concurrent claim, keyboard reachability, the outage message
 * — run on the whole matrix, because those are exactly the parts where a
 * rendering or focus difference between engines would matter.
 */

import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { readCommittedCounts, resetSecurityInstallation } from "./reset-installation.ts";

/**
 * Restarting from `0/0` before each journey.
 *
 * The API creates the installation row at startup, so truncating it leaves no
 * row at all until the next request — which is itself a state the status route
 * must answer for, and the first assertion below relies on it.
 */
test.beforeEach(async () => {
  await resetSecurityInstallation();
});

/** Installs a virtual authenticator that auto-approves user verification. */
async function attachAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable", { enableUI: false });
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return client;
}

test.describe("the first-run gate", () => {
  test("an installation with no owner shows setup, not the workspace", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("begin-setup")).toBeVisible();
    // The workspace must not be rendered behind it: there is nothing there to
    // show, and showing it would suggest content exists that the security
    // layer has not been asked to protect.
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toHaveCount(0);
  });

  test("the page states the committed counts, and they are zero", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("owner-count")).toHaveText("0");
    await expect(page.getByTestId("workspace-count")).toHaveText("0");
    // And the database agrees. A page that renders 0 while the database holds
    // an owner is the regression this pair of assertions exists to catch.
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  test("setup is reachable and operable from the keyboard alone", async ({ page }) => {
    await page.goto("/");
    const begin = page.getByTestId("begin-setup");
    await expect(begin).toBeVisible();
    await begin.focus();
    await expect(begin).toBeFocused();
  });

  test("the heading structure is navigable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up this installation");
    await expect(
      page.getByRole("heading", { level: 2, name: "Create the owner passkey" }),
    ).toBeVisible();
  });
});

test.describe("the full ceremony", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "a virtual authenticator is only available through Chromium's CDP",
    );
  });

  test("a fresh install reaches 1/1, and only at the confirmation", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");

    await page.getByTestId("begin-setup").click();

    // The kit panel is the proof the credential was accepted.
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    // Still nobody owns anything: a credential is not an owner.
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
    await expect(page.getByTestId("owner-count")).toHaveText("0");

    const download = page.waitForEvent("download");
    await page.getByTestId("download-recovery-kit").click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toBe("myownnotion-recovery.json");

    // Downloading is not confirming either.
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });

    await page.getByTestId("acknowledge-offline-storage").check();
    await page.getByTestId("confirm-offline-storage").click();

    // The workspace itself is the confirmation: the shell swaps to it the
    // moment an owner exists, which is a stronger assertion than a panel
    // saying so.
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible({
      timeout: 30_000,
    });
    expect(await readCommittedCounts()).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  test("confirmation stays refused until the kit has actually been downloaded", async ({
    page,
  }) => {
    // The failure this guards against is an owner who finishes setup with no
    // kit they can reach — which is unrecoverable, unlike every other way
    // setup can go wrong.
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("acknowledge-offline-storage")).toBeDisabled();
    await expect(page.getByTestId("confirm-offline-storage")).toBeDisabled();
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  test("acknowledging is a separate act from confirming", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    const download = page.waitForEvent("download");
    await page.getByTestId("download-recovery-kit").click();
    await download;

    // Downloaded, but not yet acknowledged: still refused.
    await expect(page.getByTestId("confirm-offline-storage")).toBeDisabled();
    await page.getByTestId("acknowledge-offline-storage").check();
    await expect(page.getByTestId("confirm-offline-storage")).toBeEnabled();
  });

  test("the download is one-time, and the page says what to do instead", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    const download = page.waitForEvent("download");
    await page.getByTestId("download-recovery-kit").click();
    await download;

    await expect(page.getByTestId("download-consumed-note")).toBeVisible();
    await expect(page.getByTestId("download-recovery-kit")).toBeDisabled();
    // Regeneration stays available: an owner whose file did not save must have
    // a way forward that is not "start over".
    await expect(page.getByTestId("regenerate-recovery-kit")).toBeEnabled();
  });

  test("a regenerated kit replaces the old one and is downloadable again", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });
    const firstKit = await page.getByTestId("recovery-kit-id").textContent();

    const download = page.waitForEvent("download");
    await page.getByTestId("download-recovery-kit").click();
    await download;

    await page.getByTestId("regenerate-recovery-kit").click();
    await expect(page.getByTestId("recovery-kit-id")).not.toHaveText(firstKit ?? "", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("download-recovery-kit")).toBeEnabled();
    // Regeneration is still not a commitment.
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  test("an interrupted attempt commits nothing and can be restarted", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    // A reload is the ordinary interruption: a closed laptop, a refresh, a
    // crash. The capability lives in memory only, so it is gone.
    await page.reload();

    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
    // And the page offers the way forward rather than a dead end.
    await expect(page.getByTestId("begin-setup")).toBeVisible({ timeout: 30_000 });
  });

  test("once ownership commits, the workspace replaces setup on reload", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });
    const download = page.waitForEvent("download");
    await page.getByTestId("download-recovery-kit").click();
    await download;
    await page.getByTestId("acknowledge-offline-storage").check();
    await page.getByTestId("confirm-offline-storage").click();
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: "MyOwnNotion" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("begin-setup")).toHaveCount(0);
  });

  test("a second browser cannot claim an attempt that is already open", async ({
    page,
    context,
  }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("recovery-kit-id")).toBeVisible({ timeout: 30_000 });

    const second = await context.newPage();
    await second.goto("/");
    await second.getByTestId("begin-setup").click();

    // It is told what is happening, not shown a generic error.
    await expect(second.getByTestId("bootstrap-message")).toContainText("Another browser", {
      timeout: 30_000,
    });
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
    await second.close();
  });
});

test.describe("responsive and assistive presentation", () => {
  test("the setup call to action is reachable without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    const begin = page.getByTestId("begin-setup");
    await expect(begin).toBeVisible();
    const box = await begin.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });

  test("outcomes are announced through one polite live region", async ({ page }) => {
    // One region, so a screen reader hears each outcome once and in order
    // rather than fielding competing announcements.
    await page.goto("/");
    const region = page.getByTestId("bootstrap-message");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).toHaveAttribute("role", "status");
    await expect(page.locator("[aria-live]")).toHaveCount(1);
  });
});
