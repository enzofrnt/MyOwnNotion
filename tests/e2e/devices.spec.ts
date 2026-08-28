/**
 * Device inventory journeys (T066, US3, FR-008 – FR-010).
 *
 * The inventory is the screen an owner opens when they suspect someone else
 * has access, so these journeys check what that person can actually learn and
 * do — not that buttons exist.
 *
 * Two of them assert wording rather than behaviour, which is unusual and
 * deliberate. What the screen *says* about a revoked device decides whether
 * the owner keeps looking for the lost laptop, and FR-010 requires it to be
 * said. A journey that only clicked "Revoke" and saw the row change state
 * would pass while the owner was misled.
 */

import { randomBytes, scryptSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { openSettings } from "./helpers.ts";
import { resetCanonicalContent } from "./reset-content.ts";
import { resetSecurityInstallation, seedCommittedOwner } from "./reset-installation.ts";

const PASSWORD = "correct horse battery staple";

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

function encodePassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
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

/** A second device, so the inventory has something the owner did not just use. */
async function seedSecondDevice(name: string): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = rows[0]?.id;
    if (ownerId === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, platform, state,
         last_activity_at, last_sync_at)
       VALUES (gen_random_uuid(), $1, 'seeded-binding', $2, 'iOS', 'active', NULL, NULL)`,
      [ownerId, name],
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
  await seedSecondDevice("Old phone");
});

async function openPasswordForm(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible({
    timeout: 30_000,
  });
  if (!(await page.getByTestId("password-input").isVisible())) {
    await page.getByTestId("use-password-instead").click();
  }
  await expect(page.getByTestId("password-input")).toBeVisible();
}

async function openDevices(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await openPasswordForm(page);
  await page.getByTestId("password-input").fill(PASSWORD);
  await page.getByTestId("sign-in-password").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible({
    timeout: 30_000,
  });
  await openSettings(page);
  await expect(page.getByTestId("device-list")).toBeVisible({ timeout: 30_000 });
}

/** The seeded device, which the owner has never used from this browser. */
function oldPhoneRow(page: import("@playwright/test").Page) {
  return page.getByTestId("device-row").filter({ hasText: "Old phone" });
}

async function revokeOldPhone(page: import("@playwright/test").Page): Promise<void> {
  await oldPhoneRow(page).getByTestId("revoke-device").click();
  const confirmation = page.getByTestId("revoke-device-confirmation");
  await expect(confirmation).toContainText("Révoquer « Old phone » ?");
  await confirmation.getByTestId("confirm-revoke-device").click();
  await expect(confirmation).toBeHidden();
}

test.describe("what the inventory shows", () => {
  test("lists the owner's devices", async ({ page }) => {
    await openDevices(page);
    await expect(oldPhoneRow(page)).toBeVisible();
  });

  test("says a never-used device has never been used", async ({ page }) => {
    // Not a date. A device authorized long ago and never touched is the row an
    // owner most needs to notice, and borrowing its authorization date would
    // make it look as active as the browser they are sitting at.
    await openDevices(page);
    await expect(oldPhoneRow(page)).toContainText("dernière utilisation jamais");
    await expect(oldPhoneRow(page)).toContainText("dernière synchronisation jamais");
  });

  test("does not expose the device binding identifier", async ({ page }) => {
    // It is how a device proves it is itself; the page has no use for it.
    await openDevices(page);
    expect(await page.content()).not.toContain("seeded-binding");
  });
});

test.describe("renaming a device", () => {
  test("takes effect without asking for a fresh sign-in", async ({ page }) => {
    // Deliberately unlike revocation. A passkey prompt to fix a typo teaches
    // owners to approve prompts without reading them.
    await openDevices(page);
    await oldPhoneRow(page).getByTestId("rename-device").click();
    await page.getByTestId("device-name-input").fill("Spare phone");
    await page.getByTestId("save-device-name").click();

    await expect(page.getByTestId("device-row").filter({ hasText: "Spare phone" })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("revoking a device", () => {
  test("says what revoking cannot undo", async ({ page }) => {
    // FR-010, and the reason this journey exists. An owner who believes their
    // data was wiped stops looking for the lost device — so the screen has to
    // distinguish losing access from being erased.
    await openDevices(page);
    await revokeOldPhone(page);

    await expect(page.getByTestId("device-message")).toContainText(
      "ne peuvent pas être effacées à distance",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("device-message")).toContainText("ne se reconnecte jamais");
  });

  test("still says the device lost its access", async ({ page }) => {
    // The limitation must not swallow the reassurance: revoking did work.
    await openDevices(page);
    await revokeOldPhone(page);
    await expect(page.getByTestId("device-message")).toContainText("ne peut plus accéder", {
      timeout: 30_000,
    });
  });

  test("offers no further action on a revoked device", async ({ page }) => {
    // Matching the server, which refuses to act on it. A button that always
    // fails teaches the owner to distrust the screen.
    await openDevices(page);
    await revokeOldPhone(page);
    await expect(page.getByTestId("device-message")).toContainText("ne peut plus accéder", {
      timeout: 30_000,
    });

    const revoked = page.getByTestId("device-row").filter({ hasText: "Old phone" });
    await expect(revoked).toContainText("Révoqué");
    await expect(revoked.getByTestId("revoke-device")).toHaveCount(0);
    await expect(revoked.getByTestId("rename-device")).toHaveCount(0);
  });
});

test.describe("asking a device to sign in again", () => {
  test("is presented as separate from revoking", async ({ page }) => {
    // The two mean different things to the owner: one device is still theirs.
    await openDevices(page);
    await oldPhoneRow(page).getByTestId("reauthorize-device").click();

    await expect(page.getByTestId("device-message")).toContainText("devra se reconnecter", {
      timeout: 30_000,
    });
    await expect(oldPhoneRow(page)).toContainText("Nouvelle connexion nécessaire");
    // Still administrable, unlike a revoked device.
    await expect(oldPhoneRow(page).getByTestId("rename-device")).toBeVisible();
  });
});

test.describe("responsive presentation", () => {
  test("the inventory is reachable without horizontal scrolling", async ({ page }) => {
    await openDevices(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
