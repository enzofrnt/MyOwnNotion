/**
 * Bootstrap concurrency and committed counts (T026, feature 002).
 *
 * SC-001 says exactly one owner and one workspace exist, no matter how many
 * clients try at once. That claim is only worth anything if it survives real
 * concurrent transactions against a real PostgreSQL, so these tests race
 * independent connections rather than simulating a race in one process.
 *
 * The observation that matters throughout: **`ownerCount` and `workspaceCount`
 * are read from the tables at every step, not inferred.** A test that trusted
 * `installations.owner_id` would pass against a broken promotion.
 */

import {
  BootstrapClaimConflictError,
  claimAttempt,
  createInstallation,
  findAttempt,
  findOpenAttempt,
  persistAttempt,
  prepareProvisionalKit,
  promoteBootstrap,
  readCounts,
  recordKitDownloaded,
  SecurityRepositoryError,
  saveVerifiedCredential,
} from "@myownnotion/database";
import {
  BOOTSTRAP_CLAIM_WINDOW_MINUTES,
  type BootstrapAttempt,
  consumeDownload,
  generateUuidV7,
  prepareRecovery,
  recordCredentialVerified,
  startAttempt,
} from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  runConcurrently,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const ORIGIN = new Date("2026-01-01T00:00:00.000Z");

function at(minutes: number): Date {
  return new Date(ORIGIN.getTime() + minutes * 60_000);
}

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.execute(sql`
    TRUNCATE security_audit_events, recovery_kits, recovery_epochs,
      data_key_generations, sessions, authorized_devices,
      pending_bootstrap_credentials, bootstrap_attempts,
      password_credential_versions, passkey_credentials, owners, installations
    CASCADE
  `);
  await context.handle.db.execute(sql`TRUNCATE workspaces CASCADE`);
  await createInstallation(context.handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

function freshAttempt(attemptId = generateUuidV7()): BootstrapAttempt {
  return startAttempt({
    attemptId,
    installationId: INSTALLATION_ID,
    capabilityHash: `capability-${attemptId}`,
    clientNonceHash: `nonce-${attemptId}`,
    now: ORIGIN,
  });
}

/** Walks an attempt to `download-consumed`, the only state promotion accepts. */
async function walkToConsumed(attempt: BootstrapAttempt): Promise<BootstrapAttempt> {
  const kitId = generateUuidV7();
  const verified = recordCredentialVerified(attempt, { challengeHash: "challenge", now: at(1) });
  const prepared = prepareRecovery(verified, {
    recoveryKitId: kitId,
    downloadTokenHash: "download-token",
    now: at(2),
  });
  const consumed = consumeDownload(prepared, {
    downloadTokenHash: "download-token",
    now: at(3),
  });

  await context.handle.db.transaction(async (tx) => {
    await saveVerifiedCredential(tx, verified, {
      id: generateUuidV7(),
      attemptId: attempt.attemptId,
      credentialKind: "passkey",
      credentialIdDigest: `credential-${attempt.attemptId}`,
      publicKey: "public-key",
      origin: "https://workspace.example",
      relyingPartyId: "workspace.example",
      signCount: 1,
      userVerified: true,
      verifiedAt: at(1),
      expiresAt: at(16),
    });
    await prepareProvisionalKit(
      tx,
      prepared,
      {
        kitId,
        installationId: INSTALLATION_ID,
        sourceLineageId: INSTALLATION_ID,
        recoveryEpoch: 1,
        artifactDigest: "artifact-digest",
        downloadTokenHash: "download-token",
        downloadExpiresAt: at(17),
        supportedKeyGenerations: [1],
        createdAt: at(2),
      },
      null,
    );
    await recordKitDownloaded(tx, consumed, kitId, at(3));
  });
  return consumed;
}

function promotionInput(attempt: BootstrapAttempt) {
  return {
    attempt,
    ownerId: generateUuidV7(),
    credentialId: generateUuidV7(),
    workspaceId: WORKSPACE_ID,
    workspaceSchemaVersion: 1,
    deviceId: generateUuidV7(),
    deviceBindingId: `binding-${generateUuidV7()}`,
    deviceName: "Laptop",
    devicePlatform: "macOS",
    dataKeyGenerationId: generateUuidV7(),
    wrappedDataKey: "wrapped-data-key",
    recoveryEpochId: generateUuidV7(),
    now: at(4),
  };
}

/**
 * Claims an attempt and unwraps the result.
 *
 * `claimAttempt` now reports which attempt it superseded, and takes the clock
 * so it can tell a stale attempt from a live one. These tests are about
 * concurrency, not supersession, so they claim at `ORIGIN`, the same instant
 * the attempts were created. Every attempt they race is then live, and a
 * conflict is a real conflict rather than one attempt quietly ageing out.
 * Using the wall clock here would date every seeded attempt to 2026-01-01 and
 * silently turn each conflict into a supersession.
 */
async function claim(db: Parameters<typeof claimAttempt>[0]) {
  const { attempt } = await claimAttempt(db, freshAttempt(), ORIGIN);
  return attempt;
}

describe("claiming the single attempt", () => {
  it("lets exactly one of many concurrent claims win", async () => {
    const results = await runConcurrently(
      context.postgres.connectionString,
      Array.from({ length: 6 }, () => async (handle) => claim(handle.db)),
    );
    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);

    // The losers must be told they lost, not silently handed the winner's
    // attempt — that would give a second browser a capability it never proved.
    for (const loser of results.filter((result) => result.status === "rejected")) {
      const reason = (loser as { reason: unknown }).reason;
      expect(
        reason instanceof BootstrapClaimConflictError || reason instanceof SecurityRepositoryError,
        `unexpected failure: ${String(reason)}`,
      ).toBe(true);
    }
  });

  it("keeps the installation at 0/0 after any number of claims", async () => {
    await runConcurrently(
      context.postgres.connectionString,
      Array.from({ length: 6 }, () => async (handle) => claim(handle.db)),
    );
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("moves the installation to bootstrap-in-progress, still 0/0", async () => {
    await claim(context.handle.db);
    const rows = await context.handle.db.execute<{ state: string }>(
      sql`SELECT state FROM installations`,
    );
    expect(rows.rows[0]?.state).toBe("bootstrap-in-progress");
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses a new claim once ownership is committed", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));
    await expect(claim(context.handle.db)).rejects.toMatchObject({
      code: "bootstrap_unavailable",
    });
  });

  it("allows a fresh claim after the previous attempt became terminal", async () => {
    const first = await claim(context.handle.db);
    await context.handle.db.transaction(async (tx) => {
      await persistAttempt(tx, { ...first, state: "abandoned", updatedAt: at(5) });
    });
    await expect(claim(context.handle.db)).resolves.toBeDefined();
  });

  it("exposes exactly one open attempt at a time", async () => {
    await claim(context.handle.db);
    const open = await findOpenAttempt(context.handle.db, { installationId: INSTALLATION_ID });
    expect(open).not.toBeNull();
    await expect(claim(context.handle.db)).rejects.toBeInstanceOf(BootstrapClaimConflictError);
  });
});

describe("counts through the whole attempt", () => {
  it("stays 0/0 at every pre-confirmation step", async () => {
    const attempt = await claim(context.handle.db);
    expect(await readCounts(context.handle.db), "after claim").toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });

    await walkToConsumed(attempt);
    // Credential verified, kit prepared, download consumed — and still no
    // owner and no workspace.
    expect(await readCounts(context.handle.db), "after consumed download").toEqual({
      ownerCount: 0,
      workspaceCount: 0,
    });
  });

  it("holds verified credential material with no owner row", async () => {
    const attempt = await claim(context.handle.db);
    await walkToConsumed(attempt);
    const pending = await context.handle.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM pending_bootstrap_credentials`,
    );
    expect(Number(pending.rows[0]?.count)).toBe(1);
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("moves to 1/1 only at the atomic promotion", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    const result = await promoteBootstrap(context.handle.db, promotionInput(attempt));
    expect(result.ownerCount).toBe(1);
    expect(result.workspaceCount).toBe(1);
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });
});

describe("the atomic promotion", () => {
  it("lets exactly one of many concurrent promotions win", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    const results = await runConcurrently(
      context.postgres.connectionString,
      Array.from(
        { length: 5 },
        () => async (handle) => promoteBootstrap(handle.db, promotionInput(attempt)),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  it("refuses promotion from any state other than download-consumed", async () => {
    const attempt = await claim(context.handle.db);
    // Claimed but nothing else: no credential, no kit, no download.
    await expect(
      promoteBootstrap(context.handle.db, promotionInput(attempt)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("leaves 0/0 intact when the promotion fails partway", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    // A duplicate device binding makes an insert fail after the owner and the
    // workspace have already been written inside the transaction.
    await context.handle.db.execute(sql`
      INSERT INTO installations (id, source_lineage_id, state, schema_version)
      VALUES (${"018f2b7c-0000-7000-8000-0000000000ee"}::uuid,
              ${"018f2b7c-0000-7000-8000-0000000000ee"}::uuid, 'uninitialized', 1)
      ON CONFLICT DO NOTHING
    `);
    const input = { ...promotionInput(attempt), wrappedDataKey: "" };
    await context.handle.db.execute(sql`
      ALTER TABLE data_key_generations
      ADD CONSTRAINT tmp_wrapped_key_not_empty CHECK (length(wrapped_key_material) > 0)
    `);
    try {
      await expect(promoteBootstrap(context.handle.db, input)).rejects.toThrow();
      // Nothing partial survived: the whole transaction rolled back.
      expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
    } finally {
      await context.handle.db.execute(sql`
        ALTER TABLE data_key_generations DROP CONSTRAINT tmp_wrapped_key_not_empty
      `);
    }
  });

  it("binds the canonical workspace rather than regenerating it", async () => {
    // Feature 001 owns this identity; bootstrap adopts it verbatim.
    await context.handle.db.execute(sql`
      INSERT INTO workspaces (id, schema_version) VALUES (${WORKSPACE_ID}::uuid, 1)
    `);
    const attempt = await walkToConsumed(await claim(context.handle.db));
    const result = await promoteBootstrap(context.handle.db, promotionInput(attempt));
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    const rows = await context.handle.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM workspaces`,
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });

  it("confirms the kit and clears the pending material in the same commit", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));

    const kit = await context.handle.db.execute<{
      authorization_state: string;
      delivery_state: string;
    }>(sql`SELECT authorization_state, delivery_state FROM recovery_kits`);
    expect(kit.rows[0]).toEqual({
      authorization_state: "active",
      delivery_state: "confirmed",
    });

    // A second copy of credential material with no owner scope would be a
    // standing liability.
    const pending = await context.handle.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM pending_bootstrap_credentials`,
    );
    expect(Number(pending.rows[0]?.count)).toBe(0);
  });

  it("creates the first device with null activity and sync timestamps", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));
    const device = await context.handle.db.execute<{
      last_activity_at: string | null;
      last_sync_at: string | null;
    }>(sql`SELECT last_activity_at, last_sync_at FROM authorized_devices`);
    // The promotion is neither an activity event nor a synchronization.
    expect(device.rows[0]?.last_activity_at).toBeNull();
    expect(device.rows[0]?.last_sync_at).toBeNull();
  });

  it("reports every initialized state as 1/1 after promotion", async () => {
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));
    for (const state of [
      "recovery-required",
      "migration-in-progress",
      "degraded",
      "ready",
    ] as const) {
      await context.handle.db.execute(sql`UPDATE installations SET state = ${state}`);
      expect(await readCounts(context.handle.db), state).toEqual({
        ownerCount: 1,
        workspaceCount: 1,
      });
    }
  });

  it("preserves the canonical identities across the promotion", async () => {
    await context.handle.db.execute(sql`
      INSERT INTO workspaces (id, schema_version) VALUES (${WORKSPACE_ID}::uuid, 1)
    `);
    const before = await context.snapshotIdentities();
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));
    expect(await context.identityDrift(before)).toEqual([]);
  });
});

describe("an abandoned attempt must not lock the installation out forever", () => {
  // The failure this prevents: an owner claims an attempt, closes the tab, and
  // the installation can never be set up again. The single-open-attempt index
  // is what makes that possible, so the recovery has to happen at the claim.

  it("a live attempt still blocks a second claim", async () => {
    const first = await claimAttempt(context.handle.db, freshAttempt(), ORIGIN);
    expect(first.supersededAttemptId).toBeNull();

    // One minute later, well inside the window: somebody is mid-setup and must
    // not have it taken from under them.
    await expect(claimAttempt(context.handle.db, freshAttempt(), at(1))).rejects.toBeInstanceOf(
      BootstrapClaimConflictError,
    );
  });

  it("a stale attempt is superseded, and the new claim proceeds", async () => {
    const abandoned = freshAttempt();
    await claimAttempt(context.handle.db, abandoned, ORIGIN);

    const second = await claimAttempt(
      context.handle.db,
      freshAttempt(),
      at(BOOTSTRAP_CLAIM_WINDOW_MINUTES + 1),
    );
    expect(second.supersededAttemptId).toBe(abandoned.attemptId);

    // The old attempt is closed rather than deleted: it is a durable record of
    // something that happened, and the audit trail refers to it.
    const previous = await findAttempt(context.handle.db, abandoned.attemptId);
    expect(previous?.state).toBe("abandoned");
  });

  it("supersession commits nothing: the installation is still 0/0", async () => {
    await claimAttempt(context.handle.db, freshAttempt(), ORIGIN);
    await claimAttempt(context.handle.db, freshAttempt(), at(BOOTSTRAP_CLAIM_WINDOW_MINUTES + 1));
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("only one attempt is open after a supersession", async () => {
    // Otherwise the next claim sees two open attempts and the invariant the
    // partial unique index enforces is already broken.
    await claimAttempt(context.handle.db, freshAttempt(), ORIGIN);
    const third = freshAttempt();
    await claimAttempt(context.handle.db, third, at(BOOTSTRAP_CLAIM_WINDOW_MINUTES + 1));
    const open = await findOpenAttempt(context.handle.db, { installationId: INSTALLATION_ID });
    expect(open?.attemptId).toBe(third.attemptId);
  });

  it("still refuses once ownership is committed, however stale the attempt", async () => {
    // Staleness must not become a way back into a closed bootstrap surface.
    const attempt = await walkToConsumed(await claim(context.handle.db));
    await promoteBootstrap(context.handle.db, promotionInput(attempt));

    await expect(
      claimAttempt(context.handle.db, freshAttempt(), at(BOOTSTRAP_CLAIM_WINDOW_MINUTES + 100)),
    ).rejects.toMatchObject({ code: "bootstrap_unavailable" });
  });
});
