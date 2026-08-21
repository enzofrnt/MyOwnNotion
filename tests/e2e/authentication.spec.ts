/**
 * Authentication journeys (T041, feature 002).
 *
 * These do not use the shared fixture, because it signs the browser in and the
 * subject here is signing in. Each journey seeds an owner with a password and
 * then drives the real form.
 *
 * The passkey ceremony needs a virtual authenticator, which only Chromium
 * exposes; the password alternative is the credential these journeys use, and
 * everything downstream of the credential — the cookie, the session list,
 * revocation, the security screen — is identical whichever one opened the
 * session.
 */

import { randomBytes, scryptSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { ensureNavigationVisible } from "./helpers.ts";
import { resetCanonicalContent } from "./reset-content.ts";
import { resetSecurityInstallation, seedCommittedOwner } from "./reset-installation.ts";

const PASSWORD = "correct horse battery staple";

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

/**
 * Encodes a password in the stored format, at deliberately cheap parameters.
 *
 * A stored hash carries its own parameters and the server verifies against
 * those, so a fixture need not pay the production cost — which is 256 MB of
 * synchronous work per test, for nothing. Cheap parameters also exercise the
 * versioned-hash property rather than working around it: if verification ever
 * stopped reading the parameters from the row, every journey here would start
 * failing to sign in.
 *
 * The format is duplicated rather than imported because `apps/api` is not on
 * the end-to-end module path; a drift shows up immediately as a refused
 * sign-in, which is loud rather than silent.
 */
function encodePassword(password: string): string {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
  return [
    "scrypt",
    String(N),
    String(r),
    String(p),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

async function seedPassword(): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = rows[0]?.id;
    if (ownerId === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
       VALUES (gen_random_uuid(), $1, $2, 'scrypt', 'active')`,
      [ownerId, encodePassword(PASSWORD)],
    );
  } finally {
    await client.end();
  }
}

test.beforeEach(async () => {
  await resetSecurityInstallation();
  await resetCanonicalContent();
  await seedCommittedOwner();
  await seedPassword();
});

/**
 * Brings the sign-in page to its password form.
 *
 * A browser that supports passkeys opens on the passkey option and offers a
 * link to the password; one that does not — WebKit on Linux, for instance —
 * opens on the password form with no link at all. So the form is *checked
 * for* rather than the link being clicked speculatively.
 *
 * The obvious shortcut, `click().catch(() => {})`, is a trap: `click()` waits
 * for its locator until the test times out, so swallowing the rejection still
 * costs the full timeout on every browser where the link does not exist. That
 * is exactly how these journeys passed on macOS and took an hour to fail in
 * CI. `isVisible()` answers immediately.
 */
async function openPasswordForm(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  if (!(await page.getByTestId("password-input").isVisible())) {
    await page.getByTestId("use-password-instead").click();
  }
  await expect(page.getByTestId("password-input")).toBeVisible();
}

async function signIn(page: import("@playwright/test").Page, password = PASSWORD): Promise<void> {
  await page.goto("/");
  await openPasswordForm(page);
  await page.getByTestId("password-input").fill(password);
  await page.getByTestId("sign-in-password").click();
}

test.describe("the sign-in gate", () => {
  test("an owner with no session sees sign-in, not the workspace", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("workspace-shell")).toHaveCount(0);
  });

  test("offers the passkey first and the password as the alternative", async ({ page }) => {
    // The ordering is the recommendation. Presenting them as equals would nudge
    // owners towards the weaker credential.
    await page.goto("/");
    // The shell resolves its state asynchronously; inspecting before it
    // settles reads the loading placeholder rather than the sign-in page.
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

    const passkeyHeading = page.getByRole("heading", { name: "Use your passkey" });
    const passwordLink = page.getByTestId("use-password-instead");
    if (await passkeyHeading.isVisible()) {
      await expect(passwordLink).toBeVisible();
    } else {
      // A browser without passkey support goes straight to the password form
      // and says why, rather than offering a button that cannot work.
      await expect(page.getByTestId("password-input")).toBeVisible();
    }
  });

  test("a browser without passkey support opens on the password form", async ({ page }) => {
    // Not hypothetical: WebKit on Linux exposes no `PublicKeyCredential`, and
    // this branch of the sign-in page was written for it but exercised by
    // nothing — every journey ran on browsers that do support passkeys, so a
    // helper that waited for a link this page never renders passed locally and
    // timed out sixteen times in CI. Removing the API here covers the branch
    // on every browser in the matrix.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "PublicKeyCredential");
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

    // Straight to the password, with no link to a passkey option that could
    // not work, and a note saying why.
    await expect(page.getByTestId("password-input")).toBeVisible();
    await expect(page.getByTestId("use-password-instead")).toHaveCount(0);
    await expect(page.getByTestId("use-passkey-instead")).toHaveCount(0);
    await expect(page.getByText("cannot use passkeys")).toBeVisible();
  });

  test("signing in still works without passkey support", async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "PublicKeyCredential");
    });
    await page.goto("/");
    await openPasswordForm(page);
    await page.getByTestId("password-input").fill(PASSWORD);
    await page.getByTestId("sign-in-password").click();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("the password field is reachable and operable from the keyboard", async ({ page }) => {
    await page.goto("/");
    await openPasswordForm(page);
    const input = page.getByTestId("password-input");
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.type("something");
    await expect(input).toHaveValue("something");
  });
});

test.describe("signing in", () => {
  test("a correct password opens the workspace", async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a wrong password says what to do, not what was wrong", async ({ page }) => {
    await signIn(page, "not the right passphrase");
    const message = page.getByTestId("login-message");
    await expect(message).toContainText("did not work", { timeout: 30_000 });
    // Nothing that would tell an attacker which half of the guess was right.
    await expect(message).not.toContainText("password is");
    await expect(message).not.toContainText("no account");
    await expect(page.getByTestId("workspace-shell")).toHaveCount(0);
  });

  test("clears the field after a failure", async ({ page }) => {
    // A failed attempt must not leave the password sitting in a form field for
    // the next person at the machine.
    await signIn(page, "not the right passphrase");
    await expect(page.getByTestId("login-message")).toContainText("did not work", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("password-input")).toHaveValue("");
  });

  test("the session survives a reload", async ({ page }) => {
    // The cookie outlives the page; only the CSRF token has to be fetched
    // again, and the shell does that on load.
    await signIn(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 30_000,
    });
    // The heading is the authentication gate, not the end of workspace boot.
    // Reloading while WebKit is still resolving the worker/module graph cancels
    // those requests and can make the replacement document fail its own module
    // loads with an internal browser error. Wait for the local projection to
    // render: that is the first state in which the signed-in workspace is
    // actually ready for an owner to use or reload.
    await ensureNavigationVisible(page);
    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 30_000,
    });
    await ensureNavigationVisible(page);
  });

  test("the session cookie is not readable from JavaScript", async ({ page }) => {
    // HttpOnly holds even under the loopback exception: the exception relaxes
    // transport, not script access.
    await signIn(page);
    await expect(page.getByTestId("workspace-shell")).toBeVisible({
      timeout: 30_000,
    });
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("mn_dev_session");
  });
});

test.describe("the security screen", () => {
  test("lists this browser's session and marks it", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByTestId("session-list")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("current-session")).toBeVisible();
  });

  test("states plainly that there is no password reset", async ({ page }) => {
    // An owner deciding whether to set a password deserves to know this before
    // they choose it, not after they forget it.
    await signIn(page);
    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByTestId("no-reset-warning")).toContainText("no password reset", {
      timeout: 30_000,
    });
  });

  test("signing out returns to the sign-in page", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByTestId("session-list")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("revoke-session").first().click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  });

  test("a signed-out session does not come back on reload", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByTestId("session-list")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("revoke-session").first().click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  });

  test("offers no way to sign out elsewhere when this is the only session", async ({ page }) => {
    // A control that always succeeds by doing nothing teaches the owner to
    // distrust it.
    await signIn(page);
    await page.getByTestId("toggle-security-settings").click();
    await expect(page.getByTestId("session-list")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("revoke-other-sessions")).toBeDisabled();
  });
});

test.describe("responsive and assistive presentation", () => {
  test("the sign-in control fits the viewport without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    await openPasswordForm(page);
    const button = page.getByTestId("sign-in-password");
    const box = await button.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });

  test("outcomes are announced through one polite live region", async ({ page }) => {
    await page.goto("/");
    const region = page.getByTestId("login-message");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).toHaveAttribute("role", "status");
    await expect(page.locator("[aria-live]")).toHaveCount(1);
  });

  test("the heading structure is navigable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });
});
