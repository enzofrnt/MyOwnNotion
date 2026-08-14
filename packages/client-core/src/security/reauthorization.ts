/**
 * Surviving reauthorization with identities intact (T070, US3, FR-024).
 *
 * When the owner asks a device to sign in again, the device is still theirs.
 * The temptation is to treat the interruption as a fresh start — clear the
 * local store, re-download from the server, begin clean. That would lose the
 * one thing the server does not have: the mutations queued while offline.
 *
 * So reauthorization is a lock and an unlock around unchanged data. Nothing is
 * deleted, no identity is regenerated, and the outbox is still in order
 * afterwards. What this module provides is the evidence of that: a snapshot
 * taken before, compared after.
 */

import type { LocalDatabase } from "../local-store/schema.ts";

/**
 * The identities that must be the same on the other side.
 *
 * Counts alone would not catch a store that was cleared and refilled from the
 * server, which is the failure worth guarding against: the numbers would match
 * and the queued offline work would be gone.
 */
export interface LocalIdentitySnapshot {
  readonly itemIds: readonly string[];
  readonly outboxMutationIds: readonly string[];
  readonly conflictMutationIds: readonly string[];
  readonly revisionIds: readonly string[];
}

export async function snapshotLocalIdentities(db: LocalDatabase): Promise<LocalIdentitySnapshot> {
  const [items, outbox, conflicts, revisions] = await Promise.all([
    db.items.toArray(),
    db.outbox.toArray(),
    db.conflicts.toArray(),
    db.revisionHeaders.toArray(),
  ]);
  // Sorted so a comparison is about membership rather than about the order
  // IndexedDB happened to return.
  return {
    itemIds: items.map((row) => row.id).sort(),
    outboxMutationIds: outbox.map((row) => row.mutationId).sort(),
    conflictMutationIds: conflicts.map((row) => row.mutationId).sort(),
    revisionIds: revisions.map((row) => row.id).sort(),
  };
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Every identity that changed across a reauthorization. Empty means intact. */
export function localIdentityDrift(
  before: LocalIdentitySnapshot,
  after: LocalIdentitySnapshot,
): string[] {
  const drift: string[] = [];
  if (!sameMembers(before.itemIds, after.itemIds)) {
    drift.push("items");
  }
  if (!sameMembers(before.outboxMutationIds, after.outboxMutationIds)) {
    // The one that matters most: these are edits the server has never seen.
    drift.push("outbox");
  }
  if (!sameMembers(before.conflictMutationIds, after.conflictMutationIds)) {
    drift.push("conflicts");
  }
  if (!sameMembers(before.revisionIds, after.revisionIds)) {
    drift.push("revisionHeaders");
  }
  return drift;
}
