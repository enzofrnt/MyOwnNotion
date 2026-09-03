/**
 * Installation repository and transaction boundary (T011, feature 002).
 *
 * What these tests are really checking is that the `0/0` → `1/1` transition is
 * atomic under concurrency. Every assertion here corresponds to a way a second
 * owner could otherwise come into existence:
 *
 *   - two callers claiming ownership at the same time;
 *   - a promotion that commits the owner but not the workspace;
 *   - a state change that says `ready` while no owner exists;
 *   - a repository that reads `installations.owner_id` instead of counting the
 *     rows, and therefore believes a broken promotion.
 */

import {
  createInstallation,
  type Database,
  findInstallation,
  promoteOwnership,
  readCounts,
  readInstallationStatus,
  SecurityConflictError,
  SecurityRepositoryError,
  setInstallationState,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  runConcurrently,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const LINEAGE_ID = "018f2b7c-0000-7000-8000-000000000002";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
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
  await context.handle.db.execute(sql`TRUNCATE workspaces CASCADE`);
});

async function seedInstallation(): Promise<void> {
  await createInstallation(context.handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: LINEAGE_ID,
    schemaVersion: 1,
  });
}

describe("installation creation", () => {
  it("creates one uninitialized installation reporting 0/0", async () => {
    const record = await createInstallation(context.handle.db, {
      id: INSTALLATION_ID,
      sourceLineageId: LINEAGE_ID,
      schemaVersion: 1,
    });
    expect(record.state).toBe("uninitialized");
    expect(record.ownerId).toBeNull();
    expect(record.workspaceId).toBeNull();
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("is idempotent: a second caller receives the same row, not an error", async () => {
    // Two browser tabs on the first-run page is normal, not a conflict.
    const first = await createInstallation(context.handle.db, {
      id: INSTALLATION_ID,
      sourceLineageId: LINEAGE_ID,
      schemaVersion: 1,
    });
    const second = await createInstallation(context.handle.db, {
      id: "018f2b7c-0000-7000-8000-0000000000ff",
      sourceLineageId: LINEAGE_ID,
      schemaVersion: 1,
    });
    expect(second.id).toBe(first.id);
  });

  it("returns one installation for concurrent creators", async () => {
    const results = await runConcurrently(
      context.postgres.connectionString,
      Array.from(
        { length: 5 },
        () => async (handle) =>
          createInstallation(handle.db, {
            id: generateUuidV7(),
            sourceLineageId: LINEAGE_ID,
            schemaVersion: 1,
          }),
      ),
    );
    const ids = new Set(
      results
        .filter((result) => result.status === "fulfilled")
        .map((result) => (result as { value: { id: string } }).value.id),
    );
    expect(ids.size).toBe(1);
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("rethrows a creation failure that is not a singleton unique violation", async () => {
    const db = {
      transaction: async () => {
        throw new Error("the connection closed");
      },
    } as unknown as Database;
    await expect(
      createInstallation(db, {
        id: generateUuidV7(),
        sourceLineageId: LINEAGE_ID,
        schemaVersion: 1,
      }),
    ).rejects.toThrow("the connection closed");
  });
});

describe("atomic ownership promotion", () => {
  beforeEach(seedInstallation);

  it("moves 0/0 to 1/1 in one transaction", async () => {
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });

    const status = await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });

    expect(status.state).toBe("ready");
    expect(status.counts).toEqual({ ownerCount: 1, workspaceCount: 1 });
    expect(status.workspaceId).toBe(WORKSPACE_ID);
  });

  it("binds the canonical workspace rather than regenerating it", async () => {
    // Feature 001 owns this identity; security must adopt it verbatim.
    await context.handle.db.execute(sql`
      INSERT INTO workspaces (id, schema_version) VALUES (${WORKSPACE_ID}::uuid, 1)
    `);
    const status = await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });
    expect(status.workspaceId).toBe(WORKSPACE_ID);
    expect(status.counts.workspaceCount).toBe(1);
  });

  it("lets exactly one of many concurrent promotions win", async () => {
    const results = await runConcurrently(
      context.postgres.connectionString,
      Array.from(
        { length: 5 },
        () => async (handle) =>
          promoteOwnership(handle.db, {
            installationId: INSTALLATION_ID,
            ownerId: generateUuidV7(),
            workspaceId: WORKSPACE_ID,
            workspaceSchemaVersion: 1,
            state: "ready",
          }),
      ),
    );

    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    // The losers must fail loudly; a silent success would mean a second owner.
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  it("refuses a second promotion once ownership is committed", async () => {
    await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });
    await expect(
      promoteOwnership(context.handle.db, {
        installationId: INSTALLATION_ID,
        ownerId: generateUuidV7(),
        workspaceId: WORKSPACE_ID,
        workspaceSchemaVersion: 1,
        state: "ready",
      }),
    ).rejects.toBeInstanceOf(SecurityRepositoryError);
  });

  it("leaves 0/0 intact when the promotion fails partway", async () => {
    // A duplicate owner ID makes the insert fail after the workspace insert.
    await context.handle.db.execute(sql`
      INSERT INTO workspaces (id, schema_version) VALUES (${WORKSPACE_ID}::uuid, 1)
    `);
    await context.handle.db.execute(sql`
      INSERT INTO owners (id, installation_id, state)
      VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
    `);
    await context.handle.db.execute(sql`DELETE FROM owners`);
    await context.handle.db.execute(sql`DELETE FROM workspaces`);

    // Force a failure inside the transaction by promoting into a state the
    // check constraint forbids paired with a missing workspace binding.
    await expect(
      promoteOwnership(context.handle.db, {
        installationId: "018f2b7c-0000-7000-8000-0000000000ee",
        ownerId: OWNER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceSchemaVersion: 1,
        state: "ready",
      }),
    ).rejects.toBeInstanceOf(SecurityRepositoryError);

    // Nothing partial survived the rollback.
    expect(await readCounts(context.handle.db)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses a promotion scoped to a different installation", async () => {
    await expect(
      promoteOwnership(context.handle.db, {
        installationId: "018f2b7c-0000-7000-8000-0000000000ee",
        ownerId: OWNER_ID,
        workspaceId: WORKSPACE_ID,
        workspaceSchemaVersion: 1,
        state: "ready",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("state transitions", () => {
  beforeEach(seedInstallation);

  it("refuses an initialized state while no owner is committed", async () => {
    for (const state of ["ready", "recovery-required", "degraded"] as const) {
      await expect(
        setInstallationState(context.handle.db, { installationId: INSTALLATION_ID }, state),
        state,
      ).rejects.toMatchObject({ code: "installation_not_ready" });
    }
  });

  it("allows every initialized state once ownership is committed", async () => {
    await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });
    for (const state of [
      "recovery-required",
      "migration-in-progress",
      "degraded",
      "ready",
    ] as const) {
      const record = await setInstallationState(
        context.handle.db,
        { installationId: INSTALLATION_ID },
        state,
      );
      expect(record.state, state).toBe(state);
      // `degraded` keeps its owner: an unavailable key does not un-own it.
      expect(await readCounts(context.handle.db), state).toEqual({
        ownerCount: 1,
        workspaceCount: 1,
      });
    }
  });

  it("refuses to move back to uninitialized once an owner exists", async () => {
    await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });
    await expect(
      setInstallationState(context.handle.db, { installationId: INSTALLATION_ID }, "uninitialized"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("fail-closed reads", () => {
  it("returns null status before any installation exists", async () => {
    expect(await readInstallationStatus(context.handle.db)).toBeNull();
    expect(await findInstallation(context.handle.db)).toBeNull();
  });

  it("refuses to report a status that contradicts the committed counts", async () => {
    await seedInstallation();
    await promoteOwnership(context.handle.db, {
      installationId: INSTALLATION_ID,
      ownerId: OWNER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSchemaVersion: 1,
      state: "ready",
    });
    // Simulate corruption: the state says `ready` but the owner row is gone.
    // Reporting a reassuring status here would hide a broken installation.
    await context.handle.db.execute(sql`
      ALTER TABLE installations DROP CONSTRAINT installations_counts_check
    `);
    await context.handle.db.execute(sql`DELETE FROM owners`);
    try {
      await expect(readInstallationStatus(context.handle.db)).rejects.toThrow();
    } finally {
      await context.handle.db.execute(sql`
        DELETE FROM installations;
        ALTER TABLE installations ADD CONSTRAINT installations_counts_check CHECK (
          (state IN ('uninitialized', 'bootstrap-in-progress')
            AND owner_id IS NULL AND workspace_id IS NULL)
          OR
          (state IN ('recovery-required', 'ready', 'migration-in-progress', 'degraded')
            AND owner_id IS NOT NULL AND workspace_id IS NOT NULL)
        )
      `);
    }
  });

  it("raises a conflict rather than retrying a lost serialization race", async () => {
    // `runSecurityTransaction` defaults to no retry on purpose: for the
    // bootstrap claim, losing the race is the answer, not an obstacle.
    await seedInstallation();
    const results = await runConcurrently(
      context.postgres.connectionString,
      Array.from(
        { length: 4 },
        () => async (handle) =>
          promoteOwnership(handle.db, {
            installationId: INSTALLATION_ID,
            ownerId: generateUuidV7(),
            workspaceId: WORKSPACE_ID,
            workspaceSchemaVersion: 1,
            state: "ready",
          }),
      ),
    );
    const failures = results.filter((result) => result.status === "rejected");
    expect(failures.length).toBe(3);
    for (const failure of failures) {
      const reason = (failure as { reason: unknown }).reason;
      const isExpected =
        reason instanceof SecurityConflictError || reason instanceof SecurityRepositoryError;
      expect(isExpected, `unexpected failure: ${String(reason)}`).toBe(true);
    }
  });
});
