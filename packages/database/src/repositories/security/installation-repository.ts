/**
 * Singleton installation repository (T020, feature 002).
 *
 * The installation row is the anchor for every other security row and the
 * authority on the committed `ownerCount` / `workspaceCount` pair.
 *
 * Two rules are load-bearing here:
 *
 *   1. **Counts are read, never asserted.** `readCounts` counts the actual
 *      `owners` and `workspaces` rows rather than trusting
 *      `installations.owner_id`. A status endpoint that reported the column
 *      would report `1/1` for a promotion that half-committed; counting the
 *      rows makes the claim falsifiable, which is the point of SC-001.
 *   2. **The promotion is one transaction, and the database is the guard.**
 *      `installations_counts_check` refuses a half-committed row and
 *      `owners_installation_unique` refuses a second owner, so a concurrent
 *      claim fails on a constraint rather than on an application check that a
 *      race could slip past.
 */

import {
  assertInstallationCounts,
  type InstallationCounts,
  type InstallationState,
  isInitializedState,
} from "@myownnotion/domain";
import { count, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { owners, workspaces } from "../../schema/index.ts";
import { installations } from "../../schema/security/index.ts";
import {
  isUniqueViolation,
  SecurityRepositoryError,
  type SecurityScope,
} from "./repository-types.ts";
import { runSecurityRead, runSecurityTransaction } from "./transaction.ts";

export interface InstallationRecord {
  readonly id: string;
  readonly sourceLineageId: string;
  readonly state: InstallationState;
  readonly ownerId: string | null;
  readonly workspaceId: string | null;
  readonly schemaVersion: number;
  readonly applicationVersion: string | null;
  readonly previousApplicationVersion: string | null;
  readonly previousBackupId: string | null;
}

export interface InstallationStatus extends InstallationRecord {
  readonly counts: InstallationCounts;
}

type Executor = Database | Transaction;

function toRecord(row: typeof installations.$inferSelect): InstallationRecord {
  return {
    id: row.id,
    sourceLineageId: row.sourceLineageId,
    state: row.state as InstallationState,
    ownerId: row.ownerId,
    workspaceId: row.workspaceId,
    schemaVersion: row.schemaVersion,
    applicationVersion: row.applicationVersion,
    previousApplicationVersion: row.previousApplicationVersion,
    previousBackupId: row.previousBackupId,
  };
}

/** Records the first build observed after the version columns were introduced. */
export async function recordInitialApplicationVersion(
  executor: Executor,
  input: { readonly installationId: string; readonly applicationVersion: string },
): Promise<void> {
  await executor
    .update(installations)
    .set({ applicationVersion: input.applicationVersion, updatedAt: new Date() })
    .where(eq(installations.id, input.installationId));
}

/** Commits update provenance only after the guarded migration has succeeded. */
export async function recordApplicationUpdate(
  executor: Executor,
  input: {
    readonly installationId: string;
    readonly from: string;
    readonly to: string;
    readonly backupId: string;
    readonly schemaVersion: number;
  },
): Promise<void> {
  await executor
    .update(installations)
    .set({
      applicationVersion: input.to,
      previousApplicationVersion: input.from,
      previousBackupId: input.backupId,
      schemaVersion: input.schemaVersion,
      updatedAt: new Date(),
    })
    .where(eq(installations.id, input.installationId));
}

/** Reads the singleton, or null before the installation row exists. */
export async function findInstallation(executor: Executor): Promise<InstallationRecord | null> {
  const rows = await executor.select().from(installations).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function requireInstallation(executor: Executor): Promise<InstallationRecord> {
  const record = await findInstallation(executor);
  if (record === null) {
    throw new SecurityRepositoryError(
      "installation_not_ready",
      "no installation row exists; the installation has never been initialized",
    );
  }
  return record;
}

/**
 * Counts committed owner and *bound* workspace rows.
 *
 * `ownerCount` counts rows in `owners`, never `installations.owner_id`: the
 * column records intent, the rows record what actually committed, and only the
 * second detects a broken promotion.
 *
 * `workspaceCount` counts workspaces the installation is actually bound to,
 * via a join rather than the column alone. That distinction matters because
 * feature 001 creates the canonical workspace eagerly at API startup, long
 * before any bootstrap: counting raw `workspaces` rows would report
 * `workspaceCount = 1` on a pristine installation and make the `0/0` invariant
 * unsatisfiable. A workspace nobody owns is not a committed workspace.
 *
 * The join keeps the check falsifiable in both directions: a binding that
 * points at a workspace which does not exist counts as 0 and fails the
 * invariant, exactly as a missing binding does.
 */
export async function readCounts(executor: Executor): Promise<InstallationCounts> {
  const [ownerRows] = await executor.select({ value: count() }).from(owners);
  const [workspaceRows] = await executor
    .select({ value: count() })
    .from(workspaces)
    .innerJoin(installations, eq(installations.workspaceId, workspaces.id));
  const ownerCount = ownerRows?.value ?? 0;
  const workspaceCount = workspaceRows?.value ?? 0;

  if (ownerCount > 1 || workspaceCount > 1) {
    // Unreachable through the constraints; if it ever happens, refusing is far
    // better than serving a workspace whose ownership is ambiguous.
    throw new SecurityRepositoryError(
      "internal_error",
      `singleton invariant broken: observed ownerCount=${ownerCount}, workspaceCount=${workspaceCount}`,
    );
  }
  return {
    ownerCount: ownerCount as 0 | 1,
    workspaceCount: workspaceCount as 0 | 1,
  };
}

/**
 * The status a caller may show: state plus the counts read from the rows.
 *
 * Verifies the pair agrees with the state before returning. Disagreement means
 * the installation is in a shape the design says cannot exist, so it fails
 * closed rather than reporting a reassuring but wrong status.
 */
export async function readInstallationStatus(db: Database): Promise<InstallationStatus | null> {
  return runSecurityRead(db, async (tx) => {
    const record = await findInstallation(tx);
    if (record === null) {
      return null;
    }
    const counts = await readCounts(tx);
    assertInstallationCounts(record.state, counts);
    return { ...record, counts };
  });
}

export interface CreateInstallationInput {
  readonly id: string;
  readonly sourceLineageId: string;
  readonly schemaVersion: number;
}

/**
 * Creates the uninitialized installation. Idempotent by design: a second
 * concurrent caller receives the existing row rather than an error, because
 * two clients opening the first-run page is normal, not a conflict.
 */
export async function createInstallation(
  db: Database,
  input: CreateInstallationInput,
): Promise<InstallationRecord> {
  try {
    return await runSecurityTransaction(db, async (tx) => {
      const existing = await findInstallation(tx);
      if (existing !== null) {
        return existing;
      }
      await tx.insert(installations).values({
        id: input.id,
        sourceLineageId: input.sourceLineageId,
        state: "uninitialized",
        schemaVersion: input.schemaVersion,
      });
      return requireInstallation(tx);
    });
  } catch (error) {
    if (isUniqueViolation(error, "installations_singleton_idx")) {
      // Another caller won the race; its row is the installation.
      return requireInstallation(db);
    }
    throw error;
  }
}

/**
 * Moves the installation to a new state, refusing a transition that would
 * contradict the committed counts.
 *
 * A move into an initialized state without an owner and a workspace is
 * rejected by `installations_counts_check`; this pre-check turns that into a
 * named error instead of a raw constraint violation.
 */
export async function setInstallationState(
  db: Database,
  scope: SecurityScope,
  next: InstallationState,
): Promise<InstallationRecord> {
  return runSecurityTransaction(db, async (tx) => {
    const record = await requireInstallation(tx);
    if (record.id !== scope.installationId) {
      throw new SecurityRepositoryError(
        "forbidden",
        "the requested scope does not match this installation",
      );
    }
    const counts = await readCounts(tx);
    if (isInitializedState(next) && counts.ownerCount !== 1) {
      throw new SecurityRepositoryError(
        "installation_not_ready",
        `cannot move to ${next}: no owner is committed (ownerCount=${counts.ownerCount})`,
      );
    }
    if (!isInitializedState(next) && counts.ownerCount !== 0) {
      throw new SecurityRepositoryError(
        "conflict",
        `cannot move back to ${next}: an owner is already committed`,
      );
    }
    await tx
      .update(installations)
      .set({ state: next, updatedAt: new Date() })
      .where(eq(installations.id, record.id));
    return requireInstallation(tx);
  });
}

/**
 * The atomic ownership promotion, in one serializable transaction.
 *
 * Everything commits together or nothing does: the canonical workspace row,
 * the owner row, and the installation's state and bindings. A failure anywhere
 * rolls the whole thing back, so there is no instant at which a partial owner
 * is observable.
 *
 * `workspaceId` is the feature-001 canonical identity. When the workspace row
 * already exists it is bound, never recreated.
 */
export interface PromoteOwnershipInput {
  readonly installationId: string;
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  /** State to land in; `ready` normally, `recovery-required` after adoption. */
  readonly state: Extract<InstallationState, "ready" | "recovery-required">;
}

export async function promoteOwnership(
  db: Database,
  input: PromoteOwnershipInput,
): Promise<InstallationStatus> {
  return runSecurityTransaction(db, async (tx) => {
    const record = await requireInstallation(tx);
    if (record.id !== input.installationId) {
      throw new SecurityRepositoryError(
        "forbidden",
        "the requested scope does not match this installation",
      );
    }

    const before = await readCounts(tx);
    if (before.ownerCount !== 0) {
      // Not an error the owner caused: someone else completed bootstrap first.
      throw new SecurityRepositoryError(
        "conflict",
        "ownership is already committed; this installation has an owner",
      );
    }

    // Bind the canonical workspace, creating it only if bootstrap is the first
    // thing that ever ran. Its ID is never regenerated.
    const existingWorkspace = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (existingWorkspace[0] === undefined) {
      await tx
        .insert(workspaces)
        .values({ id: input.workspaceId, schemaVersion: input.workspaceSchemaVersion });
    }

    await tx.insert(owners).values({
      id: input.ownerId,
      installationId: record.id,
      state: input.state === "ready" ? "active" : "recovery-required",
    });

    await tx
      .update(installations)
      .set({
        state: input.state,
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        updatedAt: new Date(),
      })
      .where(eq(installations.id, record.id));

    const promoted = await requireInstallation(tx);
    const after = await readCounts(tx);
    // Prove the transition rather than assume it: 0/0 in, 1/1 out.
    assertInstallationCounts(promoted.state, after);
    return { ...promoted, counts: after };
  });
}
