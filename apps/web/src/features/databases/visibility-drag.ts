import type { DatabaseProperty, DatabaseView } from "@myownnotion/domain";
import { columnPresentations, type ViewColumn, viewColumns } from "./view-columns.ts";

export type VisibilityGroup = "visible" | "hidden";

/**
 * Drop position expressed against a rendered neighbour, not against an index.
 *
 * The visibility page can be filtered by the search field, so an index in the
 * rendered list does not map to an index in the full view order. Anchoring the
 * drop to a neighbour keeps the preview and the persisted order aligned.
 */
export interface VisibilityDropTarget {
  readonly group: VisibilityGroup;
  readonly neighbourId: string;
  readonly side: "before" | "after";
}

export interface VisibilityRowBox {
  readonly id: string;
  readonly group: VisibilityGroup;
  readonly top: number;
  readonly height: number;
}

export interface VisibilityGroupsPreview {
  readonly visible: ViewColumn[];
  readonly hidden: ViewColumn[];
}

/**
 * Reorders the rendered groups for the current drop target. The dragged column
 * takes the neighbour's place so every other row shows where the drop will land.
 * Nothing is persisted here.
 */
export function previewVisibilityGroups(
  columns: readonly ViewColumn[],
  drag: { readonly id: string; readonly target: VisibilityDropTarget | null } | null,
): VisibilityGroupsPreview {
  const visible = columns.filter((column) => column.visible);
  const hidden = columns.filter((column) => !column.visible);
  const target = drag?.target ?? null;
  if (drag === null || target === null) return { visible, hidden };
  const dragged = columns.find((column) => column.property.id === drag.id);
  if (dragged === undefined) return { visible, hidden };
  const source = dragged.visible ? visible : hidden;
  const sourceIndex = source.findIndex((column) => column.property.id === drag.id);
  if (sourceIndex < 0) return { visible, hidden };
  source.splice(sourceIndex, 1);
  const rows = target.group === "visible" ? visible : hidden;
  const neighbourIndex = rows.findIndex((column) => column.property.id === target.neighbourId);
  if (neighbourIndex < 0) {
    source.splice(Math.min(sourceIndex, source.length), 0, dragged);
    return { visible, hidden };
  }
  const previewed =
    dragged.property.type === "title"
      ? dragged
      : { ...dragged, visible: target.group === "visible" };
  rows.splice(neighbourIndex + (target.side === "after" ? 1 : 0), 0, previewed);
  return { visible, hidden };
}

export function sameVisibilityTarget(
  left: VisibilityDropTarget | null,
  right: VisibilityDropTarget | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.group === right.group && left.neighbourId === right.neighbourId && left.side === right.side
  );
}

/**
 * Keeps the floating row under the pointer: its layout slot already holds the
 * drop position, so the translation is measured against the untransformed top
 * instead of being derived from the pointer delta alone.
 *
 * Crossing groups remounts the row, so a new node starts without the previous
 * inline transform and the last translation no longer applies to it.
 */
export function applyVisibilityDragTransform(
  node: HTMLElement,
  drag: {
    readonly grabOffset: number;
    readonly pointerY: number;
    node: HTMLElement | null;
    translate: number;
  },
): void {
  if (drag.node !== node) {
    drag.node = node;
    drag.translate = 0;
  }
  const rect = node.getBoundingClientRect();
  const staticTop = rect.top - drag.translate;
  const desiredTop = drag.pointerY - drag.grabOffset;
  const next = desiredTop - staticTop;
  drag.translate = next;
  node.style.transform = Math.abs(next) < 0.5 ? "" : `translateY(${String(next)}px)`;
}

/**
 * Resolves the drop target from the rows currently painted: the group under the
 * pointer, then the neighbour whose midpoint the pointer already crossed.
 * The dragged row itself is excluded so its floating translation cannot feed
 * back into the target.
 */
export function resolveVisibilityDropTarget(
  boxes: readonly VisibilityRowBox[],
  pointerY: number,
  draggedId: string,
): VisibilityDropTarget | null {
  const others = boxes.filter((box) => box.id !== draggedId);
  if (others.length === 0) return null;
  const spans = new Map<VisibilityGroup, { top: number; bottom: number }>();
  for (const box of others) {
    const span = spans.get(box.group);
    if (span === undefined) {
      spans.set(box.group, { top: box.top, bottom: box.top + box.height });
      continue;
    }
    span.top = Math.min(span.top, box.top);
    span.bottom = Math.max(span.bottom, box.top + box.height);
  }
  let group: VisibilityGroup | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [candidate, span] of spans) {
    const distance =
      pointerY < span.top
        ? span.top - pointerY
        : pointerY > span.bottom
          ? pointerY - span.bottom
          : 0;
    if (distance < nearest) {
      nearest = distance;
      group = candidate;
    }
  }
  if (group === null) return null;
  const rows = others.filter((box) => box.group === group);
  if (rows.length === 0) return null;
  const crossed = rows.filter((box) => box.top + box.height / 2 < pointerY).length;
  const neighbour = rows[Math.min(crossed, rows.length - 1)];
  if (neighbour === undefined) return null;
  return {
    group,
    neighbourId: neighbour.id,
    side: crossed >= rows.length ? "after" : "before",
  };
}

/**
 * Persisted reorder for one property visibility drag: the property changes
 * group when dropped on the other list and is inserted next to its rendered
 * neighbour. Returns `null` when the drop leaves the order and visibility as
 * they are.
 */
export function moveVisibilityProperty(
  properties: readonly DatabaseProperty[],
  presentations: DatabaseView["properties"],
  propertyId: string,
  target: VisibilityDropTarget,
): DatabaseView["properties"] | null {
  const columns = [...viewColumns(properties, presentations)];
  const dragged = columns.find((column) => column.property.id === propertyId);
  if (dragged === undefined) return null;
  const next = columns.filter((column) => column.property.id !== propertyId);
  const neighbourIndex = next.findIndex((column) => column.property.id === target.neighbourId);
  if (neighbourIndex < 0) return null;
  const moved: ViewColumn = {
    property: dragged.property,
    visible: dragged.property.type === "title" ? true : target.group === "visible",
  };
  next.splice(neighbourIndex + (target.side === "after" ? 1 : 0), 0, moved);
  const unchanged = next.every(
    (column, index) =>
      column.property.id === columns[index]?.property.id &&
      column.visible === columns[index]?.visible,
  );
  if (unchanged) return null;
  return columnPresentations(presentations, next).map((presentation, position) => ({
    ...presentation,
    positionKey: `col-${String(position + 1).padStart(6, "0")}`,
  }));
}
