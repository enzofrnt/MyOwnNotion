/**
 * Several accounts on one installation (feature 058, quickstart journeys 3–8).
 *
 * Each journey starts from a fresh installation: the administrator is created
 * through first launch, then people arrive the three ways the administrator
 * allows — created by the administrator, through a private link, or by open
 * sign-up. Every account's notes stay its own.
 */

import { type Browser, expect, type Page, test } from "@playwright/test";
import { createRootItem, openSettingsSection, uniqueName } from "./helpers.ts";
import { resetSecurityInstallation } from "./reset-installation.ts";

const PASSWORD = "acceptable passphrase for e2e";

/**
 * Visual evidence for the feature artifacts (ui-quality gate), only when asked:
 * `MYOWNNOTION_058_EVIDENCE=1`. One file per surface and browser project.
 */
async function evidence(page: Page, surface: string): Promise<void> {
  if (process.env["MYOWNNOTION_058_EVIDENCE"] !== "1") return;
  await page.screenshot({
    path: `specs/064-multi-user-accounts/evidence/${surface}-${test.info().project.name}.png`,
    fullPage: true,
  });
}

test.beforeEach(async () => {
  await resetSecurityInstallation();
});

async function skipPasskeyOffer(page: Page, testId: string): Promise<void> {
  const skip = page.getByTestId(testId);
  const workspace = page.getByTestId("workspace-shell");
  await expect(skip.or(workspace)).toBeVisible({ timeout: 30_000 });
  if (await skip.isVisible()) await skip.click();
  await expect(workspace).toBeVisible({ timeout: 30_000 });
}

async function createAdministrator(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("bootstrap-form")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("bootstrap-email").fill("admin@e2e.test");
  await page.getByTestId("bootstrap-pseudonym").fill("Admin");
  await page.getByTestId("bootstrap-password").fill(PASSWORD);
  await page.getByTestId("bootstrap-password-confirm").fill(PASSWORD);
  await page.getByTestId("bootstrap-submit").click();
  await skipPasskeyOffer(page, "bootstrap-skip-passkey");
}

/** A second person, in a browser profile of their own. */
async function newPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return await context.newPage();
}

/** The sign-in page opens on the passkey option where WebAuthn exists. */
async function openPasswordForm(page: Page): Promise<void> {
  const usePassword = page.getByTestId("use-password-instead");
  const email = page.getByTestId("email-input");
  await expect(usePassword.or(email)).toBeVisible({ timeout: 30_000 });
  if (await usePassword.isVisible()) await usePassword.click();
  await expect(email).toBeVisible();
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await openPasswordForm(page);
  await page.getByTestId("email-input").fill(email);
  await page.getByTestId("password-input").fill(PASSWORD);
  await page.getByTestId("sign-in-password").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 30_000 });
}

async function setRegistrationMode(page: Page, mode: "closed" | "invitation" | "open") {
  await openSettingsSection(page, "administration");
  await page.getByTestId(`registration-mode-${mode}`).check();
  await expect(page.getByTestId("administration-message")).toBeVisible({ timeout: 15_000 });
}

test("the administrator creates an account whose holder sees only their own space", async ({
  page,
  browser,
}) => {
  await createAdministrator(page);
  const secret = uniqueName("admin-secret");
  await createRootItem(page, "page", secret);

  await openSettingsSection(page, "administration");
  await page.getByTestId("create-account").click();
  await page.getByTestId("new-account-email").fill("bea@e2e.test");
  await page.getByTestId("new-account-pseudonym").fill("Bea");
  await page.getByTestId("new-account-password").fill(PASSWORD);
  await page.getByTestId("new-account-password-confirm").fill(PASSWORD);
  await page.getByTestId("create-account-confirm").click();
  await expect(page.getByTestId("account-row")).toHaveCount(2, { timeout: 15_000 });
  await evidence(page, "administration-users");

  const bea = await newPerson(browser);
  await signIn(bea, "bea@e2e.test");
  await expect(bea.getByTestId(`tree-item-${secret}`)).toHaveCount(0);
  await bea.goto("/settings/account");
  await expect(bea.getByTestId("account-role")).toContainText("Membre");
  await expect(bea.getByTestId("settings-nav-administration")).toHaveCount(0);
  await expect(bea.getByTestId("settings-nav-backups")).toHaveCount(0);
  await evidence(bea, "account-member");
  await bea.context().close();
});

test("an invitation link counts its uses, lists its accounts and stops when revoked", async ({
  page,
  browser,
}) => {
  await createAdministrator(page);
  await setRegistrationMode(page, "invitation");
  await page.getByTestId("create-invitation").click();
  await page.getByTestId("invitation-label").fill("Famille");
  await page.getByTestId("invitation-max-uses").fill("2");
  await page.getByTestId("create-invitation-confirm").click();
  await expect(page.getByTestId("invitation-link")).toContainText("/join#", { timeout: 15_000 });
  const url = (await page.getByTestId("invitation-link").textContent())?.trim() ?? "";
  await evidence(page, "invitation-created");
  expect(url).toMatch(/\/join#[A-Za-z0-9_-]{43}$/);
  await page.keyboard.press("Escape");

  const guest = await newPerson(browser);
  const started = Date.now();
  await guest.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(guest.getByTestId("signup-form")).toBeVisible();
  await evidence(guest, "join");
  await guest.getByTestId("signup-email").fill("cleo@e2e.test");
  await guest.getByTestId("signup-pseudonym").fill("Cléo");
  await guest.getByTestId("signup-password").fill(PASSWORD);
  await guest.getByTestId("signup-password-confirm").fill(PASSWORD);
  await guest.getByTestId("signup-submit").click();
  await skipPasskeyOffer(guest, "signup-skip-passkey");
  // SC-002: an invited person is in within a minute.
  expect(Date.now() - started).toBeLessThan(60_000);
  await guest.context().close();

  await page.reload();
  await expect(page.getByTestId("invitation-uses")).toContainText("1 / 2", { timeout: 15_000 });
  await expect(page.getByTestId("invitation-accounts")).toContainText("Cléo");
  await evidence(page, "invitations-used");
  await page.getByTestId("revoke-invitation").click();
  await expect(page.getByTestId("invitation-row")).toHaveAttribute("data-state", "revoked", {
    timeout: 15_000,
  });

  const late = await newPerson(browser);
  await late.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await late.getByTestId("signup-email").fill("late@e2e.test");
  await late.getByTestId("signup-pseudonym").fill("Late");
  await late.getByTestId("signup-password").fill(PASSWORD);
  await late.getByTestId("signup-password-confirm").fill(PASSWORD);
  await late.getByTestId("signup-submit").click();
  await expect(late.getByTestId("signup-message")).toContainText("n’est plus utilisable");
  await evidence(late, "join-refused");
  await late.context().close();
});

test("open registration offers sign-up on the sign-in screen", async ({ page, browser }) => {
  await createAdministrator(page);
  await setRegistrationMode(page, "open");

  const newcomer = await newPerson(browser);
  await newcomer.goto("/");
  await openPasswordForm(newcomer);
  await evidence(newcomer, "login-open-registration");
  await newcomer.getByTestId("create-account").click();
  await newcomer.getByTestId("signup-email").fill("dan@e2e.test");
  await newcomer.getByTestId("signup-pseudonym").fill("Dan");
  await newcomer.getByTestId("signup-password").fill(PASSWORD);
  await newcomer.getByTestId("signup-password-confirm").fill(PASSWORD);
  await newcomer.getByTestId("signup-submit").click();
  await skipPasskeyOffer(newcomer, "signup-skip-passkey");
  await newcomer.context().close();
});

test("a disabled account is signed out and cannot sign back in", async ({ page, browser }) => {
  await createAdministrator(page);
  await openSettingsSection(page, "administration");
  await page.getByTestId("create-account").click();
  await page.getByTestId("new-account-email").fill("eve@e2e.test");
  await page.getByTestId("new-account-pseudonym").fill("Eve");
  await page.getByTestId("new-account-password").fill(PASSWORD);
  await page.getByTestId("new-account-password-confirm").fill(PASSWORD);
  await page.getByTestId("create-account-confirm").click();
  await expect(page.getByTestId("account-row")).toHaveCount(2, { timeout: 15_000 });

  const eve = await newPerson(browser);
  await signIn(eve, "eve@e2e.test");

  await page.getByTestId("disable-account").click();
  await expect(page.getByTestId("enable-account")).toBeVisible({ timeout: 15_000 });

  await eve.reload();
  await expect(eve.getByTestId("workspace-shell")).toHaveCount(0, { timeout: 30_000 });
  await openPasswordForm(eve);
  await eve.getByTestId("email-input").fill("eve@e2e.test");
  await eve.getByTestId("password-input").fill(PASSWORD);
  await eve.getByTestId("sign-in-password").click();
  await expect(eve.getByTestId("login-message")).toContainText("a échoué", { timeout: 30_000 });
  await eve.context().close();
});
