/**
 * Branch trash and placement-aware restore execution (T031, US1).
 *
 * Composes the domain lifecycle plans with transactional persistence:
 * - Trash: the reachable active branch is trashed atomically. Pages and
 *   folders keep their internal placements (needed for restore); the branch
 *   root's placement is removed from the active tree. File items inside the
 *   branch lose their in-branch placements and are trashed only when no
 *   active placement remains elsewhere (FR-031/FR-032).
 * - Restore: the branch trashed by one mutation is restored together; the
 *   root placement is recreated at its remembered or explicitly selected
 *   parent (FR-033).
 */

import {
  type DomainResult,
  err,
  generateUuidV7,
  ok,
  planRestore,
  planTrash,
  type Uuid,
} from "@myownnotion/domain";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { items, lifecycleEvents, placements } from "../schema/index.ts";
import {
  getActivePlacements,
  getItem,
  loadBranchView,
  toCanonicalItem,
  wouldCreateCycleSql,
} from "./hierarchy-repository.ts";
import { buildItemSnapshot, insertRevision, supersedeRevision } from "./revision-repository.ts";

export interface LifecycleExecution {
  readonly revisionIds: Uuid[];
  readonly changedItemIds: Uuid[];
  readonly rootItemId: Uuid;
}

export async function executeTrash(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly itemId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<LifecycleExecution>> {
  const { view } = await loadBranchView(tx, input.itemId);
  const plan = planTrash(view, input.itemId, () => input.acceptedAt);
  if (!plan.ok) {
    return plan as DomainResult<LifecycleExecution>;
  }

  const trashedAt = new Date(plan.value.trashedAt);
  const purgeAfter = new Date(plan.value.purgeAfter);
  const branchIds = new Set(plan.value.itemIds);
  const revisionIds: Uuid[] = [];
  const changedItemIds: Uuid[] = [];

  for (const itemId of plan.value.itemIds) {
    const item = view.getItem(itemId);
    if (item === null) {
      continue;
    }

    if (item.kind === "file") {
      // Remove only the file's in-branch hierarchy placements; the file is
      // trashed when the accepted combined state has no active placement.
      const active = await getActivePlacements(tx, itemId);
      const inBranch = active.filter(
        (placement) =>
          placement.kind === "hierarchy" &&
          placement.parentItemId !== null &&
          branchIds.has(placement.parentItemId),
      );
      if (inBranch.length === 0) {
        continue;
      }
      const revisionId = generateUuidV7();
      await tx
        .update(placements)
        .set({ removedAt: input.acceptedAt, removedRevisionId: revisionId })
        .where(
          inArray(
            placements.id,
            inBranch.map((placement) => placement.id),
          ),
        );
      const remaining = active.length - inBranch.length;
      if (remaining === 0) {
        await tx
          .update(items)
          .set({
            lifecycle: "trashed",
            trashedAt,
            purgeAfter,
            currentRevisionId: revisionId,
            updatedAt: input.acceptedAt,
          })
          .where(eq(items.id, itemId));
        await tx.insert(lifecycleEvents).values({
          id: generateUuidV7(),
          itemId,
          mutationId: input.mutationId,
          eventType: "trashed",
          occurredAt: input.acceptedAt,
          placementSnapshot: inBranch.map((placement) => ({
            placementId: placement.id,
            itemId: placement.itemId,
            kind: placement.kind,
            parentItemId: placement.parentItemId,
            positionKey: placement.positionKey,
          })),
        });
      } else {
        await tx
          .update(items)
          .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
          .where(eq(items.id, itemId));
      }
      await appendLifecycleRevision(tx, itemId, item.currentRevisionId, revisionId, input);
      revisionIds.push(revisionId);
      changedItemIds.push(itemId);
      continue;
    }

    // Pages and folders: lifecycle change; the branch root also loses its
    // active placement so the active tree no longer reaches the branch.
    const revisionId = generateUuidV7();
    if (itemId === plan.value.rootItemId) {
      const rootPlacements = await getActivePlacements(tx, itemId);
      if (rootPlacements.length > 0) {
        await tx
          .update(placements)
          .set({ removedAt: input.acceptedAt, removedRevisionId: revisionId })
          .where(
            inArray(
              placements.id,
              rootPlacements.map((placement) => placement.id),
            ),
          );
      }
    }
    await tx
      .update(items)
      .set({
        lifecycle: "trashed",
        trashedAt,
        purgeAfter,
        currentRevisionId: revisionId,
        updatedAt: input.acceptedAt,
      })
      .where(eq(items.id, itemId));
    await tx.insert(lifecycleEvents).values({
      id: generateUuidV7(),
      itemId,
      mutationId: input.mutationId,
      eventType: "trashed",
      occurredAt: input.acceptedAt,
      placementSnapshot: plan.value.placementSnapshots.filter(
        (snapshot) => snapshot.itemId === itemId,
      ),
    });
    await appendLifecycleRevision(tx, itemId, item.currentRevisionId, revisionId, input);
    revisionIds.push(revisionId);
    changedItemIds.push(itemId);
  }

  return ok({ revisionIds, changedItemIds, rootItemId: plan.value.rootItemId });
}

async function appendLifecycleRevision(
  tx: Transaction,
  itemId: Uuid,
  previousHead: Uuid,
  revisionId: Uuid,
  input: { readonly mutationId: Uuid; readonly acceptedAt: Date },
): Promise<void> {
  const snapshot = await buildItemSnapshot(tx, itemId);
  await insertRevision(tx, {
    id: revisionId,
    itemId,
    mutationId: input.mutationId,
    parentRevisionIds: [previousHead],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, previousHead, input.acceptedAt);
}

export async function executeRestore(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly itemId: Uuid;
    readonly fallbackParentItemId?: Uuid | null;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<LifecycleExecution>> {
  const root = await getItem(tx, input.itemId);
  if (root === null) {
    return err("item.not-found", "Item does not exist");
  }
  if (root.lifecycle !== "trashed") {
    return err("item.not-trashed", "Only trashed items can be restored");
  }

  // The branch trashed together: items whose latest 'trashed' event shares
  // the same mutation as the root's latest trash event.
  const rootEvent = await latestTrashEvent(tx, input.itemId);
  if (rootEvent === null) {
    return err("item.not-trashed", "No recoverable trash metadata for this item");
  }
  const branchEventRows = await tx
    .select()
    .from(lifecycleEvents)
    .where(
      and(
        eq(lifecycleEvents.mutationId, rootEvent.mutationId),
        eq(lifecycleEvents.eventType, "trashed"),
      ),
    );

  const branchItemRows = await tx
    .select()
    .from(items)
    .where(
      inArray(
        items.id,
        branchEventRows.map((event) => event.itemId),
      ),
    );
  const trashedBranchItems = branchItemRows
    .filter((row) => row.lifecycle === "trashed")
    .map(toCanonicalItem);

  const rememberedPlacements = branchEventRows.flatMap(
    (event) =>
      (event.placementSnapshot as Array<{
        placementId: Uuid;
        itemId: Uuid;
        kind: "hierarchy" | "attachment";
        parentItemId: Uuid | null;
        positionKey: string;
      }>) ?? [],
  );

  // Validation view: the remembered root parent and fallback parent.
  const externalIds = new Set<Uuid>();
  for (const placement of rememberedPlacements) {
    if (placement.itemId === input.itemId && placement.parentItemId !== null) {
      externalIds.add(placement.parentItemId);
    }
  }
  if (input.fallbackParentItemId != null) {
    externalIds.add(input.fallbackParentItemId);
  }
  const externalItems = new Map<string, Awaited<ReturnType<typeof getItem>>>();
  for (const id of externalIds) {
    externalItems.set(id, await getItem(tx, id));
  }
  const view = {
    getItem: (id: Uuid) => externalItems.get(id) ?? null,
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };

  const plan = planRestore(view, trashedBranchItems, rememberedPlacements, {
    itemId: input.itemId,
    ...(input.fallbackParentItemId !== undefined
      ? { fallbackParentItemId: input.fallbackParentItemId }
      : {}),
  });
  if (!plan.ok) {
    return plan as DomainResult<LifecycleExecution>;
  }

  const revisionIds: Uuid[] = [];
  const changedItemIds: Uuid[] = [];
  const branchIds = new Set(plan.value.itemIds);

  for (const item of trashedBranchItems) {
    const revisionId = generateUuidV7();
    await tx
      .update(items)
      .set({
        lifecycle: "active",
        trashedAt: null,
        purgeAfter: null,
        currentRevisionId: revisionId,
        updatedAt: input.acceptedAt,
      })
      .where(eq(items.id, item.id));

    // Recreate placements removed by the trash action for this item.
    const restored = plan.value.restoredPlacements.filter(
      (placement) => placement.itemId === item.id,
    );
    for (const placement of restored) {
      if (
        placement.parentItemId !== null &&
        !branchIds.has(placement.parentItemId) &&
        placement.kind === "hierarchy" &&
        (await wouldCreateCycleSql(tx, placement.itemId, placement.parentItemId))
      ) {
        return err("containment.cycle-rejected", "Restore would create a hierarchy cycle");
      }
      const stillRemoved = await tx
        .select()
        .from(placements)
        .where(and(eq(placements.id, placement.placementId), isNull(placements.removedAt)))
        .limit(1);
      if (stillRemoved.length > 0) {
        continue; // placement was never removed (descendant placements)
      }
      await tx.insert(placements).values({
        id: generateUuidV7(),
        workspaceId: item.workspaceId,
        itemId: item.id,
        itemIsFile: item.kind === "file",
        kind: placement.kind,
        parentItemId: placement.parentItemId,
        positionKey: placement.positionKey,
        createdRevisionId: revisionId,
      });
    }

    await tx.insert(lifecycleEvents).values({
      id: generateUuidV7(),
      itemId: item.id,
      mutationId: input.mutationId,
      eventType: "restored",
      occurredAt: input.acceptedAt,
      placementSnapshot: restored,
    });
    await appendLifecycleRevision(tx, item.id, item.currentRevisionId, revisionId, input);
    revisionIds.push(revisionId);
    changedItemIds.push(item.id);
  }

  return ok({ revisionIds, changedItemIds, rootItemId: input.itemId });
}

async function latestTrashEvent(
  tx: Transaction,
  itemId: Uuid,
): Promise<{ mutationId: Uuid } | null> {
  const rows = await tx
    .select()
    .from(lifecycleEvents)
    .where(and(eq(lifecycleEvents.itemId, itemId), eq(lifecycleEvents.eventType, "trashed")))
    .orderBy(desc(lifecycleEvents.occurredAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : { mutationId: row.mutationId as Uuid };
}
