/**
 * Durable outbox with retry states (T041, US6, FR-039/FR-040).
 *
 * Rows keep their stable mutation ID through every transport retry. A
 * three-way merge is different: it creates a new command based on a newer
 * revision, so it receives a new ID while replacing the refused row atomically.
 * `sending` marks an in-flight attempt and always recovers to `pending` after
 * an interrupted attempt (process restart or network loss), so no mutation is
 * lost or duplicated logically.
 */
import type { Uuid } from "@myownnotion/domain";
import type {
  LocalDatabase,
  OutboxMutationRow,
  OutboxStatus,
  StructuredConflictContext,
} from "../local-store/schema.ts";

function remapPayloadRevisionReferences(
  payload: Record<string, unknown>,
  revisions: ReadonlyMap<Uuid, Uuid>,
): Record<string, unknown> {
  const next = { ...payload };
  for (const key of ["baseRevisionId", "currentRevisionId"] as const) {
    const value = next[key];
    if (typeof value === "string") {
      next[key] = revisions.get(value as Uuid) ?? value;
    }
  }
  for (const key of ["resolvedRevisionIds", "parentRevisionIds"] as const) {
    const value = next[key];
    if (Array.isArray(value)) {
      next[key] = value.map((revisionId) =>
        typeof revisionId === "string"
          ? (revisions.get(revisionId as Uuid) ?? revisionId)
          : revisionId,
      );
    }
  }
  return next;
}

export class Outbox {
  readonly #db: LocalDatabase;

  constructor(db: LocalDatabase) {
    this.#db = db;
  }

  /** Pending mutations in stable submission order. */
  async pending(): Promise<OutboxMutationRow[]> {
    const rows = await this.#db.outbox.where("status").equals("pending").toArray();
    return rows.sort((a, b) => a.enqueueOrder - b.enqueueOrder);
  }

  async all(): Promise<OutboxMutationRow[]> {
    const rows = await this.#db.outbox.toArray();
    return rows.sort((a, b) => a.enqueueOrder - b.enqueueOrder);
  }

  async get(mutationId: Uuid): Promise<OutboxMutationRow | null> {
    return (await this.#db.outbox.get(mutationId)) ?? null;
  }

  /**
   * Marks rows as in-flight. The mutation identity is untouched: a retry of
   * the same logical mutation always submits the same ID.
   */
  async markSending(
    mutationIds: ReadonlyArray<Uuid>,
    now: () => Date = () => new Date(),
  ): Promise<void> {
    await this.#db.transaction("rw", [this.#db.outbox], async () => {
      for (const mutationId of mutationIds) {
        await this.#db.outbox.update(mutationId, {
          status: "sending" as OutboxStatus,
          lastAttemptAt: now().toISOString(),
        });
      }
    });
  }

  /** Recovery after restart/interruption: every `sending` row is pending again. */
  async recoverInterrupted(): Promise<number> {
    const stuck = await this.#db.outbox.where("status").equals("sending").toArray();
    await this.#db.transaction("rw", [this.#db.outbox], async () => {
      for (const row of stuck) {
        await this.#db.outbox.update(row.mutationId, { status: "pending" as OutboxStatus });
      }
    });
    return stuck.length;
  }

  /**
   * Acknowledged by the server: the durable row has served its purpose.
   *
   * A later local command may already depend on this command's optimistic
   * revision. Replace that causal reference with the canonical server revision
   * in the same transaction that removes the acknowledged row; otherwise a
   * quick create-then-edit is submitted from a revision the server can never
   * know and becomes a false conflict.
   */
  async acknowledge(mutationId: Uuid, acceptedRevisionIds: readonly Uuid[] = []): Promise<void> {
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.revisionHeaders], async () => {
      const row = await this.#db.outbox.get(mutationId);
      if (row !== undefined) {
        const revisions = new Map<Uuid, Uuid>();
        if (acceptedRevisionIds.length === row.localRevisionIds.length) {
          row.localRevisionIds.forEach((localRevisionId, index) => {
            const acceptedRevisionId = acceptedRevisionIds[index];
            if (acceptedRevisionId !== undefined) {
              revisions.set(localRevisionId, acceptedRevisionId);
            }
          });
        }
        if (revisions.size > 0) {
          const queued = await this.#db.outbox.toArray();
          for (const candidate of queued) {
            if (candidate.mutationId === mutationId) continue;
            await this.#db.outbox.update(candidate.mutationId, {
              baseRevisionIds: candidate.baseRevisionIds.map(
                (revisionId) => revisions.get(revisionId) ?? revisionId,
              ),
              payload: remapPayloadRevisionReferences(candidate.payload, revisions),
            });
          }
          const headers = await this.#db.revisionHeaders.toArray();
          for (const header of headers) {
            if (row.localRevisionIds.includes(header.id)) continue;
            await this.#db.revisionHeaders.update(header.id, {
              parentRevisionIds: header.parentRevisionIds.map(
                (revisionId) => revisions.get(revisionId) ?? revisionId,
              ),
            });
          }
        }
        // Optimistic local revision headers are superseded by server state.
        for (const localRevisionId of row.localRevisionIds) {
          await this.#db.revisionHeaders.delete(localRevisionId);
        }
      }
      await this.#db.outbox.delete(mutationId);
    });
  }

  /** Failed attempt (network or 5xx): stays durable, back to pending. */
  async markPendingAgain(mutationId: Uuid): Promise<void> {
    await this.#db.outbox.update(mutationId, { status: "pending" as OutboxStatus });
  }

  /**
   * The refused edit, merged with the head that beat it, queued again
   * (feature 006, FR-013).
   *
   * A rebase is a new command, not a transport retry. The server has already
   * recorded the old ID's terminal conflict for idempotent replay, so reusing
   * that ID would replay the refusal even though the payload now names the
   * current head. Replacing the row atomically means only the new command can
   * be submitted; a late delivery of the old ID can only replay its rejection.
   */
  async requeueMerged(
    mutationId: Uuid,
    replacementMutationId: Uuid,
    payload: Record<string, unknown>,
    baseRevisionIds: Uuid[],
  ): Promise<void> {
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.revisionHeaders], async () => {
      const row = await this.#db.outbox.get(mutationId);
      if (row === undefined) return;
      await this.#db.outbox.delete(mutationId);
      await this.#db.outbox.put({
        ...row,
        mutationId: replacementMutationId,
        status: "pending" as OutboxStatus,
        payload,
        baseRevisionIds,
        lastAttemptAt: null,
      });
      for (const localRevisionId of row.localRevisionIds) {
        await this.#db.revisionHeaders.update(localRevisionId, {
          mutationId: replacementMutationId,
        });
      }
    });
  }

  /**
   * The server refused for a condition retrying cannot clear.
   *
   * The row stays in the queue rather than being captured as a conflict: the
   * work is not lost, there is no competing version to choose between, and the
   * owner needs to be told what is refused and what would resolve it (FR-010).
   * The reason is stored because the refusal happened once, on the server, and
   * the interface has to repeat it later.
   */
  async markBlocked(mutationId: Uuid, reason: string): Promise<void> {
    await this.#db.outbox.update(mutationId, {
      status: "blocked" as OutboxStatus,
      blockedReason: reason,
    });
  }

  /**
   * Rejected concurrent mutation: captured as a durable conflict record
   * (FR-042) and removed from the submission queue. The local command,
   * payload, causal bases, and competing revision identities all survive.
   */
  async captureConflict(
    mutationId: Uuid,
    competingRevisionIds: ReadonlyArray<Uuid>,
    errorCode: string,
    now: () => Date = () => new Date(),
    structured?: StructuredConflictContext,
  ): Promise<void> {
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.conflicts], async () => {
      const row = await this.#db.outbox.get(mutationId);
      if (row === undefined) {
        return;
      }
      await this.#db.conflicts.put({
        mutationId: row.mutationId,
        commandType: row.commandType,
        payload: row.payload,
        baseRevisionIds: row.baseRevisionIds,
        localRevisionIds: row.localRevisionIds,
        competingRevisionIds: [...competingRevisionIds],
        capturedAt: now().toISOString(),
        errorCode,
        ...(structured === undefined ? {} : { structured }),
      });
      await this.#db.outbox.delete(mutationId);
    });
  }

  async conflicts() {
    return this.#db.conflicts.toArray();
  }

  /**
   * Drops a conflict record once the owner has decided between the versions.
   *
   * Only ever called from a deliberate choice. A conflict that expires, or that
   * a background pass tidies away, is a version of the owner's work discarded
   * without anyone deciding to discard it — which is the failure the durable
   * record exists to prevent.
   */
  async resolveConflict(mutationId: Uuid): Promise<void> {
    await this.#db.conflicts.delete(mutationId);
  }
}
