/**
 * Protected record storage (T055, feature 002).
 *
 * Payload-bearing fields of feature-001 entities are stored here as sealed
 * envelopes, keyed by the entity's own canonical identifier. The identifier is
 * kept verbatim and in the clear, and that is a deliberate boundary rather
 * than an oversight:
 *
 *   - **Identifiers and routing metadata stay readable.** The hierarchy, the
 *     ordering, the revision lineage, and the relationship graph are how the
 *     application finds anything at all. Encrypting them would mean decrypting
 *     the entire workspace to answer "what is in this folder", which is both
 *     unusable and worse for security — it would put the whole data key in
 *     play for every navigation.
 *   - **Everything a person wrote is sealed.** Titles, bodies, annotations,
 *     file contents, and the properties that carry meaning.
 *
 * The line between the two is recorded in `spec.md` as FR-011, and the tests
 * assert it in both directions: what must be unreadable in the table, and what
 * must still be queryable without a key.
 *
 * **There is no foreign key to the plaintext row.** An envelope must outlive
 * the row a migration will eventually scrub, and a cascade delete from a
 * feature-001 table must never take protected data with it.
 */

import type { EncryptedEnvelope } from "@myownnotion/domain";
// The envelope helpers live behind the `/security` subpath because they need
// `node:crypto`; this package is server-side, so importing them is fine.
import { type EnvelopeBinding, envelopeMatchesBinding } from "@myownnotion/domain/security";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { protectedEnvelopes } from "../../schema/security/index.ts";
import { SecurityRepositoryError } from "./repository-types.ts";

type Executor = Database | Transaction;

export interface ProtectedRecordKey {
  readonly workspaceId: string;
  readonly entityType: string;
  readonly entityId: string;
}

export interface StoredEnvelope {
  readonly envelope: EncryptedEnvelope;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

type EnvelopeRow = typeof protectedEnvelopes.$inferSelect;

function toStored(row: EnvelopeRow): StoredEnvelope {
  return {
    envelope: {
      format: row.format as EncryptedEnvelope["format"],
      algorithm: row.algorithm as EncryptedEnvelope["algorithm"],
      // Carried on the envelope as well as in the row's own columns: the
      // envelope is what gets handed to `openEnvelope`, which rebuilds the AAD
      // from these fields and would otherwise be trusting the caller to supply
      // the identity it is meant to be checking.
      entityType: row.entityType,
      entityId: row.entityId,
      workspaceId: row.workspaceId,
      keyGeneration: row.keyGeneration,
      recordVersion: row.recordVersion,
      salt: row.salt,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
      tag: row.tag,
      aadDigest: row.aadDigest,
    },
    keyGeneration: row.keyGeneration,
    recordVersion: row.recordVersion,
  };
}

export interface WriteEnvelopeInput extends ProtectedRecordKey {
  /** Stable row identity when another table needs to reference this envelope. */
  readonly id?: string;
  readonly installationId: string;
  readonly envelope: EncryptedEnvelope;
  readonly now: Date;
}

/**
 * Writes the envelope for one version of one entity.
 *
 * **Envelopes are versioned, not replaced.** The unique index is on
 * `(entity_type, entity_id, record_version)`, so each record version keeps its
 * own row — which is what lets revision history stay readable after the
 * current version is rewritten. A rewrite of the *same* version replaces that
 * row's ciphertext, and only that row's.
 *
 * `recordVersion` is part of the AAD, so a ciphertext cannot be moved between
 * versions: an old envelope replayed as a newer version fails its tag check
 * rather than silently rolling the record back.
 */
export async function writeProtectedRecord(
  executor: Executor,
  input: WriteEnvelopeInput,
): Promise<string> {
  const rows = await executor
    .insert(protectedEnvelopes)
    .values({
      id: input.id ?? crypto.randomUUID(),
      installationId: input.installationId,
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      keyGeneration: input.envelope.keyGeneration,
      recordVersion: input.envelope.recordVersion,
      format: input.envelope.format,
      algorithm: input.envelope.algorithm,
      salt: input.envelope.salt,
      nonce: input.envelope.nonce,
      ciphertext: input.envelope.ciphertext,
      tag: input.envelope.tag,
      aadDigest: input.envelope.aadDigest,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      // The versioned identity, matching the index. Re-encrypting a record
      // under a new key generation without advancing its version — which is
      // exactly what a rotation does — updates in place.
      target: [
        protectedEnvelopes.entityType,
        protectedEnvelopes.entityId,
        protectedEnvelopes.recordVersion,
      ],
      set: {
        keyGeneration: input.envelope.keyGeneration,
        salt: input.envelope.salt,
        nonce: input.envelope.nonce,
        ciphertext: input.envelope.ciphertext,
        tag: input.envelope.tag,
        aadDigest: input.envelope.aadDigest,
        updatedAt: input.now,
      },
    })
    .returning({ id: protectedEnvelopes.id });
  const row = rows[0];
  if (row === undefined) throw new Error("protected envelope was not written");
  return row.id;
}

/**
 * Reads the current envelope for an entity, or a specific version.
 *
 * Without a version this returns the highest one, which is the record as it
 * stands. Asking for an older version is how history is read, and it is a
 * separate request rather than a filter applied afterwards so that "the
 * current record" and "this old version" cannot be confused by a caller.
 */
export async function readProtectedRecord(
  executor: Executor,
  key: ProtectedRecordKey & { recordVersion?: number },
): Promise<StoredEnvelope | null> {
  const scope =
    key.recordVersion === undefined
      ? and(
          eq(protectedEnvelopes.workspaceId, key.workspaceId),
          eq(protectedEnvelopes.entityType, key.entityType),
          eq(protectedEnvelopes.entityId, key.entityId),
        )
      : and(
          eq(protectedEnvelopes.workspaceId, key.workspaceId),
          eq(protectedEnvelopes.entityType, key.entityType),
          eq(protectedEnvelopes.entityId, key.entityId),
          eq(protectedEnvelopes.recordVersion, key.recordVersion),
        );
  const rows = await executor
    .select()
    .from(protectedEnvelopes)
    .where(scope)
    .orderBy(desc(protectedEnvelopes.recordVersion))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toStored(row);
}

/**
 * Reads many envelopes in one query.
 *
 * A list view needs one envelope per row on screen; issuing a query each would
 * make encryption's cost scale with the page size in round trips rather than
 * in CPU.
 */
export async function readProtectedRecords(
  executor: Executor,
  input: { workspaceId: string; entityType: string; entityIds: readonly string[] },
): Promise<ReadonlyMap<string, StoredEnvelope>> {
  if (input.entityIds.length === 0) {
    return new Map();
  }
  const rows = await executor
    .select()
    .from(protectedEnvelopes)
    .where(
      and(
        eq(protectedEnvelopes.workspaceId, input.workspaceId),
        eq(protectedEnvelopes.entityType, input.entityType),
        inArray(protectedEnvelopes.entityId, [...input.entityIds]),
      ),
    );
  return new Map(rows.map((row) => [row.entityId, toStored(row)]));
}

/**
 * Verifies that a stored envelope is the one this binding asks for.
 *
 * The AAD digest is checked before any attempt to decrypt. A mismatch means
 * the row is not what the caller believes it is — a substituted record, a
 * replayed ciphertext from another entity, a rolled-back version — and the
 * right answer is a refusal, not an attempt that would fail the tag check with
 * a less specific error.
 */
export function assertEnvelopeMatches(stored: StoredEnvelope, binding: EnvelopeBinding): void {
  if (!envelopeMatchesBinding(stored.envelope, binding)) {
    throw new SecurityRepositoryError(
      "protected_read_failed",
      "the stored envelope does not match the record it was read for",
    );
  }
}

/**
 * Removes the envelope for an entity.
 *
 * Used by the scrub step of an encryption migration, and by nothing else. In
 * particular, deleting a feature-001 row does not reach here: the plaintext
 * lifecycle and the protected lifecycle are separate, and a cascade that
 * removed envelopes would destroy the only remaining copy during a migration.
 */
export async function deleteProtectedRecord(
  executor: Executor,
  key: ProtectedRecordKey,
): Promise<void> {
  await executor
    .delete(protectedEnvelopes)
    .where(
      and(
        eq(protectedEnvelopes.workspaceId, key.workspaceId),
        eq(protectedEnvelopes.entityType, key.entityType),
        eq(protectedEnvelopes.entityId, key.entityId),
      ),
    );
}

/** Counts envelopes still written under a generation, for rotation progress. */
export async function countRecordsInGeneration(
  executor: Executor,
  input: { workspaceId: string; keyGeneration: number },
): Promise<number> {
  const rows = await executor
    .select({ entityId: protectedEnvelopes.entityId })
    .from(protectedEnvelopes)
    .where(
      and(
        eq(protectedEnvelopes.workspaceId, input.workspaceId),
        eq(protectedEnvelopes.keyGeneration, input.keyGeneration),
      ),
    );
  return rows.length;
}

/**
 * One batch of envelopes still sealed under a generation, in cursor order.
 *
 * The cursor is the row id, which is unique and totally ordered, so a sweep
 * can resume from exactly where it stopped without a window that skips or
 * repeats a row. Ordering by anything non-unique — a timestamp, an entity id
 * shared across versions — would leave that window open, and on a long
 * rotation "skips a row" means a record left permanently under a generation
 * the operator is trying to retire.
 *
 * Returns identities, not envelopes. The rewrite goes back through the record
 * service so the AAD is rebuilt from the record's own identity rather than
 * copied from the row being replaced; copying it would carry a wrong binding
 * forward intact.
 */
export async function listEntitiesInGeneration(
  executor: Executor,
  input: {
    workspaceId: string;
    keyGeneration: number;
    afterCursor: string;
    limit: number;
  },
): Promise<
  readonly { cursor: string; entityType: string; entityId: string; recordVersion: number }[]
> {
  const rows = await executor
    .select({
      id: protectedEnvelopes.id,
      entityType: protectedEnvelopes.entityType,
      entityId: protectedEnvelopes.entityId,
      recordVersion: protectedEnvelopes.recordVersion,
    })
    .from(protectedEnvelopes)
    .where(
      and(
        eq(protectedEnvelopes.workspaceId, input.workspaceId),
        eq(protectedEnvelopes.keyGeneration, input.keyGeneration),
        ...(input.afterCursor === "" ? [] : [gt(protectedEnvelopes.id, input.afterCursor)]),
      ),
    )
    .orderBy(asc(protectedEnvelopes.id))
    .limit(input.limit);
  return rows.map((row) => ({
    cursor: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    recordVersion: row.recordVersion,
  }));
}
