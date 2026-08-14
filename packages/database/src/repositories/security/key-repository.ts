/**
 * Key-hierarchy persistence (T055, feature 002).
 *
 * Rows here hold *wrapped* key material and references to external secrets.
 * No function in this module accepts or returns an unwrapped key, and the one
 * column that names the deployment secret holds a reference rather than the
 * secret — a dump of this database must not contain anything that decrypts it.
 *
 * The uniqueness rules are the interesting part, and they are enforced by
 * partial indexes rather than by application checks: exactly one active root
 * key per workspace, exactly one current generation, exactly one current
 * wrapping-key version. Two of any of those would mean records written under
 * one are unreadable under the other, and no amount of careful calling
 * prevents a race that an index does.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import {
  dataKeyGenerations,
  workspaceRootKeys,
  wrappingKeyVersions,
} from "../../schema/security/index.ts";

type Executor = Database | Transaction;

export interface WrappingKeyVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly externalSecretReference: string;
  readonly state: string;
}

export async function findCurrentWrappingKeyVersion(
  executor: Executor,
  installationId: string,
): Promise<WrappingKeyVersionRecord | null> {
  const rows = await executor
    .select()
    .from(wrappingKeyVersions)
    .where(
      and(
        eq(wrappingKeyVersions.installationId, installationId),
        eq(wrappingKeyVersions.state, "current"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        version: row.version,
        externalSecretReference: row.externalSecretReference,
        state: row.state,
      };
}

export interface InsertWrappingKeyVersionInput {
  readonly id: string;
  readonly installationId: string;
  readonly version: number;
  /** A reference to the mounted secret. Never the secret bytes. */
  readonly externalSecretReference: string;
  readonly algorithm: string;
  readonly createdAt: Date;
  /**
   * Defaults to `current`. A rotation inserts its target as `pending`, so the
   * rewrapped rows have something to reference before the version is the one
   * new work uses.
   */
  readonly state?: "current" | "pending";
}

export async function insertWrappingKeyVersion(
  tx: Executor,
  input: InsertWrappingKeyVersionInput,
): Promise<WrappingKeyVersionRecord> {
  const state = input.state ?? "current";
  await tx.insert(wrappingKeyVersions).values({
    id: input.id,
    installationId: input.installationId,
    version: input.version,
    externalSecretReference: input.externalSecretReference,
    algorithm: input.algorithm,
    state,
    createdAt: input.createdAt,
  });
  return {
    id: input.id,
    version: input.version,
    externalSecretReference: input.externalSecretReference,
    state,
  };
}

/**
 * The version a rotation is rewrapping towards, if one is in flight.
 *
 * Derived from the rows rather than from the operation, and that distinction
 * matters after a failure. A failed operation is no longer "running", so
 * looking for one would report nothing in flight — while half the root keys
 * are already rewrapped under a version that does exist. Starting a fresh
 * rotation from there would target a *third* version and try to unwrap the
 * already-rewrapped rows with the old key, which cannot open them.
 *
 * The `pending` row is what says "a rotation towards this version is
 * unfinished", whether the attempt that created it failed, crashed, or is
 * still going.
 */
export async function findPendingWrappingKeyVersion(
  executor: Executor,
  installationId: string,
): Promise<WrappingKeyVersionRecord | null> {
  const rows = await executor
    .select()
    .from(wrappingKeyVersions)
    .where(
      and(
        eq(wrappingKeyVersions.installationId, installationId),
        eq(wrappingKeyVersions.state, "pending"),
      ),
    )
    .orderBy(wrappingKeyVersions.version)
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        version: row.version,
        externalSecretReference: row.externalSecretReference,
        state: row.state,
      };
}

/** A specific version by number, whatever state it is in. */
export async function findWrappingKeyVersion(
  executor: Executor,
  input: { installationId: string; version: number },
): Promise<WrappingKeyVersionRecord | null> {
  const rows = await executor
    .select()
    .from(wrappingKeyVersions)
    .where(
      and(
        eq(wrappingKeyVersions.installationId, input.installationId),
        eq(wrappingKeyVersions.version, input.version),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        version: row.version,
        externalSecretReference: row.externalSecretReference,
        state: row.state,
      };
}

/**
 * Promotes a `pending` version to `current`, retiring the one it replaces.
 *
 * Both updates in one call, and the demotion first, because the partial unique
 * index permits exactly one `current` row: promoting before demoting would be
 * rejected by the database. That rejection is the index doing its job — it is
 * the reason an installation can never be in a state where two versions each
 * claim to be the one new work uses.
 *
 * The old version becomes `previous` rather than `revoked`. It can still
 * unwrap nothing at this point — every root key has been rewrapped — but the
 * row is the record that the rotation happened, and an operator reading it
 * later needs to see a retired version, not a repudiated one.
 */
export async function promoteWrappingKeyVersion(
  tx: Transaction,
  input: { installationId: string; fromVersionId: string; toVersionId: string; now: Date },
): Promise<void> {
  await tx
    .update(wrappingKeyVersions)
    .set({ state: "previous", revokedAt: input.now })
    .where(
      and(
        eq(wrappingKeyVersions.installationId, input.installationId),
        eq(wrappingKeyVersions.id, input.fromVersionId),
      ),
    );
  await tx
    .update(wrappingKeyVersions)
    .set({ state: "current" })
    .where(
      and(
        eq(wrappingKeyVersions.installationId, input.installationId),
        eq(wrappingKeyVersions.id, input.toVersionId),
      ),
    );
}

export interface RootKeyRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly wrappingKeyVersionId: string;
  /** Wrapped under the deployment key. Useless without the mounted secret. */
  readonly wrappedRootKey: string;
  readonly rootKeyVersion: number;
  readonly state: string;
}

export async function findActiveRootKey(
  executor: Executor,
  workspaceId: string,
): Promise<RootKeyRecord | null> {
  const rows = await executor
    .select()
    .from(workspaceRootKeys)
    .where(
      and(eq(workspaceRootKeys.workspaceId, workspaceId), eq(workspaceRootKeys.state, "active")),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        workspaceId: row.workspaceId,
        wrappingKeyVersionId: row.wrappingKeyVersionId,
        wrappedRootKey: row.wrappedRootKey,
        rootKeyVersion: row.rootKeyVersion,
        state: row.state,
      };
}

/**
 * The active root keys still wrapped under something other than `versionId`.
 *
 * This is the work list of a wrapping-key rotation, and it is deliberately
 * derived from the rows rather than from a checkpoint. A checkpoint says what
 * a previous attempt *believed* it had done; this says what the database
 * actually holds. When the two disagree — a crash between the rewrap and its
 * checkpoint — the rows are right, and re-running against them converges.
 *
 * Revoked and superseded root keys are excluded: rewrapping a key that is no
 * longer used to open anything would extend the life of material the
 * installation has already decided to stop trusting.
 */
export async function listRootKeysToRewrap(
  executor: Executor,
  input: {
    installationId: string;
    /**
     * The version being rewrapped *towards*. `null` before that version row
     * exists — a rotation that has not started yet — in which case every
     * active root key is still to be rewrapped.
     */
    wrappingKeyVersionId: string | null;
  },
): Promise<readonly { rootKeyId: string; workspaceId: string }[]> {
  const rows = await executor
    .select({
      id: workspaceRootKeys.id,
      workspaceId: workspaceRootKeys.workspaceId,
    })
    .from(workspaceRootKeys)
    .where(
      and(
        eq(workspaceRootKeys.installationId, input.installationId),
        eq(workspaceRootKeys.state, "active"),
        ...(input.wrappingKeyVersionId === null
          ? []
          : [sql`${workspaceRootKeys.wrappingKeyVersionId} <> ${input.wrappingKeyVersionId}`]),
      ),
    );
  return rows.map((row) => ({ rootKeyId: row.id, workspaceId: row.workspaceId }));
}

export interface InsertRootKeyInput {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly wrappingKeyVersionId: string;
  readonly wrappedRootKey: string;
  readonly rootKeyVersion: number;
  readonly createdAt: Date;
}

export async function insertRootKey(tx: Executor, input: InsertRootKeyInput): Promise<void> {
  await tx.insert(workspaceRootKeys).values({
    id: input.id,
    installationId: input.installationId,
    workspaceId: input.workspaceId,
    wrappingKeyVersionId: input.wrappingKeyVersionId,
    wrappedRootKey: input.wrappedRootKey,
    rootKeyVersion: input.rootKeyVersion,
    state: "active",
    createdAt: input.createdAt,
  });
}

export interface GenerationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly generation: number;
  /** Wrapped under the workspace root key. */
  readonly wrappedKeyMaterial: string;
  readonly state: "current" | "decrypt-only" | "revoked";
  readonly recordCount: number;
  readonly chunkCount: number;
}

type GenerationRow = typeof dataKeyGenerations.$inferSelect;

function toGeneration(row: GenerationRow): GenerationRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    generation: row.generation,
    wrappedKeyMaterial: row.wrappedKeyMaterial,
    state: row.state as GenerationRecord["state"],
    recordCount: Number(row.recordCount),
    chunkCount: Number(row.chunkCount),
  };
}

export async function findCurrentGeneration(
  executor: Executor,
  workspaceId: string,
): Promise<GenerationRecord | null> {
  const rows = await executor
    .select()
    .from(dataKeyGenerations)
    .where(
      and(eq(dataKeyGenerations.workspaceId, workspaceId), eq(dataKeyGenerations.state, "current")),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toGeneration(row);
}

/**
 * Finds a generation by number, whatever its state.
 *
 * State is returned rather than filtered, because the caller's decision
 * depends on it: a read may use `decrypt-only`, a write may not, and a
 * `revoked` generation is refused for both. Filtering here would collapse
 * "revoked" into "absent" and lose the distinction the audit trail needs.
 */
export async function findGeneration(
  executor: Executor,
  workspaceId: string,
  generation: number,
): Promise<GenerationRecord | null> {
  const rows = await executor
    .select()
    .from(dataKeyGenerations)
    .where(
      and(
        eq(dataKeyGenerations.workspaceId, workspaceId),
        eq(dataKeyGenerations.generation, generation),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toGeneration(row);
}

export interface InsertGenerationInput {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly generation: number;
  readonly wrappedKeyMaterial: string;
  readonly createdAt: Date;
}

export async function insertGeneration(tx: Executor, input: InsertGenerationInput): Promise<void> {
  await tx.insert(dataKeyGenerations).values({
    id: input.id,
    installationId: input.installationId,
    workspaceId: input.workspaceId,
    generation: input.generation,
    wrappedKeyMaterial: input.wrappedKeyMaterial,
    state: "current",
    createdAt: input.createdAt,
  });
}

/**
 * Retires a generation to `decrypt-only`.
 *
 * Not `revoked`: records written under it must stay readable, or a rotation
 * would destroy everything written before it. Revocation is a separate,
 * deliberate act for a generation believed compromised.
 */
export async function retireGeneration(
  tx: Transaction,
  workspaceId: string,
  generation: number,
): Promise<void> {
  await tx
    .update(dataKeyGenerations)
    .set({ state: "decrypt-only" })
    .where(
      and(
        eq(dataKeyGenerations.workspaceId, workspaceId),
        eq(dataKeyGenerations.generation, generation),
        eq(dataKeyGenerations.state, "current"),
      ),
    );
}

/** Counts written under a generation, for rotation progress reporting. */
export async function incrementGenerationCounts(
  executor: Executor,
  input: { workspaceId: string; generation: number; records?: number; chunks?: number },
): Promise<void> {
  await executor
    .update(dataKeyGenerations)
    .set({
      recordCount: sql`${dataKeyGenerations.recordCount} + ${input.records ?? 0}`,
      chunkCount: sql`${dataKeyGenerations.chunkCount} + ${input.chunks ?? 0}`,
    })
    .where(
      and(
        eq(dataKeyGenerations.workspaceId, input.workspaceId),
        eq(dataKeyGenerations.generation, input.generation),
      ),
    );
}

/**
 * Replaces the wrapper around a workspace root key.
 *
 * The root key itself is unchanged — only what encrypts it. That is the whole
 * economy of a wrapping-key rotation: one row per workspace, and no protected
 * record or file chunk is touched.
 */
export async function updateWrappedRootKey(
  tx: Transaction,
  input: {
    rootKeyId: string;
    wrappedRootKey: string;
    wrappingKeyVersionId: string;
    /**
     * The rotation that rewrapped this row.
     *
     * Recorded on the row itself so a half-finished rotation is visible in the
     * data rather than only in its checkpoints: an operator can ask which
     * workspaces still carry the old wrapper by asking which rows lack this.
     */
    rewrapOperationId?: string;
  },
): Promise<void> {
  await tx
    .update(workspaceRootKeys)
    .set({
      wrappedRootKey: input.wrappedRootKey,
      wrappingKeyVersionId: input.wrappingKeyVersionId,
      ...(input.rewrapOperationId === undefined
        ? {}
        : { rewrapOperationId: input.rewrapOperationId }),
    })
    .where(eq(workspaceRootKeys.id, input.rootKeyId));
}
