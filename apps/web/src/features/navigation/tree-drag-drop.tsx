import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ReactNode, RefCallback } from "react";
import { useMemo } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export interface TreeDragItem {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly siblingIndex: number;
  readonly canContainChildren: boolean;
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

const treeKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { active, currentCoordinates, context },
) => {
  if (
    event.code !== "ArrowUp" &&
    event.code !== "ArrowDown" &&
    event.code !== "ArrowLeft" &&
    event.code !== "ArrowRight"
  ) {
    return undefined;
  }
  event.preventDefault();

  const rows = context.droppableContainers.getEnabled().flatMap((container) => {
    const target = parseTreeDropTargetId(String(container.id));
    if (target?.zone !== "before") return [];
    const rect = context.droppableRects.get(container.id);
    return rect === undefined ? [] : [{ id: target.itemId, top: rect.top }];
  });
  const currentDropTarget = parseTreeDropTargetId(String(context.over?.id ?? ""));
  const currentItemId = currentDropTarget?.itemId ?? String(active);
  const targetId =
    event.code === "ArrowUp" || event.code === "ArrowDown"
      ? adjacentTreeKeyboardDropTarget(
          rows,
          currentItemId,
          event.code === "ArrowUp" ? "up" : "down",
        )
      : currentDropTarget === null || currentDropTarget.itemId === String(active)
        ? null
        : treeDropTargetId(
            currentDropTarget.itemId,
            event.code === "ArrowRight" ? "inside" : "before",
          );
  if (targetId === null || context.collisionRect === null) return undefined;
  const targetRect = context.droppableRects.get(targetId);
  if (targetRect === undefined) return undefined;

  return {
    x: currentCoordinates.x,
    y: targetRect.top + targetRect.height / 2 - context.collisionRect.height / 2,
  };
};

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

const treeCollisionDetection: CollisionDetection = (input) => {
  const pointerCollisions = pointerWithin(input);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(input);
};

function dropTargetName(byId: ReadonlyMap<string, TreeDragItem>, dropTargetId: string): string {
  const target = parseTreeDropTargetId(dropTargetId);
  if (target === null) return "la cible";
  const name = byId.get(target.itemId)?.name ?? "l’élément";
  return target.zone === "inside"
    ? `dans ${name}`
    : target.zone === "before"
      ? `avant ${name}`
      : `après ${name}`;
}

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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: treeKeyboardCoordinates }),
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const itemName = (id: string): string => byId.get(id)?.name ?? "l’élément";

  const finishDrag = (event: DragEndEvent): void => {
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
      onDragEnd={finishDrag}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Appuyez sur Espace pour saisir une ligne, utilisez les flèches pour choisir une cible, puis Espace pour déposer. Échap annule.",
        },
        announcements: {
          onDragStart: ({ active }) => `${itemName(String(active.id))} saisi.`,
          onDragOver: ({ active, over }) =>
            over === null
              ? `${itemName(String(active.id))} n’est au-dessus d’aucune cible.`
              : `${itemName(String(active.id))} ${dropTargetName(byId, String(over.id))}.`,
          onDragEnd: ({ active, over }) =>
            over === null
              ? `Déplacement de ${itemName(String(active.id))} annulé.`
              : `${itemName(String(active.id))} déposé ${dropTargetName(byId, String(over.id))}.`,
          onDragCancel: ({ active }) => `Déplacement de ${itemName(String(active.id))} annulé.`,
        },
      }}
    >
      {children}
    </DndContext>
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
  }) => ReactNode;
}) {
  const before = useDroppable({ id: treeDropTargetId(itemId, "before") });
  const inside = useDroppable({
    id: treeDropTargetId(itemId, "inside"),
    disabled: !canContainChildren,
  });
  const after = useDroppable({ id: treeDropTargetId(itemId, "after") });
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
    setInsideRef: inside.setNodeRef,
    setAfterRef: after.setNodeRef,
  });
}

export function TreeDragHandle({
  itemId,
  itemName,
}: {
  readonly itemId: string;
  readonly itemName: string;
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: itemId,
    attributes: { role: "button", roleDescription: "poignée de déplacement" },
  });

  return (
    <Button
      {...attributes}
      {...listeners}
      ref={setNodeRef}
      className="tree-drag-handle"
      size="square"
      variant="ghost"
      aria-label={`Déplacer ${itemName}`}
      data-testid={`drag-${itemName}`}
      data-dragging={isDragging || undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <AppIcon name="drag" size="small" />
    </Button>
  );
}
