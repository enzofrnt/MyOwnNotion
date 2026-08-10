/**
 * Disposable-installation database helper for security integration suites
 * (T003, feature 002).
 *
 * Extends the feature-001 helper in `./db.ts` with what security work needs:
 *
 *   - an installation that starts empty, so `ownerCount=0` / `workspaceCount=0`
 *     is the observed committed state and not an assumption;
 *   - a mounted deployment-key fixture on disk, so key-unavailable and
 *     invalid-key paths fail closed against a real file;
 *   - a canonical-identity snapshot taken from the live database, so a
 *     security operation can be proven not to have rewritten feature-001 IDs;
 *   - serializable-transaction and concurrency utilities, because the
 *     bootstrap claim, the ownership promotion, and rotation all depend on
 *     `SERIALIZABLE` conflicts being observable rather than retried away.
 */

import { createDatabase, type DatabaseHandle } from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import {
  type CanonicalIdentitySnapshot,
  type ControlledClock,
  createControlledClock,
  createDisposableInstallation,
  createFaultInjector,
  createMountedDeploymentKey,
  type DisposableInstallation,
  diffCanonicalIdentities,
  type FaultInjector,
  type MountedSecret,
  type MountedSecretDefect,
  snapshotCanonicalIdentities,
} from "../../../../tests/fixtures/security.ts";

export interface SecurityIntegrationContext {
  readonly postgres: DisposablePostgres;
  readonly handle: DatabaseHandle;
  readonly installation: DisposableInstallation;
  readonly deploymentKey: MountedSecret;
  readonly clock: ControlledClock;
  readonly faults: FaultInjector;
  /** Committed owner/workspace counts, read fresh from the database. */
  committedCounts(): Promise<{ ownerCount: number; workspaceCount: number }>;
  /** Snapshot of the canonical feature-001 identities currently persisted. */
  snapshotIdentities(): Promise<CanonicalIdentitySnapshot>;
  /** Differences between a previous snapshot and the current state. */
  identityDrift(before: CanonicalIdentitySnapshot): Promise<string[]>;
  close(): Promise<void>;
}

export interface SecurityIntegrationOptions {
  readonly deploymentKeyDefect?: MountedSecretDefect;
  readonly clockOrigin?: Date;
}

/**
 * Deliberately does NOT call `getOrCreateWorkspace`: a security trial must
 * observe an empty installation. Suites that need the canonical workspace
 * present create it explicitly, so the `0/0` → `1/1` transition stays visible.
 */
export async function createSecurityIntegrationContext(
  options: SecurityIntegrationOptions = {},
): Promise<SecurityIntegrationContext> {
  const postgres = await startMigratedPostgres();
  const handle = createDatabase(postgres.connectionString);
  const installation = createDisposableInstallation();
  const deploymentKey = createMountedDeploymentKey(
    installation,
    options.deploymentKeyDefect ?? "none",
  );

  async function countRows(table: string): Promise<number> {
    // `to_regclass` returns NULL for a table the security migration has not
    // created yet, so a suite running before T019 reads 0 rather than failing
    // on an unknown relation.
    const result = await handle.db.execute<{ count: string | null }>(sql`
      SELECT CASE
               WHEN to_regclass(${table}) IS NULL THEN NULL
               ELSE (SELECT count(*)::text FROM ${sql.identifier(table)})
             END AS count
    `);
    const raw = result.rows[0]?.count;
    return raw === null || raw === undefined ? 0 : Number(raw);
  }

  async function listIds(table: string, column: string): Promise<string[]> {
    const result = await handle.db.execute<{ id: string }>(sql`
      SELECT ${sql.identifier(column)}::text AS id
      FROM ${sql.identifier(table)}
      ORDER BY 1
    `);
    return result.rows.map((row) => row.id);
  }

  const context: SecurityIntegrationContext = {
    postgres,
    handle,
    installation,
    deploymentKey,
    clock: createControlledClock(options.clockOrigin),
    faults: createFaultInjector(),

    committedCounts: async () => ({
      ownerCount: await countRows("owners"),
      workspaceCount: await countRows("workspaces"),
    }),

    snapshotIdentities: async () => {
      const workspaceIds = await listIds("workspaces", "id");
      return snapshotCanonicalIdentities({
        workspaceId: workspaceIds[0] ?? "",
        itemIds: await listIds("items", "id"),
        revisionIds: await listIds("revisions", "id"),
        fileContentIds: await listIds("file_contents", "id"),
      });
    },

    identityDrift: async (before) =>
      diffCanonicalIdentities(before, await context.snapshotIdentities()),

    close: async () => {
      installation.cleanup();
      await handle.close();
      await postgres.stop();
    },
  };

  return context;
}

/**
 * Runs `operations` against independent connections at the same time. Used by
 * the bootstrap-claim and rotation suites: exactly one attempt must win and the
 * losers must fail loudly, never silently produce a second owner.
 */
export async function runConcurrently<T>(
  connectionString: string,
  operations: ReadonlyArray<(handle: DatabaseHandle) => Promise<T>>,
): Promise<Array<{ status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown }>> {
  const handles = operations.map(() => createDatabase(connectionString));
  try {
    const settled = await Promise.allSettled(
      operations.map(async (operation, index) => {
        const handle = handles[index];
        if (handle === undefined) {
          throw new Error("runConcurrently: missing database handle");
        }
        return operation(handle);
      }),
    );
    return settled.map((result) =>
      result.status === "fulfilled"
        ? { status: "fulfilled" as const, value: result.value }
        : { status: "rejected" as const, reason: result.reason },
    );
  } finally {
    await Promise.all(handles.map(async (handle) => handle.close()));
  }
}

/** PostgreSQL raises 40001 when a `SERIALIZABLE` transaction cannot commit. */
export function isSerializationFailure(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    (reason as { code?: unknown }).code === "40001"
  );
}

/** PostgreSQL raises 23505 when a unique index rejects a second singleton row. */
export function isUniqueViolation(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason &&
    (reason as { code?: unknown }).code === "23505"
  );
}
