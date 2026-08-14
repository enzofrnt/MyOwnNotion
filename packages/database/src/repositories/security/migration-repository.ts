/**
 * Migration persistence (T095, US6, FR-028, FR-029).
 *
 * The row this module owns is the answer to one question an operator will ask
 * at the worst possible moment: **is my plaintext still there?**
 *
 * Everything is arranged so the answer cannot be wrong.
 *
 * **The advance is conditional in SQL, not checked in TypeScript.** Every
 * transition includes the state it expects in its `WHERE` clause and reports
 * whether a row moved. Two processes resuming the same migration — which is
 * exactly what happens when a container restarts under a supervisor — cannot
 * both advance a stage: the second one updates zero rows and is told so. A
 * read-then-write, however carefully guarded in the application, has a window
 * between the two where both see the same state.
 *
 * **The retention flag is released in its own statement, gated on the state.**
 * The database also carries a check constraint saying plaintext may only be
 * released at `scrub-plaintext` or later, so a bug here is refused by the
 * schema rather than committed.
 *
 * **Nothing deletes a migration row.** It outlives its own completion, because
 * "this installation was migrated, on this date, with these counts" is the
 * evidence a later operator needs and the only record that the plaintext was
 * ever there.
 */

import type { MigrationState } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { encryptionMigrations } from "../../schema/security/index.ts";

type Executor = Database | Transaction;

export class MigrationRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MigrationRepositoryError";
    this.code = code;
  }
}

export interface MigrationRecord {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly state: MigrationState;
  /** Whether the plaintext source is still on disk. */
  readonly sourceRetained: boolean;
  readonly sourceCount: number;
  readonly destinationCount: number;
  readonly sourceDigest: string | null;
  readonly destinationDigest: string | null;
  readonly identityDigest: string | null;
  readonly cursor: string;
  readonly lastSafeCheckpointId: string | null;
}

type Row = typeof encryptionMigrations.$inferSelect;

function toRecord(row: Row): MigrationRecord {
  return {
    id: row.id,
    installationId: row.installationId,
    workspaceId: row.workspaceId,
    state: row.state as MigrationState,
    // Stored as text, exposed as a boolean. The column is text because the
    // check constraint compares it against the state in SQL; every consumer
    // above this line asks a yes-or-no question and should not have to know
    // that.
    sourceRetained: row.sourceRetained === "true",
    sourceCount: row.sourceCount,
    destinationCount: row.destinationCount,
    sourceDigest: row.sourceDigest,
    destinationDigest: row.destinationDigest,
    identityDigest: row.identityDigest,
    cursor: row.cursor,
    lastSafeCheckpointId: row.lastSafeCheckpointId,
  };
}

export async function findMigration(
  executor: Executor,
  installationId: string,
): Promise<MigrationRecord | null> {
  const rows = await executor
    .select()
    .from(encryptionMigrations)
    .where(eq(encryptionMigrations.installationId, installationId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

/**
 * Starts a migration, or returns the one already running.
 *
 * Idempotent by the unique index rather than by a prior lookup. Two processes
 * starting at once must not produce two migrations of the same installation:
 * each would capture its own boundary, and records between the two boundaries
 * would belong to both and be backfilled twice — or, worse, be scrubbed by one
 * while the other still needed them.
 */
export async function startMigration(
  tx: Transaction,
  input: {
    id: string;
    installationId: string;
    workspaceId: string;
    sourceSchemaVersion: number;
    destinationSchemaVersion: number;
    now: Date;
  },
): Promise<MigrationRecord> {
  const inserted = await tx
    .insert(encryptionMigrations)
    .values({
      id: input.id,
      installationId: input.installationId,
      workspaceId: input.workspaceId,
      sourceSchemaVersion: input.sourceSchemaVersion,
      destinationSchemaVersion: input.destinationSchemaVersion,
      state: "prepare-destinations",
      sourceRetained: "true",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: encryptionMigrations.installationId })
    .returning();

  const row = inserted[0];
  if (row !== undefined) {
    return toRecord(row);
  }
  const existing = await findMigration(tx, input.installationId);
  if (existing === null) {
    throw new MigrationRepositoryError(
      "internal_error",
      "the migration was neither inserted nor found",
    );
  }
  return existing;
}

/**
 * Advances one stage, refusing if the migration is not where the caller thinks.
 *
 * The expected state is part of the `WHERE` clause, so the check and the write
 * are one statement. Returns false rather than throwing: a losing racer is an
 * ordinary outcome under a supervisor that restarted the process, not an
 * error, and the caller usually wants to re-read and carry on.
 *
 * The ordering itself is not decided here — `assertAdvance` in the domain owns
 * that, and this refuses to be a second place where it is stated.
 */
export async function advanceMigration(
  tx: Transaction,
  input: {
    migrationId: string;
    expectedState: MigrationState;
    nextState: MigrationState;
    now: Date;
    cursor?: string;
    sourceCount?: number;
    destinationCount?: number;
    sourceDigest?: string;
    destinationDigest?: string;
    identityDigest?: string;
    lastSafeCheckpointId?: string;
  },
): Promise<boolean> {
  const rows = await tx
    .update(encryptionMigrations)
    .set({
      state: input.nextState,
      updatedAt: input.now,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.sourceCount === undefined ? {} : { sourceCount: input.sourceCount }),
      ...(input.destinationCount === undefined ? {} : { destinationCount: input.destinationCount }),
      ...(input.sourceDigest === undefined ? {} : { sourceDigest: input.sourceDigest }),
      ...(input.destinationDigest === undefined
        ? {}
        : { destinationDigest: input.destinationDigest }),
      ...(input.identityDigest === undefined ? {} : { identityDigest: input.identityDigest }),
      ...(input.lastSafeCheckpointId === undefined
        ? {}
        : { lastSafeCheckpointId: input.lastSafeCheckpointId }),
    })
    .where(
      and(
        eq(encryptionMigrations.id, input.migrationId),
        eq(encryptionMigrations.state, input.expectedState),
      ),
    )
    .returning({ id: encryptionMigrations.id });
  return rows.length > 0;
}

/**
 * Records the capture boundary.
 *
 * Its own function rather than a parameter on the advance, because it is the
 * one value the rest of the migration is measured against: everything before
 * it is the backfill's to copy, everything after it is the encrypted path's to
 * write. Setting it as a side effect of a stage change would make it easy to
 * change a stage and forget it, and a migration with no boundary silently
 * treats every record as new.
 */
export async function recordCaptureBoundary(
  tx: Transaction,
  input: { migrationId: string; cursor: string; sourceCount: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(encryptionMigrations)
    .set({ cursor: input.cursor, sourceCount: input.sourceCount, updatedAt: input.now })
    .where(
      and(
        eq(encryptionMigrations.id, input.migrationId),
        eq(encryptionMigrations.state, "capture-boundary"),
      ),
    )
    .returning({ id: encryptionMigrations.id });
  return rows.length > 0;
}

/**
 * Releases the plaintext source. Irreversible, and refused before the scrub.
 *
 * The state condition is in the `WHERE` clause *and* in a check constraint on
 * the table. That duplication is deliberate: this is the statement that
 * declares an owner's only copy expendable, and a bug that got past the
 * application should still be refused by the database.
 */
export async function releasePlaintextSource(
  tx: Transaction,
  input: { migrationId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(encryptionMigrations)
    .set({ sourceRetained: "false", updatedAt: input.now })
    .where(
      and(
        eq(encryptionMigrations.id, input.migrationId),
        eq(encryptionMigrations.state, "scrub-plaintext"),
      ),
    )
    .returning({ id: encryptionMigrations.id });
  return rows.length > 0;
}

/**
 * Marks a migration failed from wherever it is.
 *
 * Unconditional on the current state, unlike every other transition here: a
 * fault can arrive at any stage, and a failure that refused because the row
 * had moved would leave a migration that is broken and says it is running.
 */
export async function failMigration(
  tx: Transaction,
  input: { migrationId: string; now: Date },
): Promise<void> {
  await tx
    .update(encryptionMigrations)
    .set({ state: "failed", updatedAt: input.now })
    .where(eq(encryptionMigrations.id, input.migrationId));
}
