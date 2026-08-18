/**
 * Turning an owner's decision into a revision with two parents (T026, FR-016).
 *
 * The whole point of this module is what it does *not* do. It does not delete
 * either version, does not rewrite the revision the server accepted, and does
 * not edit the local one in place. It enqueues one new mutation whose lineage
 * names both, so both remain reachable as its ancestors — and it removes the
 * conflict record only once that mutation is durably queued.
 *
 * The order matters and is the one place this could lose work. Dropping the
 * conflict first and enqueuing second leaves a window where a reload finds
 * neither: the conflict is gone and the resolution was never written. So the
 * resolution is written first, and the conflict record is cleared after — a
 * crash in between leaves a queued resolution and a conflict that resolves to
 * the same thing, which reconciles to the same state.
 */

import type { PageDocument, Uuid } from "@myownnotion/domain";
import type { LocalDatabase } from "../local-store/schema.ts";
import { applyLocalMutation } from "../outbox/apply-local-mutation.ts";
import { Outbox } from "../outbox/outbox.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";

export interface ResolveConflictInput {
  readonly mutationId: Uuid;
  /** The conflict record being answered. */
  readonly conflictMutationId: Uuid;
  readonly itemId: Uuid;
  /** The two revisions the owner chose between. */
  readonly localRevisionId: Uuid;
  readonly remoteRevisionId: Uuid;
  /** What the owner assembled and reviewed. */
  readonly document: PageDocument;
  readonly pageLinkTargetIds?: readonly Uuid[];
}

export type ResolveConflictOutcome =
  | { readonly ok: true; readonly revisionIds: Uuid[] }
  | { readonly ok: false; readonly code: string; readonly title: string };

export async function resolveConflictLocally(
  db: LocalDatabase,
  codec: LocalRecordCodec,
  input: ResolveConflictInput,
  now: () => Date = () => new Date(),
): Promise<ResolveConflictOutcome> {
  const applied = await applyLocalMutation(
    db,
    {
      mutationId: input.mutationId,
      commandType: "document.resolve-conflict",
      payload: {
        itemId: input.itemId,
        resolvedRevisionIds: [input.localRevisionId, input.remoteRevisionId],
        document: input.document,
        ...(input.pageLinkTargetIds === undefined
          ? {}
          : { pageLinkTargetIds: [...input.pageLinkTargetIds] }),
      },
      // Both, as the causal base. The server checks that one of them is still
      // the head; naming only the local one would let a resolution be accepted
      // against a head the owner never saw.
      baseRevisionIds: [input.localRevisionId, input.remoteRevisionId],
    },
    now,
    codec,
  );
  if (!applied.ok) {
    // The conflict record is deliberately left alone. A resolution that could
    // not be written locally has resolved nothing, and clearing the record here
    // would discard the owner's only route back to both versions.
    return { ok: false, code: applied.error.code, title: applied.error.title };
  }

  // Only now. See the module comment: this order is what makes a crash
  // mid-resolution recoverable rather than destructive.
  await new Outbox(db).resolveConflict(input.conflictMutationId);
  return { ok: true, revisionIds: [...applied.value.localRevisionIds] };
}
