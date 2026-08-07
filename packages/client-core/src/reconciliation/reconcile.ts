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
import { META_KEYS, type LocalDatabase } from "../local-store/schema.ts";
import { LocalRepository } from "../local-store/local-repository.ts";
import { Outbox } from "../outbox/outbox.ts";

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
  readonly retained: number;
  readonly caughtUpTo: string;
  readonly usedSnapshotFallback: boolean;
  readonly offline: boolean;
}

const BATCH_LIMIT = 100;

export async function reconcile(
  db: LocalDatabase,
  transport: ReconcileTransport,
): Promise<ReconcileOutcome> {
  const outbox = new Outbox(db);
  const repository = new LocalRepository(db);

  await outbox.recoverInterrupted();

  let submitted = 0;
  let accepted = 0;
  let conflicts = 0;

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
    retained: (await outbox.pending()).length,
    caughtUpTo: cursor,
    usedSnapshotFallback,
    offline: false,
  };
}
