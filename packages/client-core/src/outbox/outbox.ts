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
  ConflictRecordRow,
  LocalDatabase,
  OutboxMutationRow,
  OutboxStatus,
  StructuredConflictContext,
} from "../local-store/schema.ts";
import type {
  LocalRecordCodec,
  SealedConflictRecordRow,
  SealedOutboxMutationRow,
} from "../security/local-record-codec.ts";
import { withProjectionWrite } from "./projection-write-coordinator.ts";

export function remapPayloadRevisionReferences(
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
  readonly #codec: LocalRecordCodec | undefined;

  constructor(db: LocalDatabase, codec?: LocalRecordCodec) {
    this.#db = db;
    this.#codec = codec;
  }

  async #openOutbox(stored: unknown): Promise<OutboxMutationRow> {
    if (typeof stored === "object" && stored !== null && "payload" in stored) {
      return stored as OutboxMutationRow;
    }
    if (this.#codec === undefined) {
      throw new Error("A local record codec is required to open the sealed outbox");
    }
    return await this.#codec.openOutbox(stored as SealedOutboxMutationRow);
  }

  async #storeOutbox(row: OutboxMutationRow): Promise<OutboxMutationRow | SealedOutboxMutationRow> {
    return this.#codec === undefined ? row : await this.#codec.sealOutbox(row);
  }

  async #openConflict(stored: unknown): Promise<ConflictRecordRow> {
    if (typeof stored === "object" && stored !== null && "payload" in stored) {
      return stored as ConflictRecordRow;
    }
    if (this.#codec === undefined) {
      throw new Error("A local record codec is required to open sealed conflicts");
    }
    return await this.#codec.openConflict(stored as SealedConflictRecordRow);
  }

  async #storeConflict(
    row: ConflictRecordRow,
  ): Promise<ConflictRecordRow | SealedConflictRecordRow> {
    return this.#codec === undefined ? row : await this.#codec.sealConflict(row);
  }

  /** Pending mutations in stable submission order. */
  async pending(): Promise<OutboxMutationRow[]> {
    const stored = await this.#db.outbox.where("status").equals("pending").toArray();
    const rows = await Promise.all(stored.map((row) => this.#openOutbox(row)));
    return rows.sort((a, b) => a.enqueueOrder - b.enqueueOrder);
  }

  async all(): Promise<OutboxMutationRow[]> {
    const rows = await Promise.all(
      (await this.#db.outbox.toArray()).map((row) => this.#openOutbox(row)),
    );
    return rows.sort((a, b) => a.enqueueOrder - b.enqueueOrder);
  }

  async get(mutationId: Uuid): Promise<OutboxMutationRow | null> {
    const stored = await this.#db.outbox.get(mutationId);
    return stored === undefined ? null : await this.#openOutbox(stored);
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
    await withProjectionWrite(this.#db, async () => {
      for (;;) {
        // Crypto must finish before the write transaction opens. Snapshotting and
        // verifying the queue closes the race with a local edit arriving while
        // dependent payloads are being resealed.
        const storedRows = await this.#db.outbox.toArray();
        const fingerprint = JSON.stringify(
          [...storedRows].sort((left, right) => left.mutationId.localeCompare(right.mutationId)),
        );
        const storedTarget = storedRows.find((candidate) => candidate.mutationId === mutationId);
        if (storedTarget === undefined) {
          await this.#db.outbox.delete(mutationId);
          return;
        }
        const row = await this.#openOutbox(storedTarget);
        const revisions = new Map<Uuid, Uuid>();
        if (acceptedRevisionIds.length === row.localRevisionIds.length) {
          row.localRevisionIds.forEach((localRevisionId, index) => {
            const acceptedRevisionId = acceptedRevisionIds[index];
            if (acceptedRevisionId !== undefined)
              revisions.set(localRevisionId, acceptedRevisionId);
          });
        }
        const replacements: Array<OutboxMutationRow | SealedOutboxMutationRow> = [];
        if (revisions.size > 0) {
          for (const storedCandidate of storedRows) {
            if (storedCandidate.mutationId === mutationId) continue;
            const candidate = await this.#openOutbox(storedCandidate);
            replacements.push(
              await this.#storeOutbox({
                ...candidate,
                baseRevisionIds: candidate.baseRevisionIds.map(
                  (revisionId) => revisions.get(revisionId) ?? revisionId,
                ),
                payload: remapPayloadRevisionReferences(candidate.payload, revisions),
              }),
            );
          }
        }

        let retry = false;
        await this.#db.transaction(
          "rw",
          [this.#db.items, this.#db.outbox, this.#db.revisionHeaders],
          async () => {
            const current = await this.#db.outbox.toArray();
            const currentFingerprint = JSON.stringify(
              [...current].sort((left, right) => left.mutationId.localeCompare(right.mutationId)),
            );
            if (currentFingerprint !== fingerprint) {
              retry = true;
              return;
            }
            for (const replacement of replacements) {
              await this.#db.outbox.put(replacement as OutboxMutationRow);
            }
            if (revisions.size > 0) {
              const headers = await this.#db.revisionHeaders.toArray();
              for (const header of headers) {
                const canonicalRevisionId = revisions.get(header.id);
                if (canonicalRevisionId !== undefined) {
                  // Retain the alias for stale in-memory callers. On the next
                  // boot every caller is rebuilt from canonical projection state.
                  await this.#db.revisionHeaders.update(header.id, {
                    local: 0,
                    canonicalRevisionId,
                  });
                  continue;
                }
                await this.#db.revisionHeaders.update(header.id, {
                  parentRevisionIds: header.parentRevisionIds.map(
                    (revisionId) => revisions.get(revisionId) ?? revisionId,
                  ),
                });
              }
              // The current revision is routing metadata on the sealed item, so
              // it can be advanced without decrypting or resealing its content.
              for (const item of await this.#db.items.toArray()) {
                const canonicalRevisionId = revisions.get(item.currentRevisionId);
                if (canonicalRevisionId !== undefined) {
                  await this.#db.items.update(item.id, { currentRevisionId: canonicalRevisionId });
                }
              }
            } else {
              for (const localRevisionId of row.localRevisionIds) {
                await this.#db.revisionHeaders.delete(localRevisionId);
              }
            }
            await this.#db.outbox.delete(mutationId);
          },
        );
        if (!retry) return;
      }
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
    const stored = await this.#db.outbox.get(mutationId);
    if (stored === undefined) return;
    const row = await this.#openOutbox(stored);
    const replacement = await this.#storeOutbox({
      ...row,
      mutationId: replacementMutationId,
      status: "pending" as OutboxStatus,
      payload,
      baseRevisionIds,
      lastAttemptAt: null,
    });
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.revisionHeaders], async () => {
      if ((await this.#db.outbox.get(mutationId)) === undefined) return;
      await this.#db.outbox.delete(mutationId);
      await this.#db.outbox.put(replacement as OutboxMutationRow);
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
    const stored = await this.#db.outbox.get(mutationId);
    if (stored === undefined) return;
    const row = await this.#openOutbox(stored);
    const conflict = await this.#storeConflict({
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
    await this.#db.transaction("rw", [this.#db.outbox, this.#db.conflicts], async () => {
      if ((await this.#db.outbox.get(mutationId)) === undefined) return;
      await this.#db.conflicts.put(conflict as ConflictRecordRow);
      await this.#db.outbox.delete(mutationId);
    });
  }

  async conflicts(): Promise<ConflictRecordRow[]> {
    return await Promise.all(
      (await this.#db.conflicts.toArray()).map((row) => this.#openConflict(row)),
    );
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
