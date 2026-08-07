/**
 * Deterministic snapshot retention and restore-as-new-descendant rules
 * (T083, US5).
 *
 * Superseded snapshots stay complete for 24 hours; unresolved conflicts,
 * current revisions, and trash/backup-protected revisions never prune.
 * Restoration never rewrites history: it creates a new revision whose parent
 * is the current accepted head.
 */

import { type DomainResult, err, ok, REVISION_SNAPSHOT_RETENTION_MS } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";
import type { RevisionWithSnapshot } from "./types.ts";

/** Expiry instant for a snapshot superseded at `supersededAt`. */
export function snapshotExpiry(supersededAt: Date): Date {
  return new Date(supersededAt.getTime() + REVISION_SNAPSHOT_RETENTION_MS);
}

export interface PruneContext {
  /** True when the revision is an item's current accepted head. */
  readonly isCurrentHead: boolean;
  /** True when an unresolved conflict still references the revision. */
  readonly isConflictProtected: boolean;
  /** True when trash or backup rules still require the complete content. */
  readonly isRetentionProtected: boolean;
}

export function canPruneSnapshot(
  revision: RevisionWithSnapshot,
  context: PruneContext,
  now: () => Date = () => new Date(),
): boolean {
  if (revision.snapshot === null) {
    return false; // already pruned
  }
  if (context.isCurrentHead || context.isConflictProtected || context.isRetentionProtected) {
    return false;
  }
  if (revision.snapshotExpiresAt === null) {
    return false;
  }
  return Date.parse(revision.snapshotExpiresAt) <= now().getTime();
}

export interface RestoreRevisionCommand {
  /** The retained historical revision whose content is being restored. */
  readonly revisionId: Uuid;
  /** The head the owner believes is current (stale head → explicit conflict). */
  readonly expectedCurrentRevisionId: Uuid;
}

export interface RestoreRevisionPlan {
  readonly sourceRevision: RevisionWithSnapshot;
  /** Parent of the restoration revision: always the actual current head. */
  readonly parentRevisionId: Uuid;
  /** Complete snapshot copied into the new descendant revision. */
  readonly restoredSnapshot: Readonly<Record<string, unknown>>;
}

export function planRestoreRevision(
  source: RevisionWithSnapshot | null,
  actualCurrentRevisionId: Uuid,
  command: RestoreRevisionCommand,
): DomainResult<RestoreRevisionPlan> {
  if (source === null) {
    return err("revision.not-found", "Revision does not exist");
  }
  if (source.snapshot === null) {
    return err("revision.snapshot-expired", "Revision content is no longer retained");
  }
  if (command.expectedCurrentRevisionId !== actualCurrentRevisionId) {
    return err("mutation.conflict", "Current head changed since the restore was prepared", {
      competingRevisionIds: [actualCurrentRevisionId],
    });
  }
  return ok({
    sourceRevision: source,
    parentRevisionId: actualCurrentRevisionId,
    restoredSnapshot: source.snapshot,
  });
}
