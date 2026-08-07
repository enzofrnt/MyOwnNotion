/**
 * In-memory content graph used by domain property tests: a synchronous
 * HierarchyView plus mutation helpers mirroring adapter behavior.
 */
import {
  generateUuidV7,
  sortSiblings,
  type CanonicalItem,
  type HierarchyView,
  type ItemKind,
  type Placement,
  type PlacementKind,
  type Uuid,
} from "@myownnotion/domain";

export class MemoryGraph implements HierarchyView {
  readonly items = new Map<string, CanonicalItem>();
  readonly placements = new Map<string, Placement>();
  readonly workspaceId = generateUuidV7();

  getItem(id: Uuid): CanonicalItem | null {
    return this.items.get(id) ?? null;
  }

  getActivePlacements(itemId: Uuid): Placement[] {
    return [...this.placements.values()].filter(
      (placement) => placement.itemId === itemId && placement.removedAt === null,
    );
  }

  getActiveChildren(parentItemId: Uuid | null): Placement[] {
    return sortSiblings(
      [...this.placements.values()].filter(
        (placement) =>
          placement.kind === "hierarchy" &&
          placement.removedAt === null &&
          placement.parentItemId === parentItemId &&
          this.items.get(placement.itemId)?.lifecycle === "active",
      ),
    );
  }

  addItem(kind: ItemKind, name: string, lifecycle: CanonicalItem["lifecycle"] = "active"): Uuid {
    const id = generateUuidV7();
    this.items.set(id, {
      id,
      workspaceId: this.workspaceId,
      kind,
      name,
      lifecycle,
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: generateUuidV7(),
    });
    return id;
  }

  addPlacement(
    itemId: Uuid,
    parentItemId: Uuid | null,
    positionKey: string,
    kind: PlacementKind = "hierarchy",
  ): Uuid {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new Error("unknown item");
    }
    const id = generateUuidV7();
    this.placements.set(id, {
      id,
      workspaceId: this.workspaceId,
      itemId,
      itemKind: item.kind,
      kind,
      parentItemId,
      positionKey,
      removedAt: null,
    });
    return id;
  }

  movePlacement(placementId: Uuid, parentItemId: Uuid | null, positionKey: string): void {
    const placement = this.placements.get(placementId);
    if (placement === undefined) {
      throw new Error("unknown placement");
    }
    this.placements.set(placementId, { ...placement, parentItemId, positionKey });
  }
}
