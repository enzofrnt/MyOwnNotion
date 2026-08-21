import type { ProjectedItem } from "@myownnotion/client-core";
import { useMemo } from "react";

export interface ActiveItemState {
  readonly item: ProjectedItem | null;
  /** Root-to-current path, always carrying the same stable item identities. */
  readonly path: readonly ProjectedItem[];
}

function hierarchyParentId(item: ProjectedItem): ProjectedItem["id"] | null {
  return item.placements.find((placement) => placement.kind === "hierarchy")?.parentItemId ?? null;
}

/**
 * Builds a breadcrumb from stable identities, surviving rename and move.
 * Invalid legacy cycles stop at the first repeated identity instead of hanging
 * the shell; canonical mutation validation still rejects creating such cycles.
 */
export function activeItemState(
  items: readonly ProjectedItem[],
  selectedId: ProjectedItem["id"] | null,
): ActiveItemState {
  if (selectedId === null) return { item: null, path: [] };
  const byId = new Map(items.map((item) => [item.id, item]));
  const item = byId.get(selectedId) ?? null;
  if (item === null) return { item: null, path: [] };

  const path: ProjectedItem[] = [];
  const visited = new Set<string>();
  let current: ProjectedItem | undefined = item;
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    const parentId = hierarchyParentId(current);
    current = parentId === null ? undefined : byId.get(parentId);
  }
  return { item, path };
}

export function useActiveItem(
  items: readonly ProjectedItem[],
  selectedId: ProjectedItem["id"] | null,
): ActiveItemState {
  return useMemo(() => activeItemState(items, selectedId), [items, selectedId]);
}
