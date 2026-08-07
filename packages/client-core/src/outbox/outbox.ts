/**
 * Durable outbox with retry states (T041, US6, FR-039/FR-040).
 *
 * Rows keep their stable mutation ID through every retry — IDs are never
 * regenerated. `sending` marks an in-flight attempt and always recovers to
 * `pending` after an interrupted attempt (process restart or network loss),
 * so no mutation is lost or duplicated logically.
 */
import type { Uuid } from "@myownnotion/domain";
import type { LocalDatabase, OutboxMutationRow, OutboxStatus } from "../local-store/schema.ts";

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
  async markSending(mutationIds: ReadonlyArray<Uuid>, now: () => Date = () => new Date()):
    Promise<void> {
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

  /** Acknowledged by the server: the durable row has served its purpose. */
  async acknowledge(mutationId: Uuid): Promise<void> {
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.revisionHeaders], async () => {
      const row = await this.#db.outbox.get(mutationId);
      if (row !== undefined) {
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
   * Rejected concurrent mutation: captured as a durable conflict record
   * (FR-042) and removed from the submission queue. The local command,
   * payload, causal bases, and competing revision identities all survive.
   */
  async captureConflict(
    mutationId: Uuid,
    competingRevisionIds: ReadonlyArray<Uuid>,
    errorCode: string,
    now: () => Date = () => new Date(),
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
      });
      await this.#db.outbox.delete(mutationId);
    });
  }

  async conflicts() {
    return this.#db.conflicts.toArray();
  }
}
