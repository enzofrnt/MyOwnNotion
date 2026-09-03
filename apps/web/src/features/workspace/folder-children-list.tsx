import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger, Status } from "../../ui/primitives/index.ts";
import { NavigationInlineCreate } from "../navigation/navigation-inline-create.tsx";

export interface FolderChild {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemIconKind;
  readonly icon?: string | null;
  /** Number of direct children, shown as a hint for folders. */
  readonly childCount: number;
}

export interface FolderReorderRequest {
  readonly itemId: string;
  readonly targetId: string;
  readonly edge: "before" | "after";
}

export interface FolderChildrenListProps {
  readonly folderName: string;
  readonly items: readonly FolderChild[];
  readonly onOpen: (itemId: string) => void;
  readonly onReorder: (request: FolderReorderRequest) => void;
}

const KIND_LABEL: Record<ItemIconKind, string> = {
  page: "Page",
  folder: "Dossier",
  file: "Fichier",
};

function childLabel(child: FolderChild): string {
  return child.name.trim() || "Sans titre";
}

function childHint(child: FolderChild): string {
  if (child.kind !== "folder") return KIND_LABEL[child.kind];
  if (child.childCount === 0) return "Dossier vide";
  return child.childCount === 1 ? "1 élément" : `${child.childCount} éléments`;
}

/**
 * Turns a sortable drop (from → to index) into the before/after intent the
 * hierarchy already understands, so the folder list and the sidebar tree
 * produce exactly the same placement mutation.
 */
export function reorderRequestFromIndexes(
  items: readonly FolderChild[],
  from: number,
  to: number,
): FolderReorderRequest | null {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
  const moved = items[from];
  const target = items[to];
  if (moved === undefined || target === undefined) return null;
  return { itemId: moved.id, targetId: target.id, edge: from < to ? "after" : "before" };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

interface PendingOrder {
  /** Order the projection had when the owner dropped. */
  readonly base: readonly string[];
  /** Order the owner chose; shown until the projection catches up. */
  readonly target: readonly string[];
}

/**
 * Keeps the owner's chosen order on screen while the placement mutation is
 * applied and the projection refreshes (spec 022, FR-024). Without this the
 * list snaps back to the old order for a frame or two, which reads as a
 * failed drop. The override lifts as soon as the projection either matches the
 * target or changes in any other way (another device moved something, or the
 * mutation was rejected), so a stale override can never mask real state.
 */
export function useOptimisticOrder(items: readonly FolderChild[]): {
  readonly ordered: readonly FolderChild[];
  readonly reorder: (from: number, to: number) => void;
} {
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const ids = useMemo(() => items.map((child) => child.id), [items]);

  useEffect(() => {
    if (pending === null) return;
    if (sameOrder(ids, pending.target) || !sameOrder(ids, pending.base)) setPending(null);
  }, [ids, pending]);

  const ordered = useMemo(() => {
    if (pending === null || !sameOrder(ids, pending.base)) return items;
    const byId = new Map(items.map((child) => [child.id, child]));
    return pending.target.flatMap((id) => {
      const child = byId.get(id);
      return child === undefined ? [] : [child];
    });
  }, [ids, items, pending]);

  const reorder = (from: number, to: number): void => {
    const current = ordered.map((child) => child.id);
    setPending({ base: ids, target: arrayMove([...current], from, to) });
  };

  return { ordered, reorder };
}

export function FolderInlineCreate({
  folderName,
  onCreate,
}: {
  readonly folderName: string;
  readonly onCreate: (kind: "page" | "folder") => void;
}) {
  const [open, setOpen] = useState(false);
  const name = folderName.trim() || "Sans titre";
  return (
    <div className="folder-children__create">
      <NavigationInlineCreate
        itemName={name}
        variant="root"
        open={open}
        testIds={{
          root: "folder-inline-create",
          toggle: "folder-create-toggle",
          page: "folder-create-page",
          folder: "folder-create-folder",
        }}
        onOpenChange={setOpen}
        onCreatePage={() => onCreate("page")}
        onCreateFolder={() => onCreate("folder")}
      />
    </div>
  );
}

function SortableChildRow({
  child,
  index,
  count,
  onMove,
  onOpen,
}: {
  readonly child: FolderChild;
  readonly index: number;
  readonly count: number;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onOpen: () => void;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: child.id });
  const label = childLabel(child);
  return (
    <li
      ref={setNodeRef}
      className="folder-children__row"
      data-testid="folder-child"
      data-item-id={child.id}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="folder-children__handle"
        aria-label={`Déplacer ${label}`}
        title="Glisser pour réordonner (Espace puis flèches au clavier)"
        {...attributes}
        {...listeners}
      >
        <AppIcon name="drag" size="small" />
      </button>
      <button
        type="button"
        className="folder-children__link"
        data-testid="folder-child-link"
        onClick={onOpen}
      >
        <ItemIcon kind={child.kind} icon={child.icon ?? null} size="inline" />
        <span className="folder-children__name">{label}</span>
        <span className="folder-children__hint">{childHint(child)}</span>
      </button>
      <MenuRoot placement="bottom-end">
        <MenuTrigger
          className="folder-children__menu"
          aria-label={`Actions pour ${label}`}
          data-testid="folder-child-menu"
        >
          <AppIcon name="more" size="small" />
        </MenuTrigger>
        <MenuContent aria-label={`Actions pour ${label}`}>
          <MenuItem onClick={onOpen}>Ouvrir</MenuItem>
          <MenuItem disabled={index === 0} onClick={() => onMove(-1)}>
            Monter
          </MenuItem>
          <MenuItem disabled={index === count - 1} onClick={() => onMove(1)}>
            Descendre
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </li>
  );
}

/**
 * A folder's canvas: its direct children as links, in hierarchy order
 * (spec 022, US3). Reordering here is the same placement move the sidebar
 * performs, so both surfaces converge on every device.
 */
export function FolderChildrenList({
  folderName,
  items,
  onOpen,
  onReorder,
}: FolderChildrenListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { ordered, reorder } = useOptimisticOrder(items);

  const place = (from: number, to: number): void => {
    const request = reorderRequestFromIndexes(ordered, from, to);
    if (request === null) return;
    reorder(from, to);
    onReorder(request);
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const over = event.over;
    if (over === null || over.id === event.active.id) return;
    place(
      ordered.findIndex((child) => child.id === event.active.id),
      ordered.findIndex((child) => child.id === over.id),
    );
  };

  if (items.length === 0) {
    return (
      <section
        className="folder-children folder-children--empty"
        aria-label={`Contenu du dossier ${folderName.trim() || "Sans titre"}`}
        data-testid="folder-children"
      >
        <Status kind="info" title="Ce dossier est vide">
          Ajoutez une page ou un sous-dossier pour commencer à l’organiser.
        </Status>
      </section>
    );
  }

  return (
    <section
      className="folder-children"
      aria-label={`Contenu du dossier ${folderName.trim() || "Sans titre"}`}
      data-testid="folder-children"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={ordered.map((child) => child.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="folder-children__list">
            {ordered.map((child, index) => (
              <SortableChildRow
                key={child.id}
                child={child}
                index={index}
                count={ordered.length}
                onMove={(direction) => place(index, index + direction)}
                onOpen={() => onOpen(child.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}
