/**
 * First launch (feature 058, US1) and passkey sign-in per account (US2).
 *
 * One form creates the administrator — email, pseudonym, password — and the
 * workspace opens. A passkey is offered and can be skipped. Once an
 * administrator exists, the setup screen is gone for everyone.
 *
 * **Passkey ceremonies need a virtual authenticator, which only Chromium
 * exposes through CDP.** Those journeys skip on Firefox and WebKit.
 */

import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { readCommittedCounts, resetSecurityInstallation } from "./reset-installation.ts";

test.beforeEach(async () => {
  await resetSecurityInstallation();
});

const PASSWORD = "acceptable passphrase for e2e";

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

async function fillAdministrator(page: Page, email = "admin@e2e.test"): Promise<void> {
  await expect(page.getByTestId("bootstrap-form")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("bootstrap-email").fill(email);
  await page.getByTestId("bootstrap-pseudonym").fill("Admin");
  await page.getByTestId("bootstrap-password").fill(PASSWORD);
  await page.getByTestId("bootstrap-password-confirm").fill(PASSWORD);
  await page.getByTestId("bootstrap-submit").click();
}

/** The passkey offer appears where WebAuthn exists; other browsers go straight on. */
async function skipPasskeyOffer(page: Page): Promise<void> {
  const skip = page.getByTestId("bootstrap-skip-passkey");
  const workspace = page.getByTestId("workspace-shell");
  await expect(skip.or(workspace)).toBeVisible({ timeout: 30_000 });
  if (await skip.isVisible()) await skip.click();
}

async function signOut(page: Page): Promise<void> {
  const csrfToken = await page.evaluate(async () => {
    const response = await fetch("/v1/auth/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`session request failed: ${response.status}`);
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  });
  await page.evaluate(async (csrf) => {
    const response = await fetch("/v1/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrf },
    });
    if (!response.ok) throw new Error(`sign-out failed: ${response.status}`);
  }, csrfToken);
  await page.reload();
}

test.describe("first launch", () => {
  test("offers only the administrator form on a fresh installation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("bootstrap-form")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("bootstrap-submit")).toBeDisabled();
    if (process.env["MYOWNNOTION_058_EVIDENCE"] === "1")
      await page.screenshot({
        path: `specs/064-multi-user-accounts/evidence/setup-${test.info().project.name}.png`,
        fullPage: true,
      });
    await expect(page.getByTestId("workspace-shell")).toHaveCount(0);
    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  test("creates the administrator in under two minutes and opens the workspace", async ({
    page,
  }) => {
    const started = Date.now();
    await page.goto("/");
    await fillAdministrator(page);
    await skipPasskeyOffer(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    // SC-001: first launch completes well under two minutes.
    expect(Date.now() - started).toBeLessThan(120_000);
    expect(await readCommittedCounts()).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  test("never shows the setup screen once an administrator exists", async ({ page }) => {
    await page.goto("/");
    await fillAdministrator(page);
    await skipPasskeyOffer(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    await signOut(page);
    await page.goto("/setup");
    await expect(page.getByTestId("bootstrap-form")).toHaveCount(0);
    await expect(
      page.getByTestId("email-input").or(page.getByTestId("sign-in-passkey")),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("passkeys per account", () => {
  test("adds a passkey at first launch and signs in with it alone", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "virtual authenticators are a Chromium CDP feature");
    await attachAuthenticator(page);
    await page.goto("/");
    await fillAdministrator(page);
    await page.getByTestId("bootstrap-add-passkey").click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });

    await signOut(page);
    await page.getByTestId("sign-in-passkey").click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
  });

  test("signs in with email and password after first launch", async ({ page }) => {
    await page.goto("/");
    await fillAdministrator(page, "Admin.Mixed@E2E.test");
    await skipPasskeyOffer(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    await signOut(page);
    const usePassword = page.getByTestId("use-password-instead");
    await expect(usePassword.or(page.getByTestId("email-input"))).toBeVisible({ timeout: 30_000 });
    if (await usePassword.isVisible()) await usePassword.click();
    // Emails are case-insensitive identifiers.
    await page.getByTestId("email-input").fill("admin.mixed@e2e.test");
    await page.getByTestId("password-input").fill(PASSWORD);
    await page.getByTestId("sign-in-password").click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
  });
});
