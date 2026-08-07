/**
 * Atomic branch move and sibling reorder (T030, US1).
 *
 * The complete move — cycle check, placement update, revision append —
 * happens in the caller's SERIALIZABLE transaction, so a concurrent change
 * to a descendant either serializes before or after the move, never within
 * it. Descendants are never touched row-by-row: an adjacency-list move only
 * rewrites the moved placement, which keeps branch moves O(1).
 */

import {
  type DomainResult,
  err,
  generateUuidV7,
  type MovePlacementCommand,
  ok,
  type Uuid,
  validateMovePlacement,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { items, placements } from "../schema/index.ts";
import { getItem, getPlacement, wouldCreateCycleSql } from "./hierarchy-repository.ts";
import { buildItemSnapshot, insertRevision, supersedeRevision } from "./revision-repository.ts";

export interface MoveExecution {
  readonly revisionId: Uuid;
  readonly itemId: Uuid;
}

export async function executeMovePlacement(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly command: MovePlacementCommand;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<MoveExecution>> {
  const placement = await getPlacement(tx, input.command.placementId);
  if (placement === null) {
    return err("placement.not-found", "Placement does not exist");
  }
  const item = await getItem(tx, placement.itemId);
  const parent =
    input.command.parentItemId === null ? null : await getItem(tx, input.command.parentItemId);

  // Domain validation over a transaction-consistent view.
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : id === parent?.id ? parent : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateMovePlacement(view, placement, input.command);
  if (!plan.ok) {
    return plan as DomainResult<MoveExecution>;
  }

  // Authoritative recursive cycle check inside the same transaction.
  if (
    placement.kind === "hierarchy" &&
    input.command.parentItemId !== null &&
    (await wouldCreateCycleSql(tx, placement.itemId, input.command.parentItemId))
  ) {
    return err(
      "containment.cycle-rejected",
      "Moving an item beneath its own descendant is rejected",
    );
  }

  const revisionId = generateUuidV7();
  await tx
    .update(placements)
    .set({
      parentItemId: plan.value.newParentItemId,
      positionKey: plan.value.newPositionKey,
    })
    .where(eq(placements.id, placement.id));

  const currentHead = (item as NonNullable<typeof item>).currentRevisionId;
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
    .where(eq(items.id, placement.itemId));
  const snapshot = await buildItemSnapshot(tx, placement.itemId);
  await insertRevision(tx, {
    id: revisionId,
    itemId: placement.itemId,
    mutationId: input.mutationId,
    parentRevisionIds: [currentHead],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, currentHead, input.acceptedAt);

  return ok({ revisionId, itemId: placement.itemId });
}
