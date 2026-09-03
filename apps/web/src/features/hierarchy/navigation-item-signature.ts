import type { ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";

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
    placements,
  ].join("\u001f");
}

export function replaceProjectedItem(
  items: readonly ProjectedItem[],
  trashed: readonly ProjectedItem[],
  itemId: Uuid,
  next: ProjectedItem | null,
): {
  readonly items: ProjectedItem[];
  readonly trashed: ProjectedItem[];
  readonly catalogChanged: boolean;
} {
  const previous =
    items.find((item) => item.id === itemId) ?? trashed.find((item) => item.id === itemId) ?? null;
  const nextItems = items.filter((item) => item.id !== itemId);
  const nextTrashed = trashed.filter((item) => item.id !== itemId);
  if (next !== null && next.lifecycle === "trashed") nextTrashed.push(next);
  else if (next !== null && next.lifecycle === "active") nextItems.push(next);
  const before = previous === null ? "" : navigationIdentityKey(previous);
  const after = next === null || next.lifecycle === "purged" ? "" : navigationIdentityKey(next);
  return {
    items: nextItems,
    trashed: nextTrashed,
    catalogChanged: before !== after,
  };
}
