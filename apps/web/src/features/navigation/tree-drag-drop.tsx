import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ReactNode, PointerEvent as ReactPointerEvent, RefCallback } from "react";
import { useCallback, useEffect, useRef } from "react";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";

export const TREE_GRABBING_ATTRIBUTE = "data-tree-grabbing";

export interface TreeDragItem {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly siblingIndex: number;
  readonly canContainChildren: boolean;
  readonly kind?: ItemIconKind;
  readonly icon?: string | null;
}

export function setDocumentTreeGrabbing(active: boolean): void {
  if (typeof document === "undefined") return;
  if (active) {
    document.documentElement.setAttribute(TREE_GRABBING_ATTRIBUTE, "true");
  } else {
    document.documentElement.removeAttribute(TREE_GRABBING_ATTRIBUTE);
  }
}

export type TreeDropZone = "before" | "inside" | "after";

const TREE_DROP_TARGET_PREFIX = "tree-drop:";

export function treeDropTargetId(itemId: string, zone: TreeDropZone): string {
  return `${TREE_DROP_TARGET_PREFIX}${zone}:${encodeURIComponent(itemId)}`;
}

export function parseTreeDropTargetId(
  targetId: string,
): { readonly itemId: string; readonly zone: TreeDropZone } | null {
  if (!targetId.startsWith(TREE_DROP_TARGET_PREFIX)) return null;
  const encoded = targetId.slice(TREE_DROP_TARGET_PREFIX.length);
  const separator = encoded.indexOf(":");
  if (separator < 0) return null;
  const zone = encoded.slice(0, separator);
  if (zone !== "before" && zone !== "inside" && zone !== "after") return null;
  try {
    return { itemId: decodeURIComponent(encoded.slice(separator + 1)), zone };
  } catch {
    return null;
  }
}

export type TreeDropIntent =
  | {
      readonly kind: "place";
      readonly itemId: string;
      readonly targetId: string;
      readonly parentId: string | null;
      readonly edge: "before" | "after";
    }
  | { readonly kind: "nest"; readonly itemId: string; readonly parentId: string }
  | {
      readonly kind: "rejected";
      readonly itemId: string;
      readonly targetId: string;
      readonly reason: "cycle";
    };

export interface TreeKeyboardRow {
  readonly id: string;
  readonly top: number;
}

/** Returns the adjacent row in visual order, never the row being moved. */
export function adjacentTreeKeyboardTarget(
  rows: readonly TreeKeyboardRow[],
  currentId: string,
  direction: "up" | "down",
): string | null {
  const ordered = [...rows].sort(
    (left, right) => left.top - right.top || left.id.localeCompare(right.id),
  );
  const currentIndex = ordered.findIndex((row) => row.id === currentId);
  if (currentIndex < 0) return null;
  const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
  return ordered[targetIndex]?.id ?? null;
}

export function adjacentTreeKeyboardDropTarget(
  rows: readonly TreeKeyboardRow[],
  currentId: string,
  direction: "up" | "down",
): string | null {
  const itemId = adjacentTreeKeyboardTarget(rows, currentId, direction);
  return itemId === null ? null : treeDropTargetId(itemId, direction === "up" ? "before" : "after");
}

function isBelow(
  byId: ReadonlyMap<string, TreeDragItem>,
  candidateId: string,
  ancestorId: string,
): boolean {
  const visited = new Set<string>();
  let current = byId.get(candidateId);
  while (current?.parentId !== null && current?.parentId !== undefined) {
    if (current.parentId === ancestorId) return true;
    if (visited.has(current.parentId)) return false;
    visited.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return false;
}

/** Resolves a gesture without mutating state, including the cycle guard. */
export function resolveTreeDrop(
  items: readonly TreeDragItem[],
  activeId: string,
  dropTargetId: string,
): TreeDropIntent | null {
  const dropTarget = parseTreeDropTargetId(dropTargetId);
  if (dropTarget === null) return null;
  const { itemId: targetId, zone } = dropTarget;
  if (activeId === targetId) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const active = byId.get(activeId);
  const target = byId.get(targetId);
  if (active === undefined || target === undefined) return null;

  if (isBelow(byId, target.id, active.id)) {
    return { kind: "rejected", itemId: active.id, targetId: target.id, reason: "cycle" };
  }

  if (zone === "inside") {
    if (!target.canContainChildren) return null;
    return { kind: "nest", itemId: active.id, parentId: target.id };
  }

  return {
    kind: "place",
    itemId: active.id,
    targetId: target.id,
    parentId: target.parentId,
    edge: zone,
  };
}

/**
 * The edge hit areas overlap the full-row "inside" target on purpose so they
 * remain easy to acquire. dnd-kit otherwise returns the row first and turns a
 * clear between-row gesture into nesting. Keep the geometric order, but put an
 * explicit insertion edge before the overlapping row.
 */
export function prioritizeTreeDropCollisions<T extends { readonly id: string | number }>(
  collisions: readonly T[],
): T[] {
  return collisions
    .map((collision, index) => ({
      collision,
      index,
      priority: parseTreeDropTargetId(String(collision.id))?.zone === "inside" ? 1 : 0,
    }))
    .toSorted((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ collision }) => collision);
}

const treeCollisionDetection: CollisionDetection = (input) => {
  const pointerCollisions = prioritizeTreeDropCollisions(pointerWithin(input));
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(input);
};

export function TreeDragDropProvider({
  children,
  items,
  onDrop,
  onRejected,
}: {
  readonly children: ReactNode;
  readonly items: readonly TreeDragItem[];
  readonly onDrop: (intent: Exclude<TreeDropIntent, { readonly kind: "rejected" }>) => void;
  readonly onRejected?: (intent: Extract<TreeDropIntent, { readonly kind: "rejected" }>) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dragging = useRef(false);

  useEffect(() => {
    const releaseHold = (): void => {
      if (!dragging.current) setDocumentTreeGrabbing(false);
    };
    window.addEventListener("pointerup", releaseHold, true);
    window.addEventListener("pointercancel", releaseHold, true);
    return () => {
      window.removeEventListener("pointerup", releaseHold, true);
      window.removeEventListener("pointercancel", releaseHold, true);
      dragging.current = false;
      setDocumentTreeGrabbing(false);
    };
  }, []);

  const finishDrag = (event: DragEndEvent): void => {
    dragging.current = false;
    setDocumentTreeGrabbing(false);
    if (event.over === null) return;
    const intent = resolveTreeDrop(items, String(event.active.id), String(event.over.id));
    if (intent === null) return;
    if (intent.kind === "rejected") {
      onRejected?.(intent);
      return;
    }
    onDrop(intent);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={treeCollisionDetection}
      autoScroll
      onDragStart={() => {
        dragging.current = true;
        setDocumentTreeGrabbing(true);
      }}
      onDragCancel={() => {
        dragging.current = false;
        setDocumentTreeGrabbing(false);
      }}
      onDragEnd={finishDrag}
    >
      {children}
      <TreeDragOverlay items={items} />
    </DndContext>
  );
}

function TreeDragOverlay({ items }: { readonly items: readonly TreeDragItem[] }) {
  const { active } = useDndContext();
  const item =
    active === null ? undefined : items.find((candidate) => candidate.id === String(active.id));
  const width = active?.rect.current.initial?.width;
  return (
    <DragOverlay className="tree-drag-overlay" dropAnimation={null} zIndex={60}>
      {item === undefined ? null : (
        <div
          className="tree-drag-phantom"
          data-testid="tree-drag-phantom"
          aria-hidden="true"
          style={width === undefined ? undefined : { width }}
        >
          <ItemIcon kind={item.kind ?? "page"} icon={item.icon ?? null} size="tree" />
          <span className="tree-name">{item.name}</span>
        </div>
      )}
    </DragOverlay>
  );
}

export function TreeDropTarget({
  canContainChildren,
  children,
  itemId,
}: {
  readonly canContainChildren: boolean;
  readonly itemId: string;
  readonly children: (state: {
    readonly activeZone: TreeDropZone | null;
    readonly setBeforeRef: RefCallback<HTMLElement>;
    readonly setInsideRef: RefCallback<HTMLElement>;
    readonly setAfterRef: RefCallback<HTMLElement>;
    readonly rowDragListeners: {
      readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    };
    readonly rowDragging: boolean;
    readonly consumeDragClick: () => boolean;
  }) => ReactNode;
}) {
  const draggable = useDraggable({ id: itemId });
  const before = useDroppable({ id: treeDropTargetId(itemId, "before") });
  const inside = useDroppable({
    id: treeDropTargetId(itemId, "inside"),
    disabled: !canContainChildren,
  });
  const after = useDroppable({ id: treeDropTargetId(itemId, "after") });
  const draggedSincePointerDown = useRef(false);
  if (draggable.isDragging) draggedSincePointerDown.current = true;
  const setInsideRef = useCallback(
    (node: HTMLElement | null) => {
      inside.setNodeRef(node);
      draggable.setNodeRef(node);
    },
    [draggable.setNodeRef, inside.setNodeRef],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      draggedSincePointerDown.current = false;
      if (event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, input, select, textarea, a, summary, [role='menuitem'], [data-no-tree-drag]",
        ) !== null
      ) {
        return;
      }
      setDocumentTreeGrabbing(true);
      draggable.listeners?.["onPointerDown"]?.(event);
    },
    [draggable.listeners],
  );
  const consumeDragClick = useCallback((): boolean => {
    const dragged = draggedSincePointerDown.current;
    draggedSincePointerDown.current = false;
    return dragged;
  }, []);
  const active = before.active ?? inside.active ?? after.active;
  const draggingAnotherItem = active !== null && String(active.id) !== itemId;
  return children({
    activeZone: !draggingAnotherItem
      ? null
      : before.isOver
        ? "before"
        : inside.isOver
          ? "inside"
          : after.isOver
            ? "after"
            : null,
    setBeforeRef: before.setNodeRef,
    setInsideRef,
    setAfterRef: after.setNodeRef,
    rowDragListeners: { onPointerDown },
    rowDragging: draggable.isDragging,
    consumeDragClick,
  });
}
