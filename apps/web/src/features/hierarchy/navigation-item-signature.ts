import type { ProjectedItem } from "@myownnotion/client-core";
import { pageBodyHoldsEditorialContent, type Uuid } from "@myownnotion/domain";

/**
 * Tree-visible identity of an item. Page body text and revision ids change on
 * every keystroke; the sidebar must not treat those as a new catalog. The one
 * body signal that *is* tree-visible is whether the page holds any editorial
 * content at all — that flips the blank-page vs lined-page glyph.
 */
export function pageHoldsTreeContent(item: ProjectedItem): boolean {
  if (item.kind !== "page") return true;
  return pageBodyHoldsEditorialContent(item.pageDocument?.body);
}

/**
 * Tree-visible identity of an item. Page bodies and revision ids change on
 * every keystroke; the sidebar must not treat those as a new catalog.
 */
export function navigationIdentityKey(item: ProjectedItem): string {
  const placements = item.placements
    .map(
      (placement) => `${placement.kind}:${placement.parentItemId ?? ""}:${placement.positionKey}`,
    )
    .toSorted()
    .join(";");
  return [
    item.id,
    item.kind,
    item.name,
    item.icon ?? "",
    item.lifecycle,
    item.favourite ? "1" : "0",
    item.offlineIntent ? "1" : "0",
    item.localAvailability,
    item.trashedAt ?? "",
    pageHoldsTreeContent(item) ? "1" : "0",
    placements,
  ].join("\u001f");
}

export function replaceProjectedItem(
  items: readonly ProjectedItem[],
  trashed: readonly ProjectedItem[],
  itemId: Uuid,
  next: ProjectedItem | null,
  sourceItemIds: ReadonlySet<Uuid> = new Set(),
): {
  readonly items: ProjectedItem[];
  readonly trashed: ProjectedItem[];
  readonly catalogChanged: boolean;
} {
  return replaceProjectedItems(
    items,
    trashed,
    [itemId],
    next === null ? [] : [next],
    sourceItemIds,
  );
}

/** Applies a committed batch with one catalog scan, retaining unaffected item objects. */
export function replaceProjectedItems(
  items: readonly ProjectedItem[],
  trashed: readonly ProjectedItem[],
  itemIds: readonly Uuid[],
  projectedItems: readonly ProjectedItem[],
  sourceItemIds: ReadonlySet<Uuid> = new Set(),
): {
  readonly items: ProjectedItem[];
  readonly trashed: ProjectedItem[];
  readonly catalogChanged: boolean;
} {
  const changedIds = new Set(itemIds);
  const previousById = new Map<Uuid, ProjectedItem>();
  for (const item of items) previousById.set(item.id, item);
  for (const item of trashed) {
    if (!previousById.has(item.id)) previousById.set(item.id, item);
  }
  const projectedById = new Map(projectedItems.map((item) => [item.id, item] as const));
  const nextItems = items.filter((item) => !changedIds.has(item.id));
  const nextTrashed = trashed.filter((item) => !changedIds.has(item.id));
  let catalogChanged = false;
  for (const itemId of changedIds) {
    const previous = previousById.get(itemId) ?? null;
    let next = projectedById.get(itemId) ?? null;
    if (next !== null && next.placements.length === 0 && sourceItemIds.has(next.id)) next = null;
    if (next !== null && next.lifecycle === "trashed") nextTrashed.push(next);
    else if (next !== null && next.lifecycle === "active") nextItems.push(next);
    const before = previous === null ? "" : navigationIdentityKey(previous);
    const after = next === null || next.lifecycle === "purged" ? "" : navigationIdentityKey(next);
    catalogChanged ||= before !== after;
  }
  return {
    items: nextItems,
    trashed: nextTrashed,
    catalogChanged,
  };
}
