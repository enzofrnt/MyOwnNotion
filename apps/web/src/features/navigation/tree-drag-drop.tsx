import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
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
  targetId: string,
): TreeDropIntent | null {
  if (activeId === targetId) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const active = byId.get(activeId);
  const target = byId.get(targetId);
  if (active === undefined || target === undefined) return null;

  if (isBelow(byId, target.id, active.id)) {
    return { kind: "rejected", itemId: active.id, targetId: target.id, reason: "cycle" };
  }

  if (active.parentId === target.parentId) {
    return {
      kind: "place",
      itemId: active.id,
      targetId: target.id,
      parentId: target.parentId,
      edge: active.siblingIndex < target.siblingIndex ? "after" : "before",
    };
  }

  if (target.canContainChildren) {
    return { kind: "nest", itemId: active.id, parentId: target.id };
  }

  return {
    kind: "place",
    itemId: active.id,
    targetId: target.id,
    parentId: target.parentId,
    edge: "after",
  };
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
      collisionDetection={closestCenter}
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
              : `${itemName(String(active.id))} au-dessus de ${itemName(String(over.id))}.`,
          onDragEnd: ({ active, over }) =>
            over === null
              ? `Déplacement de ${itemName(String(active.id))} annulé.`
              : `${itemName(String(active.id))} déposé sur ${itemName(String(over.id))}.`,
          onDragCancel: ({ active }) => `Déplacement de ${itemName(String(active.id))} annulé.`,
        },
      }}
    >
      {children}
    </DndContext>
  );
}

export function TreeDropTarget({
  children,
  itemId,
}: {
  readonly itemId: string;
  readonly children: (state: {
    readonly isDropTarget: boolean;
    readonly setNodeRef: RefCallback<HTMLElement>;
  }) => ReactNode;
}) {
  const { active, isOver, setNodeRef } = useDroppable({ id: itemId });
  return children({
    isDropTarget: isOver && active !== null && String(active.id) !== itemId,
    setNodeRef,
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
