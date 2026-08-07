/**
 * Mutation, change-cursor, conflict, and revision value objects (T011).
 *
 * These are the shared vocabulary for idempotent command submission, causal
 * lineage, ordered catch-up, and durable conflict capture. Wall-clock
 * timestamps are metadata only and never ancestry evidence.
 */

import type { SafeError } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";

export type MutationStatus = "accepted" | "rejected";

export interface MutationRecord {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly commandType: string;
  readonly status: MutationStatus;
  readonly submittedAt: string;
  readonly acceptedAt: string | null;
  readonly resultRevisionIds: ReadonlyArray<Uuid>;
  readonly failureCode: string | null;
}

/** Immutable revision header; the snapshot may be pruned, the header never. */
export interface RevisionHeader {
  readonly id: Uuid;
  readonly itemId: Uuid;
  readonly mutationId: Uuid;
  readonly parentRevisionIds: ReadonlyArray<Uuid>;
  readonly acceptedAt: string;
}

export interface RevisionWithSnapshot extends RevisionHeader {
  readonly snapshot: Readonly<Record<string, unknown>> | null;
  readonly snapshotExpiresAt: string | null;
}

/**
 * Causal relation between two revisions of the same item, determined from
 * parent edges only (never from timestamps).
 */
export type LineageClassification =
  | "identical"
  | "left-ancestor" // left is an ancestor of right
  | "right-ancestor" // right is an ancestor of left
  | "concurrent";

/** Opaque durable change cursor; the client never interprets its content. */
export type ChangeCursor = string & { readonly __brand: "ChangeCursor" };

export function asChangeCursor(value: string): ChangeCursor {
  return value as ChangeCursor;
}

/** The cursor value that means "from the beginning of history". */
export const INITIAL_CHANGE_CURSOR = "" as ChangeCursor;

export interface ChangeEnvelope {
  readonly sequence: number;
  readonly mutationId: Uuid;
  readonly revisionIds: ReadonlyArray<Uuid>;
}

/** A queued client command with its stable identity and causal bases. */
export interface QueuedMutation {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly baseRevisionIds: ReadonlyArray<Uuid>;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type QueuedMutationStatus = "accepted" | "already-accepted" | "rejected" | "conflict";

export interface QueuedMutationResult {
  readonly mutationId: Uuid;
  readonly status: QueuedMutationStatus;
  readonly revisionIds?: ReadonlyArray<Uuid>;
  readonly competingRevisionIds?: ReadonlyArray<Uuid>;
  readonly problem?: SafeError;
}

/**
 * Durable record of a rejected concurrent mutation (FR-042). The local
 * command, content, causal bases, and competing revision identities remain
 * recoverable until an explicit later resolution.
 */
export interface ConflictCapture {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly baseRevisionIds: ReadonlyArray<Uuid>;
  readonly localRevisionIds: ReadonlyArray<Uuid>;
  readonly competingRevisionIds: ReadonlyArray<Uuid>;
  readonly capturedAt: string;
  readonly errorCode: string;
}
