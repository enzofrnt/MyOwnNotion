/**
 * Recovery readiness, as an owner sees it (T054, US4, FR-015, FR-016, SC-008).
 *
 * These journeys assert one sentence and the presence of a second, and both
 * decide whether an owner is actually protected or only believes they are.
 *
 * **"You have no recovery kit" has to be said in those words.** An installation
 * without one is the single most dangerous state this application can be in —
 * lose the passkey and the machine, and the notes are gone. A screen that
 * showed a kit identifier when there was one and simply nothing when there was
 * not would leave that state looking like a rendering glitch, which is how it
 * would stay unnoticed until it mattered.
 *
 * **The deployment-key requirement has to be on screen every time.** This
 * installation seals the kit under the key file on the host, so the kit alone
 * restores nothing. An owner reads this screen rarely; forgetting the pairing
 * is exactly how a carefully stored kit turns out to be useless.
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

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function seedPassword(): Promise<void> {
  await withClient(async (client) => {
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
  });
}

/** An installation that already holds a confirmed kit, as a live one does. */
async function seedActiveKit(): Promise<void> {
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string; source_lineage_id: string }>(
      `SELECT id, source_lineage_id FROM installations LIMIT 1`,
    );
    const installation = rows[0];
    if (installation === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO recovery_epochs (id, installation_id, epoch, state)
       VALUES (gen_random_uuid(), $1, 1, 'active')
       ON CONFLICT DO NOTHING`,
      [installation.id],
    );
    await client.query(
      `INSERT INTO recovery_kits
         (id, installation_id, source_lineage_id, recovery_epoch, authorization_state,
          delivery_state, supported_key_generations, artifact_digest, confirmed_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'active', 'confirmed', ARRAY[1], 'seeded', now())`,
      [installation.id, installation.source_lineage_id],
    );
  });
}

test.beforeEach(async () => {
  await resetSecurityInstallation();
  await resetCanonicalContent();
  await seedCommittedOwner();
  await seedPassword();
});

async function openSecurity(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible({
    timeout: 30_000,
  });
  if (!(await page.getByTestId("password-input").isVisible())) {
    await page.getByTestId("use-password-instead").click();
  }
  await page.getByTestId("password-input").fill(PASSWORD);
  await page.getByTestId("sign-in-password").click();
  await expect(page.getByTestId("workspace-shell")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[data-testid="active-item-title"], [data-testid="active-item-heading"]').first(),
  ).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "Récupération du compte" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("an installation with no kit", () => {
  test("says so, in those words", async ({ page }) => {
    // The journey this file exists for. This state is the most dangerous the
    // application can be in, and it must not look like a rendering glitch.
    await openSecurity(page);
    await expect(page.getByTestId("recovery-readiness")).toContainText(
      /aucun kit de récupération/i,
    );
  });

  test("says what it would cost", async ({ page }) => {
    // Not just "no kit" — what happens without one. An owner who does not know
    // the consequence has no reason to act today rather than eventually.
    await openSecurity(page);
    await expect(page.getByTestId("recovery-readiness")).toContainText(/ne pourrez plus accéder/i);
  });
});

test.describe("an installation with a kit", () => {
  test("says the owner has one", async ({ page }) => {
    await seedActiveKit();
    await openSecurity(page);
    await expect(page.getByTestId("recovery-readiness")).toContainText(
      /disposez d’un kit de récupération/i,
    );
  });

  test("still requires the deployment key, and says so", async ({ page }) => {
    // The half an owner cannot infer from the file they hold. Holding a kit is
    // not the same as being able to use it.
    await seedActiveKit();
    await openSecurity(page);
    await expect(page.getByTestId("recovery-key-requirement")).toContainText(/clé de déploiement/i);
    await expect(page.getByTestId("recovery-key-requirement")).toContainText(/séparément/i);
  });
});

test.describe("the deployment-key requirement", () => {
  test("appears whether or not a kit exists", async ({ page }) => {
    // Both states, because an owner about to generate their first kit needs it
    // as much as one who has had a kit for two years.
    await openSecurity(page);
    await expect(page.getByTestId("recovery-key-requirement")).toBeVisible();
  });
});

test.describe("replacing a kit", () => {
  test("says the existing kit keeps working", async ({ page }) => {
    // Stated before they start. An owner who believes generating a kit
    // invalidates the old one immediately will put it off — which leaves them
    // on a kit they may already have lost.
    await seedActiveKit();
    await openSecurity(page);
    await expect(page.locator(".recovery-readiness-panel__note")).toContainText(
      /reste valable jusqu’au/i,
    );
  });

  test("offers the control without performing anything on load", async ({ page }) => {
    await seedActiveKit();
    await openSecurity(page);
    await expect(page.getByTestId("prepare-recovery-replacement")).toBeEnabled();
    // Nothing has been prepared merely by looking at the screen.
    await expect(page.getByTestId("recovery-readiness")).not.toContainText(
      /remplacement en cours/i,
    );
  });
});

test.describe("at a narrow viewport", () => {
  test("the readiness statement is readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSecurity(page);

    await expect(page.getByTestId("recovery-readiness")).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
