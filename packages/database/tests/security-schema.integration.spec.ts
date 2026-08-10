/**
 * Security schema constraints (T019 / T011, feature 002).
 *
 * The point of this suite is that the invariants are enforced by PostgreSQL,
 * not by application code. Application code can be bypassed by a concurrent
 * request; a unique index cannot. Each test therefore attempts the illegal
 * write directly against the database and asserts it is refused.
 *
 * Every assertion here is a rule that, if it silently stopped holding, would
 * be a security defect rather than a cosmetic one.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  isUniqueViolation,
  type SecurityIntegrationContext,
  violatesConstraint,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

/** Truncates every security table, leaving feature-001 content alone. */
async function resetSecurityTables(): Promise<void> {
  await context.handle.db.execute(sql`
    TRUNCATE security_audit_events, security_rate_limits, migration_checkpoints,
      encryption_migrations, protected_blob_chunks, protected_envelopes,
      rotation_checkpoints, rotation_operations, rotation_policies,
      data_key_generations, workspace_root_keys, wrapping_key_versions,
      recovery_kits, recovery_epochs, sessions, authorized_devices,
      pending_bootstrap_credentials, bootstrap_attempts,
      password_credential_versions, passkey_credentials, owners, installations
    CASCADE
  `);
  // The canonical workspace is committed by the promotion in these tests, so
  // it has to go back too or `workspaces_singleton_idx` blocks the next one.
  await context.handle.db.execute(sql`TRUNCATE workspaces CASCADE`);
}

/** An uninitialized installation: no owner, no workspace, counts 0/0. */
async function insertUninitializedInstallation(): Promise<void> {
  await context.handle.db.execute(sql`
    INSERT INTO installations (id, source_lineage_id, state, schema_version)
    VALUES (${INSTALLATION_ID}::uuid, ${INSTALLATION_ID}::uuid, 'uninitialized', 1)
  `);
}

/**
 * Promotes to `ready`, as the atomic confirmation transaction does: it creates
 * the owner AND commits the canonical feature-001 workspace row in one step.
 * `committedCounts()` reads the real `workspaces` table, so a promotion that
 * only set `installations.workspace_id` would still report 1/0 — which is the
 * partial installation this whole design exists to prevent.
 */
async function promoteToReady(): Promise<void> {
  await context.handle.db.execute(sql`
    INSERT INTO workspaces (id, schema_version) VALUES (${WORKSPACE_ID}::uuid, 1)
  `);
  await context.handle.db.execute(sql`
    INSERT INTO owners (id, installation_id, state)
    VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
  `);
  await context.handle.db.execute(sql`
    UPDATE installations
    SET state = 'ready', owner_id = ${OWNER_ID}::uuid, workspace_id = ${WORKSPACE_ID}::uuid
    WHERE id = ${INSTALLATION_ID}::uuid
  `);
}

beforeEach(async () => {
  await resetSecurityTables();
});

describe("migration 0004 applied", () => {
  it("creates every declared security table", async () => {
    const expected = [
      "authorized_devices",
      "bootstrap_attempts",
      "data_key_generations",
      "encryption_migrations",
      "installations",
      "migration_checkpoints",
      "owners",
      "passkey_credentials",
      "password_credential_versions",
      "pending_bootstrap_credentials",
      "protected_blob_chunks",
      "protected_envelopes",
      "recovery_epochs",
      "recovery_kits",
      "rotation_checkpoints",
      "rotation_operations",
      "rotation_policies",
      "security_audit_events",
      "security_rate_limits",
      "sessions",
      "workspace_root_keys",
      "wrapping_key_versions",
    ];
    const result = await context.handle.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const present = new Set(result.rows.map((row) => row.table_name));
    expect(expected.filter((table) => !present.has(table))).toEqual([]);
  });

  it("leaves the feature-001 content tables untouched", async () => {
    const result = await context.handle.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('workspaces', 'items', 'revisions', 'mutations', 'file_contents')
      ORDER BY table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "file_contents",
      "items",
      "mutations",
      "revisions",
      "workspaces",
    ]);
  });
});

describe("installation singleton and committed counts", () => {
  it("starts at 0/0 with no owner and no workspace", async () => {
    await insertUninitializedInstallation();
    expect(await context.committedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses a second installation", async () => {
    await insertUninitializedInstallation();
    await expect(insertUninitializedInstallation()).rejects.toSatisfy(isUniqueViolation);
  });

  it("refuses an uninitialized installation that already claims an owner", async () => {
    // The pre-confirmation workflow must be observable as 0/0; an owner here
    // would mean a partial installation exists.
    await expect(
      context.handle.db.execute(sql`
        INSERT INTO installations (id, source_lineage_id, state, owner_id, workspace_id, schema_version)
        VALUES (${INSTALLATION_ID}::uuid, ${INSTALLATION_ID}::uuid, 'bootstrap-in-progress',
                ${OWNER_ID}::uuid, ${WORKSPACE_ID}::uuid, 1)
      `),
    ).rejects.toSatisfy(violatesConstraint("installations_counts_check"));
  });

  it("refuses a ready installation with an owner but no workspace", async () => {
    await insertUninitializedInstallation();
    await context.handle.db.execute(sql`
      INSERT INTO owners (id, installation_id, state)
      VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
    `);
    // A half-committed promotion: exactly what the atomic transaction prevents.
    await expect(
      context.handle.db.execute(sql`
        UPDATE installations SET state = 'ready', owner_id = ${OWNER_ID}::uuid
        WHERE id = ${INSTALLATION_ID}::uuid
      `),
    ).rejects.toSatisfy(violatesConstraint("installations_counts_check"));
  });

  it("reports 1/1 once the promotion commits", async () => {
    await insertUninitializedInstallation();
    await promoteToReady();
    expect(await context.committedCounts()).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  it("keeps 1/1 in every initialized state, degraded included", async () => {
    await insertUninitializedInstallation();
    await promoteToReady();
    for (const state of ["recovery-required", "migration-in-progress", "degraded", "ready"]) {
      await context.handle.db.execute(sql`
        UPDATE installations SET state = ${state} WHERE id = ${INSTALLATION_ID}::uuid
      `);
      expect(await context.committedCounts(), state).toEqual({
        ownerCount: 1,
        workspaceCount: 1,
      });
    }
  });

  it("refuses a second owner", async () => {
    await insertUninitializedInstallation();
    await promoteToReady();
    await expect(
      context.handle.db.execute(sql`
        INSERT INTO owners (id, installation_id, state)
        VALUES (${"018f2b7c-0000-7000-8000-0000000000cc"}::uuid, ${INSTALLATION_ID}::uuid, 'active')
      `),
    ).rejects.toSatisfy(isUniqueViolation);
  });
});

describe("bootstrap attempts", () => {
  beforeEach(async () => {
    await insertUninitializedInstallation();
  });

  async function insertAttempt(id: string, state: string): Promise<unknown> {
    return context.handle.db.execute(sql`
      INSERT INTO bootstrap_attempts (id, installation_id, bootstrap_state, client_nonce_hash, capability_hash)
      VALUES (${id}::uuid, ${INSTALLATION_ID}::uuid, ${state}, 'nonce-digest', 'capability-digest')
    `);
  }

  it("allows one open attempt", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000101", "started");
    expect(await context.committedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses a second open attempt, whatever its non-terminal state", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000101", "started");
    for (const state of [
      "started",
      "credential-verified",
      "recovery-prepared",
      "download-consumed",
    ]) {
      await expect(
        insertAttempt("018f2b7c-0000-7000-8000-0000000001ff", state),
        state,
      ).rejects.toSatisfy(isUniqueViolation);
    }
  });

  it("allows a new attempt once the previous one is terminal", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000101", "started");
    await context.handle.db.execute(sql`
      UPDATE bootstrap_attempts SET bootstrap_state = 'abandoned'
      WHERE id = ${"018f2b7c-0000-7000-8000-000000000101"}::uuid
    `);
    await expect(
      insertAttempt("018f2b7c-0000-7000-8000-000000000102", "started"),
    ).resolves.toBeDefined();
  });

  it("refuses confirmation without a consumed download", async () => {
    // Offline confirmation is mandatory; there is no shortcut to `confirmed`.
    await expect(
      insertAttempt("018f2b7c-0000-7000-8000-000000000103", "confirmed"),
    ).rejects.toSatisfy(violatesConstraint("bootstrap_attempts_confirmation_check"));
  });

  it("refuses a consumed download that had no window or token", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000104", "recovery-prepared");
    await expect(
      context.handle.db.execute(sql`
        UPDATE bootstrap_attempts SET download_consumed_at = now()
        WHERE id = ${"018f2b7c-0000-7000-8000-000000000104"}::uuid
      `),
    ).rejects.toSatisfy(violatesConstraint("bootstrap_attempts_download_check"));
  });

  it("keeps pending credential material attempt-scoped, with no owner row", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000105", "credential-verified");
    await context.handle.db.execute(sql`
      INSERT INTO pending_bootstrap_credentials
        (id, attempt_id, credential_kind, credential_id_digest, public_key, origin, expires_at)
      VALUES (${"018f2b7c-0000-7000-8000-000000000201"}::uuid,
              ${"018f2b7c-0000-7000-8000-000000000105"}::uuid,
              'passkey', 'credential-digest', 'public-key', 'https://workspace.example',
              now() + interval '15 minutes')
    `);
    // Verified credential material exists and the installation is still 0/0.
    expect(await context.committedCounts()).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses passkey material with no public key", async () => {
    await insertAttempt("018f2b7c-0000-7000-8000-000000000106", "credential-verified");
    await expect(
      context.handle.db.execute(sql`
        INSERT INTO pending_bootstrap_credentials
          (id, attempt_id, credential_kind, credential_id_digest, origin, expires_at)
        VALUES (${"018f2b7c-0000-7000-8000-000000000202"}::uuid,
                ${"018f2b7c-0000-7000-8000-000000000106"}::uuid,
                'passkey', 'credential-digest', 'https://workspace.example', now())
      `),
    ).rejects.toSatisfy(violatesConstraint("pending_bootstrap_credentials_material_check"));
  });
});

describe("recovery kit state pairs", () => {
  beforeEach(async () => {
    await insertUninitializedInstallation();
  });

  async function insertKit(
    id: string,
    authorizationState: string,
    deliveryState: string,
    timestamps: { confirmedAt?: boolean; consumedAt?: boolean } = {},
  ): Promise<unknown> {
    return context.handle.db.execute(sql`
      INSERT INTO recovery_kits
        (id, installation_id, source_lineage_id, recovery_epoch, authorization_state,
         delivery_state, supported_key_generations, artifact_digest,
         confirmed_at, download_consumed_at)
      VALUES (${id}::uuid, ${INSTALLATION_ID}::uuid, ${INSTALLATION_ID}::uuid, 1,
              ${authorizationState}, ${deliveryState}, ARRAY[1], 'artifact-digest',
              ${timestamps.confirmedAt === true ? sql`now()` : sql`NULL`},
              ${timestamps.consumedAt === true ? sql`now()` : sql`NULL`})
    `);
  }

  const LEGAL: Array<[string, string, { confirmedAt?: boolean; consumedAt?: boolean }]> = [
    ["provisional", "prepared", {}],
    ["provisional", "downloadable", {}],
    ["provisional", "download-consumed", { consumedAt: true }],
    ["active", "confirmed", { confirmedAt: true }],
    ["superseded", "confirmed", { confirmedAt: true }],
    ["revoked", "confirmed", { confirmedAt: true }],
    ["rejected", "expired", {}],
  ];

  it("accepts each of the seven legal pairs", async () => {
    let counter = 0;
    for (const [authorizationState, deliveryState, timestamps] of LEGAL) {
      counter += 1;
      const id = `018f2b7c-0000-7000-8000-0000000003${String(counter).padStart(2, "0")}`;
      // Only one `active` kit may exist, so clear between attempts.
      await context.handle.db.execute(sql`DELETE FROM recovery_kits`);
      await expect(
        insertKit(id, authorizationState, deliveryState, timestamps),
        `${authorizationState}/${deliveryState}`,
      ).resolves.toBeDefined();
    }
  });

  it("refuses every combination outside the seven", async () => {
    const authorizations = ["provisional", "active", "superseded", "revoked", "rejected"];
    const deliveries = ["prepared", "downloadable", "download-consumed", "confirmed", "expired"];
    let counter = 0;
    for (const authorizationState of authorizations) {
      for (const deliveryState of deliveries) {
        const legal = LEGAL.some(([a, d]) => a === authorizationState && d === deliveryState);
        if (legal) {
          continue;
        }
        counter += 1;
        const id = `018f2b7c-0000-7000-8000-0000000004${String(counter).padStart(2, "0")}`;
        await expect(
          insertKit(id, authorizationState, deliveryState, {
            confirmedAt: true,
            consumedAt: true,
          }),
          `${authorizationState}/${deliveryState} must be refused`,
        ).rejects.toSatisfy(violatesConstraint("recovery_kits_state_pair_check"));
      }
    }
    // 25 combinations minus the 7 legal ones.
    expect(counter).toBe(18);
  });

  it("refuses a provisional kit claiming to be confirmed", async () => {
    // The pair that would bypass mandatory offline confirmation.
    await expect(
      insertKit("018f2b7c-0000-7000-8000-000000000501", "provisional", "confirmed", {
        confirmedAt: true,
      }),
    ).rejects.toSatisfy(violatesConstraint("recovery_kits_state_pair_check"));
  });

  it("requires confirmedAt on a confirmed kit", async () => {
    await expect(
      insertKit("018f2b7c-0000-7000-8000-000000000502", "active", "confirmed", {}),
    ).rejects.toSatisfy(violatesConstraint("recovery_kits_confirmed_at_check"));
  });

  it("allows at most one active kit", async () => {
    await insertKit("018f2b7c-0000-7000-8000-000000000503", "active", "confirmed", {
      confirmedAt: true,
    });
    await expect(
      insertKit("018f2b7c-0000-7000-8000-000000000504", "active", "confirmed", {
        confirmedAt: true,
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });
});

describe("rotation policies", () => {
  beforeEach(async () => {
    await insertUninitializedInstallation();
  });

  async function insertPolicy(id: string, kind: string, graceDays: number): Promise<unknown> {
    return context.handle.db.execute(sql`
      INSERT INTO rotation_policies
        (id, installation_id, kind, due_interval_days, due_at, write_block_at)
      VALUES (${id}::uuid, ${INSTALLATION_ID}::uuid, ${kind}, 365,
              now(), now() + (${graceDays} || ' days')::interval)
    `);
  }

  it("keeps wrapping-key and data-key policies independent", async () => {
    await insertPolicy("018f2b7c-0000-7000-8000-000000000601", "wrapping-key", 7);
    await expect(
      insertPolicy("018f2b7c-0000-7000-8000-000000000602", "data-key", 7),
    ).resolves.toBeDefined();
  });

  it("refuses a second policy of the same kind", async () => {
    await insertPolicy("018f2b7c-0000-7000-8000-000000000603", "data-key", 7);
    await expect(
      insertPolicy("018f2b7c-0000-7000-8000-000000000604", "data-key", 7),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("allows an emergency policy whose block lands on the due date", async () => {
    await expect(
      insertPolicy("018f2b7c-0000-7000-8000-000000000605", "data-key", 0),
    ).resolves.toBeDefined();
  });

  it("refuses a write block before the due date", async () => {
    await expect(
      insertPolicy("018f2b7c-0000-7000-8000-000000000606", "data-key", -1),
    ).rejects.toSatisfy(violatesConstraint("rotation_policies_write_block_check"));
  });
});

describe("migration retention", () => {
  beforeEach(async () => {
    await insertUninitializedInstallation();
  });

  async function insertMigration(state: string, sourceRetained: string): Promise<unknown> {
    await context.handle.db.execute(sql`DELETE FROM encryption_migrations`);
    return context.handle.db.execute(sql`
      INSERT INTO encryption_migrations
        (id, installation_id, workspace_id, source_schema_version,
         destination_schema_version, state, source_retained)
      VALUES (${"018f2b7c-0000-7000-8000-000000000701"}::uuid, ${INSTALLATION_ID}::uuid,
              ${WORKSPACE_ID}::uuid, 1, 2, ${state}, ${sourceRetained})
    `);
  }

  it("refuses to release plaintext before the read cutover", async () => {
    // Releasing here would destroy data that is still the only copy.
    for (const state of ["backfill", "verify", "stop-plaintext-writes", "encrypted-read-cutover"]) {
      await expect(insertMigration(state, "false"), state).rejects.toSatisfy(
        violatesConstraint("encryption_migrations_retention_check"),
      );
    }
  });

  it("allows release once scrubbing starts", async () => {
    await expect(insertMigration("scrub-plaintext", "false")).resolves.toBeDefined();
    await expect(insertMigration("complete", "false")).resolves.toBeDefined();
  });

  it("allows one migration per installation", async () => {
    await insertMigration("backfill", "true");
    await expect(
      context.handle.db.execute(sql`
        INSERT INTO encryption_migrations
          (id, installation_id, workspace_id, source_schema_version,
           destination_schema_version, state)
        VALUES (${"018f2b7c-0000-7000-8000-000000000702"}::uuid, ${INSTALLATION_ID}::uuid,
                ${WORKSPACE_ID}::uuid, 1, 2, 'backfill')
      `),
    ).rejects.toSatisfy(isUniqueViolation);
  });
});

describe("audit and sessions", () => {
  beforeEach(async () => {
    await insertUninitializedInstallation();
  });

  it("refuses an audit row with an unknown outcome or actor class", async () => {
    const insert = (outcome: string, actorClass: string) =>
      context.handle.db.execute(sql`
        INSERT INTO security_audit_events
          (id, installation_id, event_type, outcome, actor_class, correlation_id)
        VALUES (gen_random_uuid(), ${INSTALLATION_ID}::uuid, 'bootstrap.started',
                ${outcome}, ${actorClass}, 'corr-1')
      `);
    await expect(insert("maybe", "owner")).rejects.toSatisfy(
      violatesConstraint("security_audit_events_outcome_check"),
    );
    await expect(insert("success", "robot")).rejects.toSatisfy(
      violatesConstraint("security_audit_events_actor_check"),
    );
  });

  it("accepts the declared actor classes, hosting-admin included", async () => {
    for (const actorClass of ["owner", "hosting-admin", "system"]) {
      await expect(
        context.handle.db.execute(sql`
          INSERT INTO security_audit_events
            (id, installation_id, event_type, outcome, actor_class, correlation_id)
          VALUES (gen_random_uuid(), ${INSTALLATION_ID}::uuid, 'installation.checked',
                  'success', ${actorClass}, 'corr-1')
        `),
        actorClass,
      ).resolves.toBeDefined();
    }
  });

  it("refuses a session whose auth method is the local CLI", async () => {
    await promoteToReady();
    await context.handle.db.execute(sql`
      INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
      VALUES (${"018f2b7c-0000-7000-8000-000000000801"}::uuid, ${OWNER_ID}::uuid,
              'binding-1', 'Laptop', 'active')
    `);
    // The protected local CLI never creates a browser or API session.
    await expect(
      context.handle.db.execute(sql`
        INSERT INTO sessions
          (id, owner_id, device_id, session_secret_hash, auth_method, expires_at, recent_auth_at)
        VALUES (gen_random_uuid(), ${OWNER_ID}::uuid,
                ${"018f2b7c-0000-7000-8000-000000000801"}::uuid, 'secret-digest',
                'local-cli', now() + interval '30 days', now())
      `),
    ).rejects.toSatisfy(violatesConstraint("sessions_auth_method_check"));
  });

  it("returns null device activity and sync timestamps until a real event", async () => {
    await promoteToReady();
    await context.handle.db.execute(sql`
      INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
      VALUES (${"018f2b7c-0000-7000-8000-000000000802"}::uuid, ${OWNER_ID}::uuid,
              'binding-2', 'Phone', 'active')
    `);
    const result = await context.handle.db.execute<{
      last_activity_at: string | null;
      last_sync_at: string | null;
    }>(sql`
      SELECT last_activity_at, last_sync_at FROM authorized_devices
      WHERE id = ${"018f2b7c-0000-7000-8000-000000000802"}::uuid
    `);
    // Registration must not synthesize either timestamp.
    expect(result.rows[0]?.last_activity_at).toBeNull();
    expect(result.rows[0]?.last_sync_at).toBeNull();
  });
});
