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
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { withBoundedDatabaseClient } from "./bounded-database.ts";
import { expectNoHorizontalOverflow, openSettings } from "./helpers.ts";
import { resetCanonicalContent } from "./reset-content.ts";
import { resetSecurityInstallation, seedCommittedOwner } from "./reset-installation.ts";

const PASSWORD = "correct horse battery staple";

function encodePassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function seedPassword(): Promise<void> {
  await withBoundedDatabaseClient("myownnotion-e2e-recovery-password", async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = rows[0]?.id;
    if (ownerId === undefined) {
      return;
    }
    await client.query(`DELETE FROM password_credential_versions WHERE owner_id = $1`, [ownerId]);
    await client.query(
      `INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
       VALUES (gen_random_uuid(), $1, $2, 'scrypt', 'active')`,
      [ownerId, encodePassword(PASSWORD)],
    );
  });
}

/** An installation that already holds a confirmed kit, as a live one does. */
async function seedActiveKit(): Promise<void> {
  await withBoundedDatabaseClient("myownnotion-e2e-recovery-kit", async (client) => {
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
    await client.query(`DELETE FROM recovery_kits WHERE installation_id = $1`, [installation.id]);
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

async function openSecurityWithCsrf(page: Page): Promise<string> {
  const login = page.waitForResponse(
    (response) => response.url().includes("/v1/auth/login/password") && response.ok(),
  );
  await openSecurity(page);
  const body = (await (await login).json()) as { csrfToken?: unknown };
  if (typeof body.csrfToken !== "string") {
    throw new Error("password login did not return its CSRF token");
  }
  return body.csrfToken;
}

async function readRecoveryState(): Promise<{
  readonly active: { readonly id: string; readonly epoch: number; readonly state: string } | null;
  readonly pending: {
    readonly id: string;
    readonly epoch: number;
    readonly delivery: string;
  } | null;
  readonly superseded: readonly { readonly id: string; readonly epoch: number }[];
  readonly currentEpoch: number;
}> {
  return await withBoundedDatabaseClient("myownnotion-e2e-recovery-state", async (client) => {
    const { rows: installations } = await client.query<{ id: string }>(
      `SELECT id FROM installations LIMIT 1`,
    );
    const installationId = installations[0]?.id;
    if (installationId === undefined)
      throw new Error("missing installation for recovery assertion");
    const { rows: kits } = await client.query<{
      id: string;
      recovery_epoch: number;
      authorization_state: string;
      delivery_state: string;
    }>(
      `SELECT id, recovery_epoch, authorization_state, delivery_state
       FROM recovery_kits
       WHERE installation_id = $1
       ORDER BY recovery_epoch ASC`,
      [installationId],
    );
    const { rows: epochs } = await client.query<{ epoch: number }>(
      `SELECT epoch FROM recovery_epochs WHERE installation_id = $1 ORDER BY epoch DESC LIMIT 1`,
      [installationId],
    );
    const active = kits.find((kit) => kit.authorization_state === "active");
    const pending = kits.find(
      (kit) => kit.authorization_state === "provisional" && kit.delivery_state !== "expired",
    );
    return {
      active:
        active === undefined
          ? null
          : { id: active.id, epoch: active.recovery_epoch, state: active.authorization_state },
      pending:
        pending === undefined
          ? null
          : {
              id: pending.id,
              epoch: pending.recovery_epoch,
              delivery: pending.delivery_state,
            },
      superseded: kits
        .filter((kit) => kit.authorization_state === "superseded")
        .map((kit) => ({ id: kit.id, epoch: kit.recovery_epoch })),
      currentEpoch: epochs[0]?.epoch ?? 0,
    };
  });
}

async function postRecoveryOperation(
  page: Page,
  csrfToken: string,
  path: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly code: string | null; readonly leaked: boolean }> {
  return await page.evaluate(
    async ({ csrfToken: token, path: requestPath, body: requestBody }) => {
      const response = await fetch(requestPath, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // The assertion below treats a non-JSON refusal as a failure without
        // retaining or exposing the response body.
      }
      const record = parsed !== null && typeof parsed === "object" ? parsed : null;
      return {
        status: response.status,
        code:
          record !== null && typeof (record as Record<string, unknown>)["code"] === "string"
            ? ((record as Record<string, unknown>)["code"] as string)
            : null,
        leaked:
          /ciphertext|private.?key|deployment.?key|BEGIN|salt|nonce|tag|kdf|encryption|supportedKeyGenerations|wrapped|encrypted|key.?material/i.test(
            text,
          ),
      };
    },
    { csrfToken, path, body },
  );
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

  test("downloads one compatible JSON artifact and atomically supersedes the old kit", async ({
    page,
  }) => {
    await seedActiveKit();
    const csrfToken = await openSecurityWithCsrf(page);
    const oldKitId = (await page.getByTestId("recovery-kit-id").textContent())?.trim();
    expect(oldKitId).toMatch(/^[0-9a-f-]{36}$/i);

    await page.getByTestId("prepare-recovery-replacement").click();
    await expect(page.getByTestId("recovery-replacement-panel")).toBeVisible();
    const replacementKitId = (
      await page.getByTestId("replacement-recovery-kit-id").textContent()
    )?.trim();
    expect(replacementKitId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(replacementKitId).not.toBe(oldKitId);

    // The old kit remains the usable one until the explicit confirmation.
    const preparedState = await readRecoveryState();
    expect(preparedState.active).toMatchObject({ id: oldKitId, epoch: 1, state: "active" });
    expect(preparedState.pending).toMatchObject({
      id: replacementKitId,
      epoch: 2,
      delivery: "downloadable",
    });
    expect(preparedState.currentEpoch).toBe(1);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovery-replacement").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("myownnotion-recovery.json");
    const artifactPath = await download.path();
    expect(artifactPath).not.toBeNull();
    const artifact = JSON.parse(await readFile(artifactPath as string, "utf8")) as {
      readonly format?: unknown;
      readonly formatVersion?: unknown;
      readonly kitId?: unknown;
      readonly recoveryEpoch?: unknown;
    };
    // Read only non-secret envelope identity. The encrypted payload never
    // enters an assertion message or test output.
    const artifactIdentity = {
      format: artifact.format,
      formatVersion: artifact.formatVersion,
      kitId: artifact.kitId,
      recoveryEpoch: artifact.recoveryEpoch,
    };
    expect(artifactIdentity).toEqual({
      format: "myownnotion.recovery+json",
      formatVersion: 1,
      kitId: replacementKitId,
      recoveryEpoch: 2,
    });
    await expect(page.getByTestId("download-recovery-replacement")).toBeDisabled();
    await page.getByTestId("acknowledge-recovery-replacement").check();
    await page.getByTestId("confirm-recovery-replacement").click();
    await expect(page.getByTestId("security-message")).toContainText(/ancien kit.*remplacé/i);

    const confirmedState = await readRecoveryState();
    expect(confirmedState.active).toMatchObject({
      id: replacementKitId,
      epoch: 2,
      state: "active",
    });
    expect(confirmedState.pending).toBeNull();
    expect(confirmedState.currentEpoch).toBe(2);
    expect(confirmedState.superseded).toContainEqual({ id: oldKitId, epoch: 1 });

    // A second confirmation is refused with a safe problem envelope and no
    // artifact material in the response.
    const secondConfirmation = await postRecoveryOperation(
      page,
      csrfToken,
      `/v1/security/recovery-kits/${replacementKitId}/confirm`,
      { storedOffline: true },
    );
    expect(secondConfirmation).toMatchObject({ status: 409, code: "conflict", leaked: false });
  });

  test("refuses a second download without leaking the consumed artifact", async ({ page }) => {
    await seedActiveKit();
    const csrfToken = await openSecurityWithCsrf(page);
    await page.getByTestId("prepare-recovery-replacement").click();
    await expect(page.getByTestId("recovery-replacement-panel")).toBeVisible();
    const kitId = (await page.getByTestId("replacement-recovery-kit-id").textContent())?.trim();
    expect(kitId).toMatch(/^[0-9a-f-]{36}$/i);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovery-replacement").click();
    await downloadPromise;
    const secondDownload = await postRecoveryOperation(
      page,
      csrfToken,
      `/v1/security/recovery-kits/${kitId}/download`,
    );
    expect(secondDownload).toMatchObject({ status: 409, code: "conflict", leaked: false });
  });

  test("requires the visible two-step revocation and shows its code", async ({ page }) => {
    await seedActiveKit();
    await openSecurity(page);
    await page.getByTestId("revoke-recovery-kit").click();
    await expect(page.getByTestId("confirm-revoke-recovery-kit")).toBeVisible();
    await expect(page.getByTestId("cancel-revoke-recovery-kit")).toBeVisible();
    await page.getByTestId("confirm-revoke-recovery-kit").click();
    await expect(page.getByTestId("security-message")).toContainText(
      /code de révocation : [0-9a-f]{12}/i,
    );
    const state = await readRecoveryState();
    expect(state.active).toBeNull();
    expect(state.currentEpoch).toBe(1);
  });

  test("keeps a consumed pending state after reload without making it active", async ({ page }) => {
    await seedActiveKit();
    await openSecurity(page);
    await page.getByTestId("prepare-recovery-replacement").click();
    await expect(page.getByTestId("recovery-replacement-panel")).toBeVisible();
    const replacementKitId = (
      await page.getByTestId("replacement-recovery-kit-id").textContent()
    )?.trim();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovery-replacement").click();
    await downloadPromise;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Récupération du compte" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("recovery-readiness")).toContainText(/remplacement en cours/i);
    const state = await readRecoveryState();
    expect(state.active?.epoch).toBe(1);
    expect(state.pending).toMatchObject({
      id: replacementKitId,
      epoch: 2,
      delivery: "download-consumed",
    });
    await expect(page.getByTestId("recovery-replacement-panel")).toBeVisible();
    await expect(page.getByTestId("download-recovery-replacement")).toBeDisabled();
    await expect(page.getByTestId("acknowledge-recovery-replacement")).toBeEnabled();
    await expect(page.getByTestId("confirm-recovery-replacement")).toBeDisabled();
  });
});

test.describe("at a narrow viewport", () => {
  test("the readiness statement is readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSecurity(page);

    await expect(page.getByTestId("recovery-readiness")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the replacement confirmation remains usable without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedActiveKit();
    await openSecurity(page);
    await page.getByTestId("prepare-recovery-replacement").click();
    await expect(page.getByTestId("recovery-replacement-panel")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("acknowledge-recovery-replacement")).toBeDisabled();
  });
});
