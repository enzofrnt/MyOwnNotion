/**
 * Sealing and opening protected records (T055/T060, feature 002).
 *
 * The one place the application turns a payload into an envelope and back. It
 * sits between the key hierarchy and the repository so that neither has to
 * know about the other, and so there is exactly one implementation of the
 * read path to audit.
 *
 * **Reads fail closed, always.** A missing key, a revoked generation, a
 * tampered row, a mismatched binding: every one of them refuses. There is no
 * branch that returns a partial record, a placeholder, or the plaintext of a
 * record whose integrity is in doubt. That matters more than it sounds:
 * "return what we could read" is the natural, helpful-looking thing to write,
 * and it is exactly how an attacker who can corrupt one field gets the rest.
 */

import type { Database, Transaction } from "@myownnotion/database";
import {
  assertEnvelopeMatches,
  readProtectedRecord,
  readProtectedRecords,
  SecurityRepositoryError,
  writeProtectedRecord,
} from "@myownnotion/database";
import {
  type EnvelopeBinding,
  EnvelopeDecryptionError,
  openEnvelope,
  sealEnvelope,
} from "@myownnotion/domain/security";
import { type KeyHierarchy, KeyUnavailableError } from "./key-hierarchy.ts";

/**
 * Why an envelope was refused. Reported, never returned to the caller.
 *
 * The two cases are worth telling apart in the audit trail even though the
 * caller sees one opaque refusal. A binding mismatch means the row is not the
 * record it was read for — a substitution, or a ciphertext replayed from
 * another entity. A failed tag means the row *is* the right record but its
 * bytes no longer authenticate. The first suggests someone editing the
 * database; the second suggests corruption or a key that no longer matches.
 */
export type IntegrityFailureReason = "binding-mismatch" | "authentication-failed";

export interface IntegrityFailure {
  readonly reason: IntegrityFailureReason;
  readonly entityType: string;
  readonly entityId: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

export interface ProtectedRecordServiceDeps {
  readonly db: Database;
  readonly keys: KeyHierarchy;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly now: () => Date;
  /**
   * Records a refused envelope.
   *
   * Optional, and awaited before the refusal is raised: an integrity failure
   * that is only ever thrown leaves no trace once the request is answered, and
   * this is exactly the event an operator needs to see. It must not be able to
   * turn a refusal into a different failure, so the caller is expected to
   * swallow its own errors — `AuditService.record` already does.
   */
  readonly reportIntegrityFailure?: (failure: IntegrityFailure) => Promise<void>;
}

export interface ProtectedWrite {
  /** Optional stable envelope row id for records referenced by another table. */
  readonly id?: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly recordVersion: number;
  readonly payload: Uint8Array;
}

export interface ProtectedRead {
  readonly entityType: string;
  readonly entityId: string;
  readonly recordVersion?: number;
}

export class ProtectedRecordService {
  readonly #deps: ProtectedRecordServiceDeps;

  constructor(deps: ProtectedRecordServiceDeps) {
    this.#deps = deps;
  }

  #binding(input: {
    entityType: string;
    entityId: string;
    keyGeneration: number;
    recordVersion: number;
  }): EnvelopeBinding {
    return {
      installationId: this.#deps.installationId,
      workspaceId: this.#deps.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      keyGeneration: input.keyGeneration,
      recordVersion: input.recordVersion,
    };
  }

  /**
   * Seals a payload and stores it.
   *
   * Always under the *current* generation. A write under a retired generation
   * would be a record that a completed rotation had already passed over,
   * leaving data behind a key the rotation was meant to stop using.
   */
  async write(executor: Database | Transaction, input: ProtectedWrite): Promise<string> {
    const dataKey = await this.#deps.keys.dataKey(executor, { writable: true });
    const binding = this.#binding({
      entityType: input.entityType,
      entityId: input.entityId,
      keyGeneration: dataKey.generation,
      recordVersion: input.recordVersion,
    });
    const envelope = sealEnvelope(dataKey.material, binding, input.payload);
    return await writeProtectedRecord(executor, {
      ...(input.id === undefined ? {} : { id: input.id }),
      installationId: this.#deps.installationId,
      workspaceId: this.#deps.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      envelope,
      now: this.#deps.now(),
    });
  }

  /**
   * Reads and opens a record.
   *
   * Returns `null` only when no envelope exists — a record that was never
   * written. Every other outcome, including one that *looks* like absence such
   * as an unreadable row, raises: "not found" and "found but could not be
   * trusted" must never reach the caller as the same answer, or a corrupted
   * record silently becomes a deleted one.
   */
  async read(executor: Database | Transaction, input: ProtectedRead): Promise<Uint8Array | null> {
    const stored = await readProtectedRecord(executor, {
      workspaceId: this.#deps.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.recordVersion === undefined ? {} : { recordVersion: input.recordVersion }),
    });
    if (stored === null) {
      return null;
    }

    const binding = this.#binding({
      entityType: input.entityType,
      entityId: input.entityId,
      keyGeneration: stored.keyGeneration,
      recordVersion: stored.recordVersion,
    });
    // Checked before any decryption is attempted: a row that is not the record
    // we asked for is a substitution, and the specific answer is more useful to
    // an operator than a generic tag failure.
    try {
      assertEnvelopeMatches(stored, binding);
    } catch (error) {
      await this.#reportIntegrityFailure("binding-mismatch", input, stored);
      throw error;
    }

    // A read may use a retired generation — that is what `decrypt-only` is
    // for. It may not use a revoked one, and `dataKey` enforces that.
    const dataKey = await this.#deps.keys.dataKey(executor, {
      generation: stored.keyGeneration,
      writable: false,
    });

    try {
      return openEnvelope(dataKey.material, stored.envelope, binding);
    } catch (error) {
      if (error instanceof EnvelopeDecryptionError) {
        await this.#reportIntegrityFailure("authentication-failed", input, stored);
        throw new SecurityRepositoryError(
          "protected_read_failed",
          "the stored record did not authenticate",
        );
      }
      throw error;
    }
  }

  /**
   * Reports a refusal, and never changes it.
   *
   * The reporter is given the entity type, id, generation and version — never
   * the ciphertext, the key, or any opened bytes. It is deliberately unable to
   * affect the outcome: whatever it does, the refusal that follows is the same.
   */
  async #reportIntegrityFailure(
    reason: IntegrityFailureReason,
    input: ProtectedRead,
    stored: { keyGeneration: number; recordVersion: number },
  ): Promise<void> {
    const report = this.#deps.reportIntegrityFailure;
    if (report === undefined) {
      return;
    }
    await report({
      reason,
      entityType: input.entityType,
      entityId: input.entityId,
      keyGeneration: stored.keyGeneration,
      recordVersion: stored.recordVersion,
    });
  }

  /**
   * Reads many records of one type.
   *
   * Entities with no envelope are absent from the result rather than mapped to
   * null, so a caller iterating the map cannot mistake "not protected yet" for
   * "empty content". One that fails to open still throws — a list read must
   * not quietly drop the record it could not verify and present the rest as
   * complete.
   */
  async readMany(
    executor: Database | Transaction,
    input: { entityType: string; entityIds: readonly string[] },
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const stored = await readProtectedRecords(executor, {
      workspaceId: this.#deps.workspaceId,
      entityType: input.entityType,
      entityIds: input.entityIds,
    });
    const opened = new Map<string, Uint8Array>();
    for (const [entityId, record] of stored) {
      const binding = this.#binding({
        entityType: input.entityType,
        entityId,
        keyGeneration: record.keyGeneration,
        recordVersion: record.recordVersion,
      });
      assertEnvelopeMatches(record, binding);
      const dataKey = await this.#deps.keys.dataKey(executor, {
        generation: record.keyGeneration,
        writable: false,
      });
      try {
        opened.set(entityId, openEnvelope(dataKey.material, record.envelope, binding));
      } catch (error) {
        if (error instanceof EnvelopeDecryptionError) {
          throw new SecurityRepositoryError(
            "protected_read_failed",
            "a record in this batch did not authenticate",
          );
        }
        throw error;
      }
    }
    return opened;
  }
}

export { KeyUnavailableError };
