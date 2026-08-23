/**
 * Ordered durable change feed (T042, US6).
 *
 * Accepted mutations append one change row with a monotonic workspace-local
 * sequence. Clients catch up with `listChangesAfter`; a cursor older than the
 * retained window reports compaction so the client rebuilds from a verified
 * snapshot without discarding its outbox.
 */

import {
  asChangeCursor,
  type ChangeCursor,
  type ChangeEnvelope,
  INITIAL_CHANGE_CURSOR,
  type Uuid,
} from "@myownnotion/domain";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { changes, mutations } from "../schema/index.ts";

export function cursorToSequence(cursor: ChangeCursor | string): number | null {
  if (cursor === INITIAL_CHANGE_CURSOR) {
    return 0;
  }
  const parsed = Number.parseInt(String(cursor), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function sequenceToCursor(sequence: number): ChangeCursor {
  return asChangeCursor(String(sequence));
}

export async function recordChange(
  tx: Transaction,
  input: {
    readonly workspaceId: Uuid;
    readonly mutationId: Uuid;
    readonly revisionIds: ReadonlyArray<Uuid>;
    readonly changedItemIds: ReadonlyArray<Uuid>;
  },
): Promise<number> {
  const inserted = await tx
    .insert(changes)
    .values({
      workspaceId: input.workspaceId,
      mutationId: input.mutationId,
      revisionIds: [...input.revisionIds],
      changedItemIds: [...input.changedItemIds],
    })
    .returning({ sequence: changes.sequence });
  const row = inserted[0];
  if (row === undefined) {
    throw new Error("change row insertion returned no sequence");
  }
  return row.sequence;
}

export interface ChangePage {
  readonly changes: ReadonlyArray<ChangeEnvelope & { readonly changedItemIds: Uuid[] }>;
  readonly nextCursor: ChangeCursor;
  readonly hasMore: boolean;
}

export async function listChangesAfter(
  tx: Transaction,
  workspaceId: Uuid,
  afterSequence: number,
  limit: number,
): Promise<ChangePage> {
  const rows = await tx
    .select({
      sequence: changes.sequence,
      mutationId: changes.mutationId,
      revisionIds: changes.revisionIds,
      changedItemIds: changes.changedItemIds,
      nature: mutations.commandType,
    })
    .from(changes)
    .innerJoin(mutations, eq(mutations.id, changes.mutationId))
    .where(and(eq(changes.workspaceId, workspaceId), gt(changes.sequence, afterSequence)))
    .orderBy(asc(changes.sequence))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    changes: page.map((row) => ({
      sequence: row.sequence,
      mutationId: row.mutationId as Uuid,
      revisionIds: row.revisionIds as Uuid[],
      changedItemIds: row.changedItemIds as Uuid[],
      nature: row.nature,
    })),
    nextCursor:
      last === undefined ? sequenceToCursor(afterSequence) : sequenceToCursor(last.sequence),
    hasMore: rows.length > limit,
  };
}

/**
 * The oldest position still served, or 0 when the feed is empty (feature 006).
 *
 * Nothing prunes the feed today, so this is 1 for any workspace that has ever
 * written. It exists anyway, because the alternative is a stream that decides
 * "this cursor is too old" from a constant, and a constant would keep answering
 * the same way on the day retention starts — which is the day the answer stops
 * being true. Asking the table means compaction becomes correct by itself when
 * pruning arrives, rather than by someone remembering to revisit this.
 */
export async function oldestRetainedSequence(tx: Transaction, workspaceId: Uuid): Promise<number> {
  const rows = await tx
    .select({ sequence: changes.sequence })
    .from(changes)
    .where(eq(changes.workspaceId, workspaceId))
    .orderBy(asc(changes.sequence))
    .limit(1);
  return rows[0]?.sequence ?? 0;
}

/** Latest sequence for the workspace (0 when no change exists yet). */
export async function currentSequence(tx: Transaction, workspaceId: Uuid): Promise<number> {
  const rows = await tx
    .select({ sequence: changes.sequence })
    .from(changes)
    .where(eq(changes.workspaceId, workspaceId))
    .orderBy(desc(changes.sequence))
    .limit(1);
  return rows[0]?.sequence ?? 0;
}
