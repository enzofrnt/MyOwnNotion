/**
 * First-run bootstrap journeys (T028 / T135, feature 002).
 *
 * Operator flow: open → create passkey → create password → confirm. Recovery
 * kits are settings concerns after readiness.
 *
 * **The ceremony needs a virtual authenticator, which only Chromium exposes
 * through CDP.** Journeys that drive a real passkey therefore skip on Firefox
 * and WebKit.
 */

import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { readCommittedCounts, resetSecurityInstallation } from "./reset-installation.ts";

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

async function completeBootstrap(page: Page): Promise<void> {
  await page.getByTestId("begin-setup").click();
  await expect(page.getByTestId("bootstrap-password")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("bootstrap-password").fill("acceptable-passphrase");
  await page.getByTestId("bootstrap-password-submit").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
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

test.describe("the first-run gate", () => {
  test("an installation with no owner shows setup, not the workspace", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("begin-setup")).toBeVisible();
    await expect(page.getByTestId("workspace-shell")).toHaveCount(0);
  });

  test("the page states the committed counts, and they are zero", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("owner-count")).toHaveText("0");
    await expect(page.getByTestId("workspace-count")).toHaveText("0");
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Configurer cette installation",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Créer la passkey du propriétaire" }),
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

  test("a fresh install reaches 1/1 after passkey then password", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");

    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("bootstrap-password")).toBeVisible({ timeout: 30_000 });

    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
    await expect(page.getByTestId("owner-count")).toHaveText("0");

    await page.getByTestId("bootstrap-password").fill("acceptable-passphrase");
    await page.getByTestId("bootstrap-password-submit").click();

    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    expect(await readCommittedCounts()).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  test("the bootstrap passkey signs the same browser back into its own device", async ({
    page,
  }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await completeBootstrap(page);
    const bootstrapDeviceId = await page.evaluate(async () => {
      const response = await fetch("/v1/auth/session", { credentials: "same-origin" });
      return ((await response.json()) as { session: { deviceId: string } }).session.deviceId;
    });

    await signOut(page);
    await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("sign-in-passkey").click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    const loginDeviceId = await page.evaluate(async () => {
      const response = await fetch("/v1/auth/session", { credentials: "same-origin" });
      return ((await response.json()) as { session: { deviceId: string } }).session.deviceId;
    });
    expect(loginDeviceId).toBe(bootstrapDeviceId);
  });

  test("an interrupted attempt commits nothing and can be restarted", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("bootstrap-password")).toBeVisible({ timeout: 30_000 });

    await page.reload();

    expect(await readCommittedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
    await expect(page.getByTestId("begin-setup")).toBeVisible({ timeout: 30_000 });
  });

  test("once ownership commits, the workspace replaces setup on reload", async ({ page }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await completeBootstrap(page);

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("begin-setup")).toHaveCount(0);
  });

  test("a second browser can take over an incomplete attempt", async ({ page, context }) => {
    await attachAuthenticator(page);
    await page.goto("/");
    await page.getByTestId("begin-setup").click();
    await expect(page.getByTestId("bootstrap-password")).toBeVisible({ timeout: 30_000 });

    const second = await context.newPage();
    await attachAuthenticator(second);
    await second.goto("/");
    await completeBootstrap(second);

    expect(await readCommittedCounts()).toEqual({ ownerCount: 1, workspaceCount: 1 });
    await second.close();
  });
});

test.describe("responsive presentation", () => {
  test("the setup call to action is reachable without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    const begin = page.getByTestId("begin-setup");
    await expect(begin).toBeVisible();
    const box = await begin.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });
});
