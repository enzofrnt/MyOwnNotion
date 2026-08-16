/**
 * Reconciliation (T044, US6, FR-040/FR-041/FR-042).
 *
 * Reconnect pipeline:
 * 1. Recover interrupted `sending` rows to `pending`.
 * 2. Submit the durable outbox in order with stable mutation IDs
 *    (idempotent server replay absorbs duplicate transport delivery).
 * 3. Per-result: acknowledge, retain for retry, or capture a durable
 *    conflict with competing revision identities.
 * 4. Catch up through the ordered change cursor; a compacted cursor falls
 *    back to the verified snapshot WITHOUT touching the outbox.
 */
import type {
  CanonicalSnapshotDto,
  ChangesResponseDto,
  ItemDto,
  QueuedMutationDto,
  QueuedMutationResultDto,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { LocalRepository } from "../local-store/local-repository.ts";
import { type LocalDatabase, META_KEYS } from "../local-store/schema.ts";
import { Outbox } from "../outbox/outbox.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";

export interface ReconcileTransport {
  submitMutationBatch(
    mutations: QueuedMutationDto[],
  ): Promise<
    { ok: true; value: { results: QueuedMutationResultDto[] } } | { ok: false; offline: boolean }
  >;
  listChanges(
    after: string,
    limit?: number,
  ): Promise<
    { ok: true; value: ChangesResponseDto } | { ok: false; offline: boolean; compacted?: boolean }
  >;
  currentSnapshot(): Promise<
    { ok: true; value: CanonicalSnapshotDto } | { ok: false; offline: boolean }
  >;
}

export interface ReconcileOutcome {
  readonly submitted: number;
  readonly accepted: number;
  readonly conflicts: number;
  /** Mutations the server refused for a condition retrying cannot clear. */
  readonly blocked: number;
  readonly retained: number;
  readonly caughtUpTo: string;
  readonly usedSnapshotFallback: boolean;
  readonly offline: boolean;
}

const BATCH_LIMIT = 100;

/**
 * Whether a refusal is a condition on the server rather than a competing change.
 *
 * The distinction decides what the owner is asked to do. A conflict needs them
 * to choose between two versions; a block needs them to wait or to clear the
 * condition, and offering a choice between versions would be nonsense because
 * there is only one.
 */
function isWriteBlock(code: string | undefined): boolean {
  return code === "write_blocked" || code === "rotation.write-blocked";
}

export async function reconcile(
  db: LocalDatabase,
  transport: ReconcileTransport,
  codec: LocalRecordCodec,
): Promise<ReconcileOutcome> {
  const outbox = new Outbox(db);
  const repository = new LocalRepository(db, codec);

  await outbox.recoverInterrupted();

  let submitted = 0;
  let accepted = 0;
  let conflicts = 0;
  let blocked = 0;

  // Submit the durable queue in stable order.
  for (;;) {
    const pending = (await outbox.pending()).slice(0, BATCH_LIMIT);
    if (pending.length === 0) {
      break;
    }
    const mutationIds = pending.map((row) => row.mutationId);
    await outbox.markSending(mutationIds);
    const response = await transport.submitMutationBatch(
      pending.map((row) => ({
        mutationId: row.mutationId,
        commandType: row.commandType,
        baseRevisionIds: row.baseRevisionIds,
        payload: row.payload,
      })),
    );
    if (!response.ok) {
      // Interrupted attempt: everything recovers to pending, nothing is lost.
      for (const mutationId of mutationIds) {
        await outbox.markPendingAgain(mutationId);
      }
      return {
        submitted,
        accepted,
        conflicts,
        blocked,
        retained: (await outbox.pending()).length,
        caughtUpTo: await repository.getLastChangeCursor(),
        usedSnapshotFallback: false,
        offline: true,
      };
    }

    submitted += pending.length;
    for (const result of response.value.results) {
      const mutationId = result.mutationId as Uuid;
      if (result.status === "accepted" || result.status === "already-accepted") {
        accepted += 1;
        await outbox.acknowledge(mutationId);
      } else if (result.status === "conflict") {
        conflicts += 1;
        await outbox.captureConflict(
          mutationId,
          (result.competingRevisionIds ?? []) as Uuid[],
          result.problem?.code ?? "mutation.conflict",
        );
      } else if (isWriteBlock(result.problem?.code)) {
        // Refused by a condition on the server rather than by a competing
        // change: retrying will not help until that condition clears. Recording
        // it as a conflict would ask the owner to choose between versions when
        // there is no second version — and would hide the one thing they can
        // act on (FR-010).
        blocked += 1;
        await outbox.markBlocked(
          mutationId,
          result.problem?.title ?? "The server is not accepting changes right now.",
        );
      } else {
        // Deterministic rejection: retain durably as a conflict record so
        // the local work stays recoverable rather than silently dropped.
        conflicts += 1;
        await outbox.captureConflict(
          mutationId,
          (result.competingRevisionIds ?? []) as Uuid[],
          result.problem?.code ?? "mutation.rejected",
        );
      }
    }
  }

  // Ordered catch-up after the durable cursor.
  let usedSnapshotFallback = false;
  let cursor = await repository.getLastChangeCursor();
  for (;;) {
    const page = await transport.listChanges(cursor);
    if (!page.ok) {
      if (page.compacted === true) {
        // Verified snapshot fallback (FR-041): rebuild the projection,
        // preserving outbox and conflicts untouched.
        const snapshot = await transport.currentSnapshot();
        if (!snapshot.ok) {
          return {
            submitted,
            accepted,
            conflicts,
            blocked,
            retained: (await outbox.pending()).length,
            caughtUpTo: cursor,
            usedSnapshotFallback: false,
            offline: true,
          };
        }
        await repository.replaceFromSnapshot({
          workspaceId: snapshot.value.workspaceId as Uuid,
          schemaVersion: snapshot.value.schemaVersion,
          cursor: snapshot.value.cursor,
          items: snapshot.value.items as ItemDto[],
        });
        usedSnapshotFallback = true;
        cursor = snapshot.value.cursor;
        continue;
      }
      return {
        submitted,
        accepted,
        conflicts,
        blocked,
        retained: (await outbox.pending()).length,
        caughtUpTo: cursor,
        usedSnapshotFallback,
        offline: true,
      };
    }

    const changedItems = page.value.changes.flatMap((change) => change.changedItems ?? []);
    if (changedItems.length > 0) {
      await repository.applyServerItems(changedItems as ItemDto[]);
    }
    cursor = page.value.nextCursor;
    await repository.setMeta(META_KEYS.lastChangeCursor, cursor);
    if (!page.value.hasMore) {
      break;
    }
  }

  return {
    submitted,
    accepted,
    conflicts,
    blocked,
    retained: (await outbox.pending()).length,
    caughtUpTo: cursor,
    usedSnapshotFallback,
    offline: false,
  };
}
