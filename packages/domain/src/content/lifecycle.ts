/**
 * 30-day branch trash and placement-aware restore (T031, US1).
 *
 * Trash and restore are planned as complete atomic units: a trash plan covers
 * the whole reachable active branch; a restore plan validates the remembered
 * placement and demands an explicit fallback parent when the original parent
 * is no longer valid.
 */
import type { Uuid } from "../ids/uuid.ts";
import { collectActiveBranch, type HierarchyView, wouldCreateCycle } from "./hierarchy.ts";
import {
  type CanonicalItem,
  type DomainResult,
  err,
  ok,
  type Placement,
  TRASH_RETENTION_MS,
} from "./types.ts";

export interface TrashPlan {
  readonly rootItemId: Uuid;
  /** Every item entering the trash, root first. */
  readonly itemIds: ReadonlyArray<Uuid>;
  readonly trashedAt: string;
  readonly purgeAfter: string;
  /** Recovery metadata: the active placements removed by this trash action. */
  readonly placementSnapshots: ReadonlyArray<{
    readonly placementId: Uuid;
    readonly itemId: Uuid;
    readonly kind: Placement["kind"];
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  }>;
}

export function planTrash(
  view: HierarchyView,
  rootItemId: Uuid,
  now: () => Date = () => new Date(),
): DomainResult<TrashPlan> {
  const root = view.getItem(rootItemId);
  if (root === null) {
    return err("item.not-found", "Item does not exist");
  }
  if (root.lifecycle !== "active") {
    return err("item.not-active", "Only active items can be trashed");
  }
  const itemIds = collectActiveBranch(view, rootItemId);
  const trashedAt = now();
  const purgeAfter = new Date(trashedAt.getTime() + TRASH_RETENTION_MS);
  const placementSnapshots = itemIds.flatMap((itemId) =>
    view.getActivePlacements(itemId).map((placement) => ({
      placementId: placement.id,
      itemId: placement.itemId,
      kind: placement.kind,
      parentItemId: placement.parentItemId,
      positionKey: placement.positionKey,
    })),
  );
  return ok({
    rootItemId,
    itemIds,
    trashedAt: trashedAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
    placementSnapshots,
  });
}

export interface RestoreCommand {
  readonly itemId: Uuid;
  /** Explicit owner-selected parent when the remembered parent is invalid. */
  readonly fallbackParentItemId?: Uuid | null;
}

export interface RestorePlan {
  readonly rootItemId: Uuid;
  /** Trashed descendants restored together with the root (same trash action). */
  readonly itemIds: ReadonlyArray<Uuid>;
  readonly restoredPlacements: ReadonlyArray<{
    readonly placementId: Uuid;
    readonly itemId: Uuid;
    readonly kind: Placement["kind"];
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  }>;
}

/**
 * Validates that a remembered parent is still a valid destination for the
 * restored root. Descendant placements point inside the restored branch and
 * therefore stay valid by construction.
 */
export function planRestore(
  view: HierarchyView,
  trashedItems: ReadonlyArray<CanonicalItem>,
  rememberedPlacements: ReadonlyArray<{
    readonly placementId: Uuid;
    readonly itemId: Uuid;
    readonly kind: Placement["kind"];
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  }>,
  command: RestoreCommand,
): DomainResult<RestorePlan> {
  const root = trashedItems.find((item) => item.id === command.itemId);
  if (root === undefined) {
    return err("item.not-found", "Item does not exist");
  }
  if (root.lifecycle !== "trashed") {
    return err("item.not-trashed", "Only trashed items can be restored");
  }

  const branchIds = new Set(trashedItems.map((item) => item.id));
  const restoredPlacements = rememberedPlacements.map((placement) => {
    if (placement.itemId !== root.id) {
      return placement; // descendant placements stay inside the branch
    }
    const rememberedParent = placement.parentItemId;
    const parentStillValid =
      rememberedParent === null ||
      branchIds.has(rememberedParent) ||
      view.getItem(rememberedParent)?.lifecycle === "active";
    if (parentStillValid && command.fallbackParentItemId === undefined) {
      return placement;
    }
    if (command.fallbackParentItemId === undefined) {
      return null; // signals that a fallback is required
    }
    return { ...placement, parentItemId: command.fallbackParentItemId };
  });

  if (restoredPlacements.includes(null)) {
    return err(
      "containment.parent-not-found",
      "Original parent is no longer valid; select a valid parent to restore into",
    );
  }
  const placements = restoredPlacements as ReadonlyArray<
    NonNullable<(typeof restoredPlacements)[number]>
  >;

  // Root placements must not create cycles or target invalid parents.
  for (const placement of placements) {
    if (placement.itemId !== root.id || placement.parentItemId === null) {
      continue;
    }
    if (branchIds.has(placement.parentItemId)) {
      continue;
    }
    const parent = view.getItem(placement.parentItemId);
    if (parent === null || parent.lifecycle !== "active") {
      return err("containment.parent-not-found", "Restore destination is not an active item");
    }
    if (parent.kind === "file") {
      return err("containment.file-cannot-contain", "Files cannot contain restored items");
    }
    if (placement.kind === "attachment" && parent.kind !== "page") {
      return err("containment.attachment-parent-must-be-page", "Attachments require a page parent");
    }
    if (
      placement.kind === "hierarchy" &&
      wouldCreateCycle(view, placement.itemId, placement.parentItemId)
    ) {
      return err("containment.cycle-rejected", "Restore would create a hierarchy cycle");
    }
  }

  return ok({
    rootItemId: root.id,
    itemIds: trashedItems.map((item) => item.id),
    restoredPlacements: placements,
  });
}

/** Deterministic purge eligibility (retention workers are a later feature). */
export function isPurgeEligible(item: CanonicalItem, now: () => Date = () => new Date()): boolean {
  return (
    item.lifecycle === "trashed" &&
    item.purgeAfter !== null &&
    Date.parse(item.purgeAfter) <= now().getTime()
  );
}
