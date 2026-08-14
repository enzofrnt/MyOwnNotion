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
}

export async function insertWrappingKeyVersion(
  tx: Executor,
  input: InsertWrappingKeyVersionInput,
): Promise<WrappingKeyVersionRecord> {
  await tx.insert(wrappingKeyVersions).values({
    id: input.id,
    installationId: input.installationId,
    version: input.version,
    externalSecretReference: input.externalSecretReference,
    algorithm: input.algorithm,
    state: "current",
    createdAt: input.createdAt,
  });
  return {
    id: input.id,
    version: input.version,
    externalSecretReference: input.externalSecretReference,
    state: "current",
  };
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
