import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type KeyboardEvent, useCallback, useEffect, useRef, type WheelEvent } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";

/** Keep the strip on one line: a vertical drag must not lift or sink neighbours. */
const restrictTabsToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

export function isCloseTabShortcut(event: {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return (
    event.key.toLocaleLowerCase("en") === "w" &&
    (event.ctrlKey || event.metaKey) &&
    event.altKey !== true
  );
}

export interface OpenTab {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemIconKind | "graph";
  readonly icon?: string | null;
}

export interface OpenTabsStripProps {
  readonly tabs: readonly OpenTab[];
  readonly activeId: string | null;
  readonly onActivate: (itemId: string) => void;
  readonly onClose: (itemId: string) => void;
  readonly onEmptyFocus: () => void;
  /** Device-local strip order. Omitted when the strip has a single tab. */
  readonly onReorder?: (activeId: string, overId: string) => void;
}

function tabLabel(tab: OpenTab): string {
  return tab.name.trim() || "Sans titre";
}

function findActivationButton(
  list: HTMLDivElement | null,
  itemId: string,
): HTMLElement | undefined {
  return [...(list?.querySelectorAll<HTMLElement>("[data-open-tab-activate]") ?? [])].find(
    (button) => button.dataset["tabId"] === itemId,
  );
}

function SortableOpenTab({
  tab,
  active,
  keyboardEntryId,
  onActivate,
  onRequestClose,
}: {
  readonly tab: OpenTab;
  readonly active: boolean;
  readonly keyboardEntryId: string | null;
  readonly onActivate: (itemId: string) => void;
  readonly onRequestClose: (itemId: string) => void;
}) {
  const label = tabLabel(tab);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: tab.id,
  });
  // Sorting strategy is horizontal, but pointer deltas still carry a Y that
  // would shove neighbours up/down. Keep every tab on the strip baseline.
  const horizontalTransform = transform === null ? null : { ...transform, y: 0 };

  return (
    <div
      ref={setNodeRef}
      className="open-tab"
      data-active={active || undefined}
      data-dragging={isDragging || undefined}
      data-testid="open-tab"
      data-tab-id={tab.id}
      style={{ transform: CSS.Transform.toString(horizontalTransform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="open-tab__activate"
        aria-current={active ? "page" : undefined}
        title={`${label} — glisser pour réordonner`}
        data-open-tab-activate=""
        data-tab-id={tab.id}
        onClick={() => onActivate(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1) onRequestClose(tab.id);
        }}
        {...attributes}
        {...listeners}
        tabIndex={tab.id === keyboardEntryId ? 0 : -1}
      >
        {tab.kind === "graph" ? (
          <AppIcon name="graph" size="small" />
        ) : (
          <ItemIcon kind={tab.kind} icon={tab.icon ?? null} size="tree" />
        )}
        <span className="open-tab__label">{label}</span>
      </button>
      <button
        type="button"
        className="open-tab__close"
        aria-label={`Fermer l’onglet ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          onRequestClose(tab.id);
        }}
      >
        <AppIcon name="close" size="small" />
      </button>
    </div>
  );
}

/**
 * The strip of opened pages and folders at the top of the canvas (spec 022, US2).
 *
 * Tabs are navigation shortcuts, so the active one follows the URL rather than
 * owning it. The list scrolls horizontally instead of wrapping, the active tab
 * is scrolled into view when it changes, and arrow keys move focus between
 * destination buttons. Close buttons remain ordinary, separately focusable
 * controls so keyboard and assistive-technology users can reach them. Dragging
 * a tab (or Space then arrows) reorders the device-local strip.
 */
export function OpenTabsStrip({
  activeId,
  onActivate,
  onClose,
  onEmptyFocus,
  onReorder,
  tabs,
}: OpenTabsStripProps) {
  const list = useRef<HTMLDivElement | null>(null);
  const focusAfterClose = useRef<string | null>(null);
  const activeTabIndex = activeId === null ? -1 : tabs.findIndex((tab) => tab.id === activeId);
  const activeTabId = activeTabIndex >= 0 ? activeId : null;
  const keyboardEntryId = activeTabId ?? tabs[0]?.id ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const requestClose = useCallback(
    (itemId: string): void => {
      const index = tabs.findIndex((tab) => tab.id === itemId);
      const neighbour = tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
      focusAfterClose.current = neighbour;
      if (neighbour === null) onEmptyFocus();
      onClose(itemId);
    },
    [onClose, onEmptyFocus, tabs],
  );

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (activeTabId === null || !isCloseTabShortcut(event)) return;
      event.preventDefault();
      requestClose(activeTabId);
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, [activeTabId, requestClose]);

  useEffect(() => {
    // The active tab is often appended in the render that follows the route
    // change, so the strip must react to the list as well as to the id.
    if (activeTabId === null || activeTabIndex < 0) return;
    const active = findActivationButton(list.current, activeTabId);
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTabId, activeTabIndex]);

  useEffect(() => {
    const targetId = focusAfterClose.current;
    if (targetId === null) return;
    const currentTargetId = tabs.some((tab) => tab.id === targetId)
      ? targetId
      : (activeTabId ?? tabs[0]?.id ?? null);
    focusAfterClose.current = null;
    if (currentTargetId === null) {
      onEmptyFocus();
      return;
    }
    const target = findActivationButton(list.current, currentTargetId);
    if (target === undefined) {
      onEmptyFocus();
      return;
    }
    target.focus();
  }, [activeTabId, onEmptyFocus, tabs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    if (
      !(event.target instanceof HTMLElement) ||
      !event.target.matches("[data-open-tab-activate]")
    ) {
      return;
    }
    // While a sortable keyboard drag is active, Space/arrows belong to dnd-kit.
    if (event.target.closest("[data-dragging='true']")) return;
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-open-tab-activate]") ?? []),
    ];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowLeft") next = current <= 0 ? buttons.length - 1 : current - 1;
    else next = current >= buttons.length - 1 ? 0 : current + 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    // A mouse wheel only produces vertical deltas; translate them so the strip
    // can still be browsed without a trackpad.
    const element = list.current;
    if (element === null || event.deltaX !== 0 || event.deltaY === 0) return;
    if (element.scrollWidth <= element.clientWidth) return;
    element.scrollLeft += event.deltaY;
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const over = event.over;
    if (over === null || over.id === event.active.id || onReorder === undefined) return;
    onReorder(String(event.active.id), String(over.id));
  };

  if (tabs.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictTabsToHorizontalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
        <div
          ref={list}
          className="open-tabs"
          role="toolbar"
          aria-label="Éléments ouverts"
          aria-orientation="horizontal"
          data-testid="open-tabs"
          onKeyDown={onKeyDown}
          onWheel={onWheel}
        >
          {tabs.map((tab) => (
            <SortableOpenTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              keyboardEntryId={keyboardEntryId}
              onActivate={onActivate}
              onRequestClose={requestClose}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
