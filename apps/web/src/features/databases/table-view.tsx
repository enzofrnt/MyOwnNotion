// biome-ignore-all lint/a11y/noStaticElementInteractions: the place popover backdrop owns pointer dismissal around a non-modal field.
// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: this component intentionally implements the editable ARIA grid model required by the feature plan

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MeasuringStrategy,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseView,
  NonRelationPropertyValue,
  PlacePropertyValue,
  PropertyOption,
  Uuid,
} from "@myownnotion/domain";
import { numberConfigOf, statusDefaultOptionId } from "@myownnotion/domain";
import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
  type ThHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon } from "../../ui/item-icon.tsx";
import {
  AsyncState,
  Button,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { displayDatabaseValue } from "./database-value.ts";
import type { RollupTargetOption } from "./local-rollup.ts";
import { isChoiceProperty, OptionValueMenu, PropertyOptionsEditor } from "./option-appearance.tsx";
import { PlacePropertyField } from "./place-property-field.tsx";
import { ENTRY_PROPERTY_TYPES, PropertyConfiguration } from "./property-configuration.tsx";
import { DatabasePropertyIcon, PropertyIconPicker } from "./property-icon.tsx";
import { propertyMenuPosition } from "./property-menu-position.ts";
import { PropertyVisibilitySwitch } from "./property-visibility-switch.tsx";
import { observeTableScrollOffset } from "./table-scroll-observer.ts";
import { usePageHeaders } from "./use-page-headers.ts";
import { useTableViewport } from "./use-table-viewport.ts";
import {
  encodeDateRange,
  type RelationOption,
  type ValueDraft,
  ValueEditor,
  validateValueDraft,
} from "./value-editor.tsx";
import { reorderViewColumn, viewColumns, visibleViewColumns } from "./view-columns.ts";

const FEATURES = tableFeatures({
  columnFilteringFeature,
  columnGroupingFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  rowPaginationFeature,
});
const columnHelper = createColumnHelper<typeof FEATURES, DatabaseViewRow>();

export interface GridCellPosition {
  readonly row: number;
  readonly column: number;
}

function NumberDisplayCell({
  property,
  row,
}: {
  readonly property: DatabaseProperty;
  readonly row: DatabaseViewRow;
}) {
  const config = numberConfigOf(property);
  const value = row.values[property.id];
  if (value === undefined || value.kind !== "number" || config.display === "number") {
    return (
      <span className="database-cell-value database-cell-text">
        {displayDatabaseValue(row, property)}
      </span>
    );
  }
  const numeric = Number(value.decimal);
  const percent = Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
  const label = displayDatabaseValue(row, property);
  if (config.display === "bar") {
    return (
      <span className="database-number-display" aria-hidden="true">
        <span className="database-number-display__track">
          <span className="database-number-display__fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="database-number-display__value">{label}</span>
      </span>
    );
  }
  return (
    <span className="database-number-display" aria-hidden="true">
      <svg className="database-number-display__ring" viewBox="0 0 20 20" focusable="false">
        <title>Progression</title>
        <circle className="database-number-display__ring-track" cx="10" cy="10" r="8" />
        <circle
          className="database-number-display__ring-fill"
          cx="10"
          cy="10"
          r="8"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      <span className="database-number-display__value">{label}</span>
    </span>
  );
}

function TitleItemIcon({ row }: { readonly row: DatabaseViewRow }) {
  return (
    <ItemIcon
      kind={row.itemKind === "folder" ? "folder" : "page"}
      icon={row.icon ?? null}
      holdsContent={row.holdsContent === true}
      size="tree"
    />
  );
}

export type DatabaseCellUpdate =
  | { readonly kind: "title"; readonly title: string }
  | {
      readonly kind: "property";
      readonly propertyId: Uuid;
      readonly value?: NonRelationPropertyValue;
      readonly relationTargets?: readonly Uuid[];
      readonly optionMove?: { readonly from: Uuid | "missing"; readonly to: Uuid | "missing" };
    };

interface EditingCell {
  readonly key: string;
  readonly draft: ValueDraft;
  readonly error: string | null;
  readonly saving: boolean;
}

function draftForCell(property: DatabaseProperty, row: DatabaseViewRow): ValueDraft {
  if (property.type === "title") return row.title;
  if (property.type === "relation") return row.relationTargets[property.id] ?? [];
  const value = row.values[property.id] as NonRelationPropertyValue | undefined;
  if (value === undefined) {
    if (property.type === "checkbox") return false;
    if (property.type === "multi-select") return [];
    if (property.type === "status") return statusDefaultOptionId(property) ?? "";
    return "";
  }
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.decimal;
    case "date":
      return encodeDateRange(value.date, value.endDate);
    case "instant":
      return encodeDateRange(value.instant, value.endInstant);
    case "status":
    case "select":
      return value.optionId;
    case "multi-select":
      return value.optionIds;
    case "checkbox":
      return value.checked;
    case "files":
      return [...value.fileIds, ...(value.externalUrls ?? [])];
    case "place":
      return JSON.stringify(value);
  }
}

function isImmediateProperty(property: DatabaseProperty): boolean {
  return isChoiceProperty(property) || property.type === "checkbox";
}

function ImmediatePropertyControl({
  property,
  row,
  onCommit,
}: {
  readonly property: DatabaseProperty;
  readonly row: DatabaseViewRow;
  readonly onCommit: (draft: ValueDraft) => void;
}) {
  const draft = draftForCell(property, row);
  if (property.type === "checkbox") {
    return (
      <input
        className="database-cell-control"
        type="checkbox"
        aria-label={property.name}
        tabIndex={-1}
        checked={draft === true}
        onChange={(event) => onCommit(event.target.checked)}
      />
    );
  }
  if (!isChoiceProperty(property)) return null;
  return <OptionValueMenu property={property} row={row} onCommit={onCommit} />;
}

function openImmediateControl(cell: HTMLTableCellElement | undefined, key: string): void {
  const menu = cell?.querySelector<HTMLButtonElement>("button.option-menu__trigger");
  if (menu !== null && menu !== undefined) {
    menu.click();
    return;
  }
  const control = cell?.querySelector<HTMLSelectElement | HTMLInputElement>("select, input");
  if (control instanceof HTMLSelectElement) {
    control.focus();
    try {
      control.showPicker();
    } catch {
      // A later click on the focused menu still opens it when the gesture is gone.
    }
    return;
  }
  if (
    control instanceof HTMLInputElement &&
    control.type === "checkbox" &&
    (key === "Enter" || key === " " || key === "F2")
  ) {
    control.click();
  }
}

export function nextGridCell(
  current: GridCellPosition,
  key: string,
  rowCount: number,
  columnCount: number,
  ctrlKey = false,
): GridCellPosition {
  if (rowCount === 0 || columnCount === 0) return current;
  if (ctrlKey && key === "Home") return { row: 0, column: 0 };
  if (ctrlKey && key === "End") return { row: rowCount - 1, column: columnCount - 1 };
  switch (key) {
    case "ArrowLeft":
      return { ...current, column: Math.max(0, current.column - 1) };
    case "ArrowRight":
      return { ...current, column: Math.min(columnCount - 1, current.column + 1) };
    case "ArrowUp":
      return { ...current, row: Math.max(0, current.row - 1) };
    case "ArrowDown":
      return { ...current, row: Math.min(rowCount - 1, current.row + 1) };
    case "Home":
      return { ...current, column: 0 };
    case "End":
      return { ...current, column: columnCount - 1 };
    default:
      return current;
  }
}

function refKey(position: GridCellPosition): string {
  return `${position.row}:${position.column}`;
}

function focusCell(
  refs: MutableRefObject<Map<string, HTMLTableCellElement>>,
  position: GridCellPosition,
): void {
  queueMicrotask(() => refs.current.get(refKey(position))?.focus());
}

function visibleProperties(
  properties: readonly DatabaseProperty[],
  presentations: DatabaseView["properties"],
): DatabaseProperty[] {
  return visibleViewColumns(properties, presentations);
}

const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 800;

function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function DatabaseColumnResize({
  name,
  width,
  onPreview,
  onCommit,
  onDragging,
}: {
  readonly name: string;
  readonly width: number;
  readonly onPreview: (width: number) => void;
  readonly onCommit: (width: number) => void;
  readonly onDragging: (dragging: boolean) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [active, setActive] = useState(false);

  const finish = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setActive(false);
    onDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit(clampColumnWidth(current.startWidth + event.clientX - current.startX));
  };

  return (
    <button
      type="button"
      className="database-column-resize"
      data-active={active ? "" : undefined}
      data-testid="database-column-resize"
      aria-label={DATABASE_COPY.table.width(name, width)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is unavailable when the pointer is already gone. The move
          // listeners on the handle still track the drag.
        }
        setActive(true);
        onDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        onPreview(clampColumnWidth(current.startWidth + event.clientX - current.startX));
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onCommit(clampColumnWidth(width + (event.key === "ArrowRight" ? 20 : -20)));
      }}
    />
  );
}

function ColumnPropertyButton({
  property,
  view,
  onRename,
  onRetire,
  onChangeType,
  onChangeIcon,
  onChangeOptions,
  onChange,
  onToggleColumn,
  onSort,
  onFilter,
  onInsert,
  onDuplicate,
  properties,
  previewRow,
  previewRows,
  rollupProperties,
  rollupRelations,
}: {
  readonly property: DatabaseProperty;
  readonly view: DatabaseView;
  readonly properties: readonly DatabaseProperty[];
  readonly previewRow?: DatabaseViewRow | undefined;
  readonly previewRows?: readonly DatabaseViewRow[] | undefined;
  readonly rollupProperties?: readonly RollupTargetOption[] | undefined;
  readonly rollupRelations?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly onRename?: (propertyId: Uuid, name: string) => void;
  readonly onRetire?: (propertyId: Uuid) => void;
  readonly onChangeType?: (propertyId: Uuid, type: (typeof ENTRY_PROPERTY_TYPES)[number]) => void;
  readonly onChangeIcon?: (propertyId: Uuid, icon: string | null) => void;
  readonly onChangeOptions?: (propertyId: Uuid, options: readonly PropertyOption[]) => void;
  readonly onChange?: (
    propertyId: Uuid,
    edit: (property: DatabaseProperty) => DatabaseProperty,
  ) => void;
  readonly onToggleColumn?: (propertyId: Uuid, visible: boolean) => void;
  readonly onSort?: (propertyId: Uuid, direction: "ascending" | "descending" | null) => void;
  readonly onFilter?: (propertyId: Uuid) => void;
  readonly onInsert?: (propertyId: Uuid, side: "before" | "after") => void;
  readonly onDuplicate?: (propertyId: Uuid) => void;
}) {
  const [name, setName] = useState(property.name);
  const [submenu, setSubmenu] = useState<{
    readonly kind: "type" | "sort";
    readonly anchor: DOMRect;
    readonly menu: DOMRect;
    readonly keyboard: boolean;
  } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const configOpenRef = useRef(false);
  const menuElement = useRef<HTMLDivElement>(null);
  const flyoutElement = useRef<HTMLDivElement>(null);
  const submenuTrigger = useRef<HTMLButtonElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimers = (): void => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  };
  const openSubmenu = (
    kind: "type" | "sort",
    trigger: HTMLButtonElement,
    keyboard = false,
  ): void => {
    // While the property editor is open the menu stays mounted behind it; a
    // hover-opened flyout would sit above that editor and intercept its clicks.
    if (configOpenRef.current) return;
    cancelTimers();
    submenuTrigger.current = trigger;
    const anchor = trigger.getBoundingClientRect();
    setSubmenu({
      kind,
      anchor,
      menu: menuElement.current?.getBoundingClientRect() ?? anchor,
      keyboard,
    });
  };
  const hoverSubmenu = (kind: "type" | "sort", trigger: HTMLButtonElement): void => {
    if (configOpenRef.current) return;
    cancelTimers();
    hoverTimer.current = setTimeout(() => openSubmenu(kind, trigger), 100);
  };
  const leaveSubmenu = (): void => {
    cancelTimers();
    closeTimer.current = setTimeout(() => setSubmenu(null), 180);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  const [configAnchor, setConfigAnchor] = useState<DOMRect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (submenu === null) return;
    if (submenu.keyboard)
      flyoutElement.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (
        flyoutElement.current?.contains(event.target) ||
        menuElement.current?.contains(event.target)
      )
        return;
      setSubmenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [submenu]);
  const hasTypeConfig =
    isChoiceProperty(property) ||
    property.type === "number" ||
    property.type === "date" ||
    property.type === "created-time" ||
    property.type === "last-edited-time" ||
    property.type === "unique-id" ||
    property.type === "relation" ||
    property.type === "rollup" ||
    property.type === "formula";
  const label = (
    <span className="database-column-label">
      <DatabasePropertyIcon type={property.type} icon={property.icon} />
      <span className="database-column-label__name">{property.name}</span>
    </span>
  );
  if (onRename === undefined) return label;
  const sort = view.sorts.find((item) => item.propertyId === property.id);
  const filtered = view.filter.criteria.some(
    (criterion) => criterion.propertyId === property.id && criterion.operator === "is-not-empty",
  );
  return (
    <PopoverRoot
      open={menuOpen}
      setOpen={(next) => {
        if (!next && configOpenRef.current) return;
        setMenuOpen(next);
        if (!next) {
          setConfigOpen(false);
          configOpenRef.current = false;
          setSubmenu(null);
        }
      }}
    >
      <PopoverTrigger
        className="database-column-header"
        aria-label={DATABASE_COPY.page.editProperty(property.name)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.currentTarget.click();
        }}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent
        ref={menuElement}
        className="database-column-editor"
        autoFocusOnShow={false}
        getPersistentElements={() =>
          flyoutElement.current === null ? [] : [flyoutElement.current]
        }
        hideOnInteractOutside={(event) =>
          !(event.target instanceof Node && flyoutElement.current?.contains(event.target))
        }
        hideOnEscape={() => {
          if (submenu === null) return true;
          setSubmenu(null);
          submenuTrigger.current?.focus();
          return false;
        }}
        onPointerLeave={leaveSubmenu}
      >
        <div className="database-column-editor__heading">
          {onChangeIcon === undefined ? (
            <DatabasePropertyIcon type={property.type} icon={property.icon} />
          ) : (
            <PropertyIconPicker
              property={property}
              onChange={(icon) => onChangeIcon(property.id, icon)}
            />
          )}
          <input
            className="database-column-editor__name"
            value={name}
            aria-label={`Nom de ${property.name}`}
            placeholder={property.name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next.length === 0 || next === property.name) {
                setName(property.name);
                return;
              }
              onRename(property.id, next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div
          className="database-column-menu__actions"
          onPointerOver={(event) => {
            const button = event.target instanceof Element ? event.target.closest("button") : null;
            if (button !== null && button.getAttribute("aria-haspopup") !== "menu") leaveSubmenu();
          }}
        >
          <div className="database-column-menu__section">
            {onChange !== undefined && hasTypeConfig ? (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-editor__action-row"
                aria-expanded={configOpen}
                onClick={(event) => {
                  configOpenRef.current = true;
                  // A hover/focus submenu ("Trier", "Type") stays portaled while
                  // the editor is open and can sit above it; the property editor
                  // replaces that navigation, so clear it with the menu.
                  setSubmenu(null);
                  setConfigAnchor(event.currentTarget.getBoundingClientRect());
                  setConfigOpen(true);
                }}
              >
                <AppIcon name="viewOptions" size="medium" />
                <span>Modifier la propriété</span>
                <AppIcon name="chevronRight" size="small" />
              </Button>
            ) : null}
            <Button
              type="button"
              size="compact"
              variant="ghost"
              className="database-column-editor__type-row database-column-editor__action-row"
              aria-expanded={submenu?.kind === "type"}
              aria-haspopup="menu"
              disabled={onChangeType === undefined || property.type === "title"}
              onPointerEnter={(event) => {
                if (!event.currentTarget.disabled) hoverSubmenu("type", event.currentTarget);
              }}
              onClick={(event) => openSubmenu("type", event.currentTarget, event.detail === 0)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  openSubmenu("type", event.currentTarget, true);
                }
              }}
            >
              <AppIcon name="repeat2" size="medium" />
              <span>Modifier le type</span>
              <AppIcon name="chevronRight" size="small" />
            </Button>
          </div>
          <div className="database-column-menu__section">
            {onFilter === undefined ? null : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-editor__action-row"
                aria-pressed={filtered}
                onClick={() => onFilter(property.id)}
              >
                <AppIcon name="filter" size="medium" />
                <span>Filtrer</span>
              </Button>
            )}
            {onSort === undefined ? null : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-editor__action-row"
                aria-expanded={submenu?.kind === "sort"}
                aria-haspopup="menu"
                onPointerEnter={(event) => {
                  if (!event.currentTarget.disabled) hoverSubmenu("sort", event.currentTarget);
                }}
                onClick={(event) => openSubmenu("sort", event.currentTarget, event.detail === 0)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    openSubmenu("sort", event.currentTarget, true);
                  }
                }}
              >
                <AppIcon name="sort" size="medium" />
                <span>Trier</span>
                <AppIcon name="chevronRight" size="small" />
              </Button>
            )}
            {property.type === "title" || onToggleColumn === undefined ? null : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-editor__action-row"
                onClick={() => onToggleColumn(property.id, false)}
              >
                <AppIcon name="eyeOff" size="medium" />
                <span>{DATABASE_COPY.page.hideProperty}</span>
              </Button>
            )}
          </div>
          <div className="database-column-menu__section">
            {property.type === "title" || onInsert === undefined ? null : (
              <>
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  className="database-column-editor__action-row"
                  onClick={() => onInsert(property.id, "before")}
                >
                  <AppIcon name="arrowLeft" size="medium" />
                  <span>{DATABASE_COPY.page.insertBefore}</span>
                </Button>
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  className="database-column-editor__action-row"
                  onClick={() => onInsert(property.id, "after")}
                >
                  <AppIcon name="arrowRight" size="medium" />
                  <span>{DATABASE_COPY.page.insertAfter}</span>
                </Button>
              </>
            )}
            {property.type === "title" || onDuplicate === undefined ? null : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-editor__action-row"
                onClick={() => onDuplicate(property.id)}
              >
                <AppIcon name="copy" size="medium" />
                <span>{DATABASE_COPY.page.duplicateProperty}</span>
              </Button>
            )}
            {property.type !== "title" && onRetire !== undefined ? (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                className="database-column-menu__danger database-column-editor__action-row"
                onClick={() => onRetire(property.id)}
              >
                <AppIcon name="delete" size="medium" />
                <span>{DATABASE_COPY.page.deleteProperty}</span>
              </Button>
            ) : null}
          </div>
        </div>
        {isChoiceProperty(property) &&
        onChangeOptions !== undefined &&
        onChange === undefined &&
        submenu?.kind !== "type" ? (
          <PropertyOptionsEditor
            options={property.config.options}
            onChange={(options) => onChangeOptions(property.id, options)}
          />
        ) : null}
        {onChange !== undefined && hasTypeConfig ? (
          <PropertyConfiguration
            mode="type"
            placement="right-start"
            property={property}
            properties={properties}
            anchor={configAnchor}
            open={configOpen}
            onClose={() => {
              configOpenRef.current = false;
              setConfigOpen(false);
            }}
            onChange={(edit) => onChange(property.id, edit)}
            onOptions={(options) => onChangeOptions?.(property.id, options)}
            onDuplicate={() => onDuplicate?.(property.id)}
            onRetire={() => onRetire?.(property.id)}
            previewRow={previewRow}
            previewRows={previewRows}
            rollupProperties={rollupProperties}
            rollupRelations={rollupRelations}
          />
        ) : null}
        {submenu === null
          ? null
          : createPortal(
              <div
                className="database-column-editor__flyout"
                data-property-submenu
                role="menu"
                aria-label={submenu.kind === "type" ? "Type de propriété" : "Trier"}
                ref={flyoutElement}
                onPointerEnter={cancelTimers}
                onPointerLeave={leaveSubmenu}
                onKeyDownCapture={(event) => {
                  const buttons = [
                    ...(flyoutElement.current?.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ) ?? []),
                  ];
                  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  if (event.key === "Escape" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.nativeEvent.stopImmediatePropagation();
                    setSubmenu(null);
                    submenuTrigger.current?.focus();
                  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                            buttons.length;
                    buttons[next]?.focus();
                  }
                }}
                style={propertyMenuPosition(
                  submenu.anchor,
                  submenu.menu,
                  { width: window.innerWidth, height: window.innerHeight },
                  {
                    width: submenu.kind === "sort" ? 200 : 224,
                    height:
                      submenu.kind === "sort"
                        ? 67
                        : Math.min(324, ENTRY_PROPERTY_TYPES.length * 29 + 8),
                  },
                )}
              >
                {submenu.kind === "type" ? (
                  ENTRY_PROPERTY_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="menuitemradio"
                      aria-checked={property.type === type}
                      onClick={() => {
                        setSubmenu(null);
                        if (type !== property.type) onChangeType?.(property.id, type);
                      }}
                    >
                      <DatabasePropertyIcon type={type} />
                      <span>
                        {DATABASE_COPY.property.typeLabels[type].replace(/^./, (first) =>
                          first.toUpperCase(),
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sort?.direction === "ascending"}
                      onClick={() => {
                        setSubmenu(null);
                        onSort?.(property.id, sort?.direction === "ascending" ? null : "ascending");
                      }}
                    >
                      Trier A → Z
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sort?.direction === "descending"}
                      onClick={() => {
                        setSubmenu(null);
                        onSort?.(
                          property.id,
                          sort?.direction === "descending" ? null : "descending",
                        );
                      }}
                    >
                      Trier Z → A
                    </button>
                  </>
                )}
              </div>,
              document.body,
            )}
      </PopoverContent>
    </PopoverRoot>
  );
}

function useDeepStableValue<T>(value: T): T {
  const signature = JSON.stringify(value);
  const stable = useRef({ signature, value });
  if (stable.current.signature !== signature) {
    stable.current = { signature, value };
  }
  return stable.current.value;
}

const NEW_COLUMN_TYPE_GROUPS: readonly {
  readonly types: readonly Exclude<DatabasePropertyType, "title">[];
}[] = [
  {
    types: [
      "text",
      "number",
      "select",
      "multi-select",
      "status",
      "date",
      "files",
      "place",
      "checkbox",
      "url",
      "phone",
      "email",
    ],
  },
  { types: ["relation", "rollup", "formula", "unique-id"] },
  { types: ["created-time", "last-edited-time"] },
];

/** A dragged header slides along its row only: no lift, no scale. */
const restrictColumnToHeaderRow: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

/**
 * A column header that can be grabbed and dropped on another one, like a view
 * tab. The cell keeps its `columnheader` semantics: the sortable's button role
 * and tab stop are not applied, so the property button inside stays the one
 * keyboard target (its menu already moves the column left or right).
 */
function SortableColumnHeader({
  children,
  columnId,
  disabled,
  style,
  ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, "id"> & {
  readonly columnId: string;
  readonly disabled: boolean;
  readonly headerId: string;
  readonly children: ReactNode;
}) {
  const { headerId, ...cellProps } = props;
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: columnId,
    disabled,
    // Columns are already in their new places when the pointer lifts.
    animateLayoutChanges: () => false,
  });
  const horizontal = transform === null ? null : { ...transform, y: 0, scaleX: 1, scaleY: 1 };
  const { onKeyDown: _sortableKeyDown, ...pointerListeners } = listeners ?? {};
  const dragStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(horizontal),
    ...(transition === undefined ? {} : { transition }),
  };
  return (
    <th
      {...cellProps}
      ref={setNodeRef}
      id={headerId}
      data-dragging={isDragging || undefined}
      data-column-draggable={disabled ? undefined : ""}
      style={dragStyle}
      {...pointerListeners}
    >
      {children}
    </th>
  );
}

export function TableView({
  properties,
  view,
  page,
  totalKnown = true,
  onOpenEntry,
  onResize,
  onMoveColumn,
  onAddProperty,
  onCreateProperty,
  onOpenViewSettings,
  onCreateEntry,
  onCreateFolder,
  onRenameProperty,
  onRetireProperty,
  onChangePropertyType,
  onChangePropertyIcon,
  onChangePropertyOptions,
  onChangeProperty,
  onToggleColumn,
  onSortProperty,
  onFilterProperty,
  onInsertProperty,
  onDuplicateProperty,
  onUpdateEntry,
  relationOptions = [],
  scrollTop = 0,
  onScroll,
  returnFocusEntryId,
  renameEntryId = null,
  onRenameStarted,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly page: DatabaseViewPage;
  readonly totalKnown?: boolean;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onResize: (propertyId: Uuid, width: number) => void;
  /** Persists this view's column order after a header was dropped on another. */
  readonly onMoveColumn?: (properties: DatabaseView["properties"]) => void | Promise<void>;
  readonly onAddProperty?: (anchor: HTMLElement) => void;
  readonly onCreateProperty?: (input: {
    readonly name: string;
    readonly type: Exclude<DatabasePropertyType, "title">;
    readonly icon: string | null;
  }) => void;
  readonly onOpenViewSettings?: () => void;
  readonly onCreateEntry?: () => void;
  readonly onCreateFolder?: () => void;
  readonly onRenameProperty?: (propertyId: Uuid, name: string) => void;
  readonly onRetireProperty?: (propertyId: Uuid) => void;
  readonly onChangePropertyType?: (
    propertyId: Uuid,
    type: (typeof ENTRY_PROPERTY_TYPES)[number],
  ) => void;
  readonly onChangePropertyIcon?: (propertyId: Uuid, icon: string | null) => void;
  readonly onChangePropertyOptions?: (propertyId: Uuid, options: readonly PropertyOption[]) => void;
  readonly onChangeProperty?: (
    propertyId: Uuid,
    edit: (property: DatabaseProperty) => DatabaseProperty,
  ) => void;
  readonly onToggleColumn?: (propertyId: Uuid, visible: boolean) => void;
  readonly onSortProperty?: (
    propertyId: Uuid,
    direction: "ascending" | "descending" | null,
  ) => void;
  readonly onFilterProperty?: (propertyId: Uuid) => void;
  readonly onInsertProperty?: (propertyId: Uuid, side: "before" | "after") => void;
  readonly onDuplicateProperty?: (propertyId: Uuid) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly relationOptions?: readonly RelationOption[];
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
  readonly returnFocusEntryId?: Uuid | null;
  /** Opens the title of this row so the owner can name a line that was just created. */
  readonly renameEntryId?: Uuid | null;
  readonly onRenameStarted?: () => void;
}) {
  const stableProperties = useDeepStableValue(properties);
  const savedPresentations = useDeepStableValue(view.properties);
  // The dropped order shows at once; the saved view replaces it when it lands.
  const [pendingPresentations, setPendingPresentations] = useState<
    DatabaseView["properties"] | null
  >(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a newly saved order supersedes the optimistic one
  useEffect(() => setPendingPresentations(null), [savedPresentations]);
  const stablePresentations = pendingPresentations ?? savedPresentations;
  const columnSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  // The pointer lifting after a drag also clicks the header: that click must
  // not open the property menu.
  const skipHeaderClick = useRef(false);
  const onColumnDragEnd = (event: DragEndEvent): void => {
    window.setTimeout(() => {
      skipHeaderClick.current = false;
    }, 0);
    const over = event.over;
    if (over === null || over.id === event.active.id || onMoveColumn === undefined) return;
    const next = reorderViewColumn(
      stableProperties,
      stablePresentations,
      String(event.active.id),
      String(over.id),
    );
    if (next === null) return;
    setPendingPresentations(next);
    void Promise.resolve(onMoveColumn(next))
      .catch(() => undefined)
      .finally(() => setPendingPresentations((current) => (current === next ? null : current)));
  };
  const withColumnDrag = (table: ReactNode): ReactNode =>
    onMoveColumn === undefined ? (
      table
    ) : (
      <DndContext
        sensors={columnSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictColumnToHeaderRow]}
        measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
        onDragStart={() => {
          skipHeaderClick.current = true;
        }}
        onDragCancel={() => {
          skipHeaderClick.current = false;
        }}
        onDragEnd={onColumnDragEnd}
      >
        {table}
      </DndContext>
    );
  const visible = useMemo(
    () => visibleProperties(stableProperties, stablePresentations),
    [stablePresentations, stableProperties],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: stableProperties already memoizes the properties input
  const columns = useMemo(
    () =>
      columnHelper.columns(
        visible.map((property) => {
          const presentation = stablePresentations.find(
            ({ propertyId }) => propertyId === property.id,
          );
          return columnHelper.accessor((row) => displayDatabaseValue(row, property, properties), {
            id: property.id,
            header: property.name,
            size: presentation?.width ?? (property.type === "title" ? 260 : 180),
          });
        }),
      ),
    [stablePresentations, visible],
  );
  const data = useMemo(() => [...page.rows], [page.rows]);
  const [addingProperty, setAddingProperty] = useState(false);
  const hasRelationProperty = properties.some(
    (property) => property.type === "relation" && property.state === "active",
  );
  const singleAddColumn = properties.length <= 1;
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnIcon, setNewColumnIcon] = useState<string | null>(null);
  const addPropertyRef = useRef<HTMLTableCellElement>(null);
  const [newColumnMenuPos, setNewColumnMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [placeEditor, setPlaceEditor] = useState<{
    readonly entryId: Uuid;
    readonly property: DatabaseProperty;
    readonly value: PlacePropertyValue | null;
    readonly rect: DOMRect;
  } | null>(null);
  useEffect(() => {
    if (!addingProperty) {
      setNewColumnMenuPos(null);
      return;
    }
    const update = () => {
      const rect = addPropertyRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const width = 288;
      setNewColumnMenuPos({
        top: rect.bottom + 6,
        left: Math.max(
          8,
          Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2),
        ),
      });
    };
    update();
    const reveal = () => {
      const root =
        addPropertyRef.current?.closest(".database-container-page, .editor-database-view-block") ??
        null;
      const bodyRail = root?.querySelector<HTMLElement>(".database-table-body-scroll") ?? null;
      const pageFlowRail =
        bodyRail !== null &&
        bodyRail.scrollWidth > bodyRail.clientWidth &&
        getComputedStyle(bodyRail).overflowX === "auto"
          ? bodyRail
          : null;
      let node: HTMLElement | null = addPropertyRef.current?.parentElement ?? null;
      while (node !== null) {
        const overflow = getComputedStyle(node).overflowX;
        if (node.scrollWidth > node.clientWidth && (overflow === "auto" || overflow === "scroll")) {
          break;
        }
        node = node.parentElement;
      }
      const scroller = pageFlowRail ?? node;
      if (scroller !== null) {
        scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
        // In page flow the header is moved by the body rail: scroll the owner
        // and paint the header track in the same frame, never one rail alone.
        if (scroller === pageFlowRail) {
          const track = root?.querySelector<HTMLElement>(
            ".database-page-header-scroll",
          )?.firstElementChild;
          if (track instanceof HTMLElement) {
            track.style.transform = `translateX(${-scroller.scrollLeft}px)`;
          }
        }
      }
      update();
    };
    const timer = window.setTimeout(reveal, 50);
    requestAnimationFrame(reveal);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [addingProperty]);
  useEffect(() => {
    if (!addingProperty) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && addPropertyRef.current?.contains(target) === true) return;
      if (target instanceof Element && target.closest(".database-new-column__types") !== null)
        return;
      setAddingProperty(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [addingProperty]);
  // The view settings panel is fixed and, on a narrow viewport, can cover the
  // labelled add-property button. Clamp the pill just before the panel and let
  // the label ellipsize instead of disappearing under the sheet.
  useLayoutEffect(() => {
    if (!singleAddColumn) return;
    const container =
      addPropertyRef.current?.closest<HTMLElement>(".database-container-page") ?? null;
    if (container === null) return;
    let frame = 0;
    let clamped: HTMLTableCellElement | null = null;
    const timers = new Set<number>();
    const clamp = () => {
      const host = addPropertyRef.current;
      if (host === null) return;
      if (clamped !== null && clamped !== host) {
        clamped.style.removeProperty("--database-add-property-max");
      }
      clamped = host;
      const button = host.querySelector<HTMLElement>(".database-table-add-property__button");
      const panel = container.hasAttribute("data-settings-open")
        ? container.querySelector<HTMLElement>("aside.database-view-settings")
        : null;
      if (button === null || panel === null) {
        host.style.removeProperty("--database-add-property-max");
        return;
      }
      const available = Math.floor(
        panel.getBoundingClientRect().left - button.getBoundingClientRect().left - 8,
      );
      host.style.setProperty("--database-add-property-max", `${Math.max(64, available)}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(clamp);
    };
    // The sheet slides in and the stage shifts: re-clamp while it settles.
    const settle = () => {
      schedule();
      for (const delay of [60, 160, 320, 520]) {
        const id = window.setTimeout(() => {
          timers.delete(id);
          schedule();
        }, delay);
        timers.add(id);
      }
    };
    if (container.hasAttribute("data-settings-open")) settle();
    else schedule();
    window.addEventListener("resize", schedule);
    container.addEventListener("scroll", schedule, true);
    const mutations = new MutationObserver(() => {
      if (container.hasAttribute("data-settings-open")) settle();
      else schedule();
    });
    mutations.observe(container, { attributes: true, attributeFilter: ["data-settings-open"] });
    // jsdom does not implement ResizeObserver; the browser path needs it.
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    sizes?.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      for (const id of timers) window.clearTimeout(id);
      window.removeEventListener("resize", schedule);
      container.removeEventListener("scroll", schedule, true);
      mutations.disconnect();
      sizes?.disconnect();
      clamped?.style.removeProperty("--database-add-property-max");
    };
  }, [singleAddColumn]);
  const [columnResize, setColumnResize] = useState<{
    propertyId: Uuid;
    width: number;
    dragging: boolean;
  } | null>(null);
  useEffect(() => {
    if (columnResize === null || columnResize.dragging) return;
    const stored = view.properties.find(
      (presentation) => presentation.propertyId === columnResize.propertyId,
    )?.width;
    if (stored === columnResize.width) setColumnResize(null);
  }, [columnResize, view.properties]);
  const table = useTable({
    features: FEATURES,
    data,
    columns,
    getRowId: (row) => row.entryId,
    manualFiltering: true,
    manualSorting: true,
    manualGrouping: true,
    manualPagination: true,
    rowCount: page.coverage === "complete" ? page.expectedCount : page.availableCount,
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useTableViewport(scrollRef);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  usePageHeaders(scrollRef, viewport, headerRef, bodyRef);
  const previousViewId = useRef(view.id);
  const [activeCell, setActiveCell] = useState<GridCellPosition>({ row: 0, column: 0 });
  const [rowMenu, setRowMenu] = useState<{
    readonly entryId: Uuid;
    readonly title: string;
    readonly rowIndex: number;
    readonly titleColumn: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [cellMenu, setCellMenu] = useState<{
    readonly rowIndex: number;
    readonly column: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refs = useRef(new Map<string, HTMLTableCellElement>());
  const ignoreEditBlur = useRef(false);
  const renameStarted = useRef<string | null>(null);
  const namingClosed = useRef<string | null>(null);
  const [namingEntryId, setNamingEntryId] = useState<string | null>(null);
  const [titleEdit, setTitleEdit] = useState<{ id: string; seed: string | null } | null>(null);
  const titleEditClosed = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = viewport.element;
    const changedView = previousViewId.current !== view.id;
    if (element === null) return;
    previousViewId.current = view.id;
    // The page owns its initial anchor. Mounting an inline table must not reset it.
    if ((!viewport.pageFlow || changedView) && Math.abs(element.scrollTop - scrollTop) >= 1) {
      element.scrollTop = scrollTop;
    }
  }, [scrollTop, view.id, viewport.element, viewport.pageFlow]);
  useEffect(() => {
    const element = viewport.element;
    if (element === null || onScroll === undefined) return;
    const remember = () => onScroll(element.scrollTop);
    element.addEventListener("scroll", remember, { passive: true });
    return () => element.removeEventListener("scroll", remember);
  }, [onScroll, viewport.element]);
  const returnIndex = rows.findIndex((row) => row.original.entryId === returnFocusEntryId);
  const renameIndex = rows.findIndex((row) => row.original.entryId === renameEntryId);
  const virtualizer = useVirtualizer({
    enabled: viewport.element !== null,
    count: rows.length,
    getScrollElement: () => viewport.element,
    observeElementOffset: observeTableScrollOffset,
    initialOffset: () => viewport.element?.scrollTop ?? scrollTop,
    scrollMargin: viewport.scrollMargin,
    estimateSize: () => 44,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 8,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (!indexes.includes(activeCell.row)) indexes.push(activeCell.row);
      if (returnIndex >= 0 && !indexes.includes(returnIndex)) indexes.push(returnIndex);
      if (renameIndex >= 0 && !indexes.includes(renameIndex)) indexes.push(renameIndex);
      return indexes.sort((left, right) => left - right);
    },
  });
  const virtualRows = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (viewport.element !== null && viewport.scrollMargin >= 0 && returnIndex >= 0) {
      virtualizer.scrollToIndex(returnIndex, { align: "auto" });
    }
  }, [returnIndex, virtualizer, viewport.element, viewport.scrollMargin]);
  useLayoutEffect(() => {
    if (renameEntryId == null || renameStarted.current === renameEntryId || renameIndex < 0) return;
    const column = visible.findIndex((property) => property.type === "title");
    if (visible[column] === undefined) return;
    renameStarted.current = renameEntryId;
    namingClosed.current = null;
    setActiveCell({ row: renameIndex, column: Math.max(0, column) });
    setNamingEntryId(renameEntryId);
    virtualizer.scrollToIndex(renameIndex, { align: "auto" });
    onRenameStarted?.();
  }, [onRenameStarted, renameEntryId, renameIndex, virtualizer, visible]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New rows mount the rename input; refocus after their projection arrives.
  useLayoutEffect(() => {
    if (namingEntryId == null) return;
    const input = scrollRef.current?.querySelector<HTMLInputElement>(
      `[data-naming-entry="${namingEntryId}"]`,
    );
    if (input == null || document.activeElement === input) return;
    input.focus();
    input.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [namingEntryId, rows]);
  useLayoutEffect(() => {
    if (titleEdit === null) return;
    const input = scrollRef.current?.querySelector<HTMLInputElement>(
      `[data-title-edit="${titleEdit.id}"]`,
    );
    if (input == null) return;
    const end = input.value.length;
    const caretReady =
      document.activeElement === input &&
      input.selectionStart === end &&
      input.selectionEnd === end;
    if (caretReady) return;
    // Initial focus belongs to this mount. Do not repeat it after the owner
    // has selected text or moved to another control in the next frame.
    input.focus();
    input.setSelectionRange(end, end);
    if (typeof input.scrollIntoView === "function") {
      input.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [titleEdit]);
  const startTitleEdit = (entryId: string, seed: string | null): void => {
    titleEditClosed.current = null;
    setTitleEdit({ id: entryId, seed });
  };
  const finishNaming = (entryId: Uuid, input: HTMLInputElement, keepCurrent: boolean): void => {
    if (namingClosed.current === entryId) return;
    namingClosed.current = entryId;
    setNamingEntryId((current) => (current === entryId ? null : current));
    const title = input.value.trim();
    if (keepCurrent || title.length === 0 || onUpdateEntry === undefined) return;
    void onUpdateEntry(entryId, { kind: "title", title });
  };
  const finishTitleEdit = (
    entryId: Uuid,
    currentTitle: string,
    input: HTMLInputElement,
    cancel: boolean,
  ): void => {
    if (titleEditClosed.current === entryId) return;
    titleEditClosed.current = entryId;
    setTitleEdit((current) => (current?.id === entryId ? null : current));
    const title = input.value.trim();
    if (cancel || title.length === 0 || title === currentTitle || onUpdateEntry === undefined) {
      return;
    }
    void onUpdateEntry(entryId, { kind: "title", title });
  };

  const cancelEdit = (position: GridCellPosition): void => {
    if (refs.current.get(refKey(position))?.querySelector(".database-cell-inline-field") != null) {
      ignoreEditBlur.current = true;
    }
    setEditingCell(null);
    setAnnouncement(DATABASE_COPY.table.editCancelled);
    focusCell(refs, position);
  };

  const commitProperty = async (
    position: GridCellPosition,
    property: DatabaseProperty,
    row: DatabaseViewRow,
    draft: ValueDraft,
  ): Promise<void> => {
    const result = validateValueDraft(property, draft);
    if (!result.ok) {
      setAnnouncement(result.error);
      setEditingCell((current) =>
        current?.key === refKey(position)
          ? { ...current, error: result.error, saving: false }
          : current,
      );
      return;
    }
    if (onUpdateEntry === undefined) {
      onOpenEntry(row.entryId as Uuid, refs.current.get(refKey(position)) ?? null);
      return;
    }
    try {
      await onUpdateEntry(row.entryId as Uuid, {
        kind: "property",
        propertyId: property.id,
        ...(result.value === undefined ? {} : { value: result.value }),
        ...(result.relationTargets === undefined
          ? {}
          : { relationTargets: result.relationTargets }),
      });
      setEditingCell((current) => {
        if (current?.key !== refKey(position)) return current;
        ignoreEditBlur.current = true;
        return null;
      });
      setAnnouncement(DATABASE_COPY.table.saved(property.name, row.title));
    } catch {
      setAnnouncement(DATABASE_COPY.table.saveFailed);
      setEditingCell((current) =>
        current?.key === refKey(position)
          ? { ...current, saving: false, error: DATABASE_COPY.table.saveFailed }
          : current,
      );
    }
  };

  const beginEdit = (
    position: GridCellPosition,
    property: DatabaseProperty,
    row: DatabaseViewRow,
    typedCharacter?: string,
  ): void => {
    if (
      property.type === "created-time" ||
      property.type === "last-edited-time" ||
      property.type === "formula" ||
      property.type === "files" ||
      property.type === "rollup" ||
      property.type === "unique-id"
    )
      return;
    const initial = draftForCell(property, row);
    const draft =
      typedCharacter !== undefined &&
      (property.type === "title" ||
        property.type === "text" ||
        property.type === "number" ||
        property.type === "url" ||
        property.type === "email" ||
        property.type === "phone")
        ? typedCharacter
        : initial;
    setEditingCell({ key: refKey(position), draft, error: null, saving: false });
    setAnnouncement(DATABASE_COPY.table.editing(property.name, row.title));
    queueMicrotask(() => {
      const field = refs.current.get(refKey(position))?.querySelector<HTMLElement>("input, select");
      // ValueEditor owns initial input focus and the caret in its layout
      // effect. Repeating it here can undo a replacement selection.
      if (field instanceof HTMLInputElement) return;
      field?.focus();
    });
  };

  const saveEdit = async (
    position: GridCellPosition,
    property: DatabaseProperty,
    row: DatabaseViewRow,
  ): Promise<void> => {
    const editing = editingCell;
    if (editing === null || editing.key !== refKey(position) || editing.saving) return;
    let update: DatabaseCellUpdate;
    if (property.type === "title") {
      const title = typeof editing.draft === "string" ? editing.draft.trim() : "";
      if (title === "") {
        setEditingCell((current) =>
          current?.key === editing.key
            ? { ...current, error: DATABASE_COPY.table.titleRequired }
            : current,
        );
        return;
      }
      update = { kind: "title", title };
    } else {
      const result = validateValueDraft(property, editing.draft);
      if (!result.ok) {
        setEditingCell((current) =>
          current?.key === editing.key ? { ...current, error: result.error } : current,
        );
        return;
      }
      update = {
        kind: "property",
        propertyId: property.id,
        ...(result.value === undefined ? {} : { value: result.value }),
        ...(result.relationTargets === undefined
          ? {}
          : { relationTargets: result.relationTargets }),
      };
    }
    if (onUpdateEntry === undefined) {
      onOpenEntry(row.entryId as Uuid, refs.current.get(refKey(position)) ?? null);
      return;
    }
    const cell = refs.current.get(refKey(position));
    const restoreFocus = cell?.contains(document.activeElement) ?? false;
    setEditingCell((current) =>
      current?.key === editing.key ? { ...current, saving: true, error: null } : current,
    );
    try {
      await onUpdateEntry(row.entryId as Uuid, update);
      setEditingCell((current) => {
        if (current?.key !== editing.key) return current;
        if (property.type !== "title") ignoreEditBlur.current = true;
        return null;
      });
      setAnnouncement(DATABASE_COPY.table.saved(property.name, row.title));
      if (restoreFocus) focusCell(refs, position);
    } catch {
      setEditingCell((current) =>
        current?.key === editing.key
          ? { ...current, saving: false, error: DATABASE_COPY.table.saveFailed }
          : current,
      );
    }
  };

  const onCellKeyDown = (
    event: KeyboardEvent<HTMLTableCellElement>,
    position: GridCellPosition,
    property: DatabaseProperty,
    row: DatabaseViewRow,
  ): void => {
    const key = refKey(position);
    if (editingCell?.key === key) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit(position);
      } else if (
        event.key === "Enter" &&
        !(event.target instanceof HTMLButtonElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        void saveEdit(position, property, row);
      }
      return;
    }
    // Nested buttons own their native keyboard activation. Grid shortcuts
    // apply to the cell itself, after the editor-specific handling above.
    if (event.target !== event.currentTarget) {
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = nextGridCell(position, event.key, rows.length, visible.length, event.ctrlKey);
      setActiveCell(next);
      virtualizer.scrollToIndex(next.row, { align: "auto" });
      focusCell(refs, next);
      return;
    }
    if (property.type === "place") {
      if (event.key === "Enter") {
        event.preventDefault();
        const value = row.values[property.id];
        setPlaceEditor({
          entryId: row.entryId as Uuid,
          property,
          value: value?.kind === "place" ? value : null,
          rect: event.currentTarget.getBoundingClientRect(),
        });
      }
      return;
    }
    if (
      event.key === "Enter" ||
      event.key === "F2" ||
      (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
    ) {
      event.preventDefault();
      if (property.type === "title") {
        startTitleEdit(row.entryId, event.key.length === 1 ? event.key : null);
        return;
      }
      if (isImmediateProperty(property)) {
        openImmediateControl(refs.current.get(key), event.key);
        return;
      }
      beginEdit(position, property, row, event.key.length === 1 ? event.key : undefined);
    }
  };

  const virtualized = rows.length > 60 && virtualRows.length > 0;
  const renderedRows = virtualized
    ? virtualRows.map((item, offset) => ({
        row: rows[item.index],
        index: item.index,
        item,
        gap: Math.max(0, item.start - (virtualRows[offset - 1]?.end ?? viewport.scrollMargin)),
      }))
    : rows.map((row, index) => ({ row, index, item: null, gap: 0 }));
  const trailingGap = virtualized
    ? Math.max(
        0,
        virtualizer.getTotalSize() - ((virtualRows.at(-1)?.end ?? 0) - viewport.scrollMargin),
      )
    : 0;
  const spacer = (height: number) =>
    height <= 0 ? null : (
      // biome-ignore lint/a11y/noAriaHiddenOnFocusable: this empty spacer has no controls, tabindex or handlers and must not count as a data row.
      <tr aria-hidden="true">
        <td
          colSpan={Math.max(1, visible.length + (onAddProperty ? 1 : 0) + 1)}
          style={{ height, padding: 0, border: 0 }}
        />
      </tr>
    );

  const widths = (table.getHeaderGroups()[0]?.headers ?? []).map((header) => ({
    id: header.column.id,
    width:
      columnResize?.propertyId === header.column.id ? columnResize.width : header.column.getSize(),
  }));
  // A lone column labels the add action inside its button; a table with several
  // columns only shows the + and … icons at the end.
  const addColumnWidth = addingProperty ? 288 : singleAddColumn ? 180 : 68;
  const tableWidth =
    widths.reduce((sum, column) => sum + column.width, 0) +
    (onAddProperty === undefined ? 0 : addColumnWidth);
  const columnWidths = (
    <colgroup>
      {widths.map((column) => (
        <col key={column.id} style={{ width: column.width }} />
      ))}
      {onAddProperty === undefined ? null : <col style={{ width: addColumnWidth }} />}
      <col />
    </colgroup>
  );
  const tableHeader = (
    <thead>
      {table.getHeaderGroups().map((group) => (
        <tr key={group.id}>
          <SortableContext
            items={group.headers.map((header) => header.column.id)}
            strategy={horizontalListSortingStrategy}
          >
            {group.headers.map((header) => {
              const property = properties.find(({ id }) => id === header.column.id);
              const sort = view.sorts.find(({ propertyId }) => propertyId === header.column.id);
              const width =
                property !== undefined && columnResize?.propertyId === property.id
                  ? columnResize.width
                  : header.column.getSize();
              return (
                <SortableColumnHeader
                  key={header.id}
                  columnId={header.column.id}
                  disabled={onMoveColumn === undefined || columnResize?.dragging === true}
                  scope="col"
                  headerId={`database-column-${view.id}-${header.column.id}`}
                  onClickCapture={(event) => {
                    if (!skipHeaderClick.current) return;
                    skipHeaderClick.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  aria-sort={
                    sort === undefined
                      ? "none"
                      : sort.direction === "ascending"
                        ? "ascending"
                        : "descending"
                  }
                  style={{ width }}
                >
                  {header.isPlaceholder || property === undefined ? null : (
                    <ColumnPropertyButton
                      key={`${property.id}:${property.name}`}
                      property={property}
                      view={view}
                      {...(onRenameProperty === undefined ? {} : { onRename: onRenameProperty })}
                      {...(onRetireProperty === undefined ? {} : { onRetire: onRetireProperty })}
                      {...(onChangePropertyType === undefined
                        ? {}
                        : { onChangeType: onChangePropertyType })}
                      {...(onChangePropertyIcon === undefined
                        ? {}
                        : { onChangeIcon: onChangePropertyIcon })}
                      {...(onChangePropertyOptions === undefined
                        ? {}
                        : { onChangeOptions: onChangePropertyOptions })}
                      {...(onChangeProperty === undefined ? {} : { onChange: onChangeProperty })}
                      properties={properties}
                      previewRow={page.rows[0]}
                      previewRows={page.rows}
                      rollupProperties={page.rollupProperties}
                      rollupRelations={page.rollupRelations}
                      {...(onToggleColumn === undefined ? {} : { onToggleColumn })}
                      {...(onSortProperty === undefined ? {} : { onSort: onSortProperty })}
                      {...(onFilterProperty === undefined ? {} : { onFilter: onFilterProperty })}
                      {...(onInsertProperty === undefined ? {} : { onInsert: onInsertProperty })}
                      {...(onDuplicateProperty === undefined
                        ? {}
                        : { onDuplicate: onDuplicateProperty })}
                    />
                  )}
                  {property === undefined ? null : (
                    <DatabaseColumnResize
                      name={property.name}
                      width={width}
                      onPreview={(next) =>
                        setColumnResize({
                          propertyId: property.id,
                          width: next,
                          dragging: true,
                        })
                      }
                      onCommit={(next) => {
                        setColumnResize({
                          propertyId: property.id,
                          width: next,
                          dragging: false,
                        });
                        onResize(property.id, next);
                      }}
                      onDragging={(dragging) =>
                        setColumnResize((current) =>
                          dragging
                            ? {
                                propertyId: property.id,
                                width: current?.propertyId === property.id ? current.width : width,
                                dragging: true,
                              }
                            : current === null
                              ? null
                              : { ...current, dragging: false },
                        )
                      }
                    />
                  )}
                </SortableColumnHeader>
              );
            })}
          </SortableContext>
          {onAddProperty === undefined ? null : (
            <th
              ref={addPropertyRef}
              className={`database-table-add-property${
                properties.length <= 1 ? " database-table-add-property--single" : ""
              }${addingProperty ? " database-table-add-property--adding" : ""}`}
              scope="col"
            >
              {addingProperty && onCreateProperty !== undefined ? (
                <div className="database-new-column">
                  <PropertyIconPicker
                    property={{ type: "text", name: "Nouvelle propriété", icon: newColumnIcon }}
                    onChange={setNewColumnIcon}
                    placeholderIcon="neutralFace"
                  />
                  <input
                    className="database-new-column__name"
                    aria-label="Nom de la nouvelle propriété"
                    placeholder="Saisir le nom de la propriété…"
                    value={newColumnName}
                    onChange={(event) => setNewColumnName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setAddingProperty(false);
                    }}
                  />

                  {newColumnMenuPos === null
                    ? null
                    : createPortal(
                        <div
                          className="database-new-column__types"
                          style={{ top: newColumnMenuPos.top, left: newColumnMenuPos.left }}
                        >
                          <p className="database-new-column__types-title">Sélectionner le type</p>
                          {NEW_COLUMN_TYPE_GROUPS.map((group) => (
                            <div className="database-new-column__type-group" key={group.types[0]}>
                              {group.types.map((type) => (
                                <button
                                  key={type}
                                  type="button"
                                  className="database-new-column__type"
                                  disabled={type === "rollup" && !hasRelationProperty}
                                  title={
                                    type === "rollup" && !hasRelationProperty
                                      ? "Ajoutez d’abord une relation"
                                      : undefined
                                  }
                                  onClick={() => {
                                    onCreateProperty({
                                      name: newColumnName.trim(),
                                      type,
                                      icon: newColumnIcon,
                                    });
                                    setAddingProperty(false);
                                  }}
                                >
                                  <DatabasePropertyIcon type={type} />
                                  <span>
                                    {DATABASE_COPY.property.typeLabels[type].replace(
                                      /^./,
                                      (first) => first.toUpperCase(),
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>,
                        document.body,
                      )}
                </div>
              ) : (
                <div className="database-header-actions">
                  <Button
                    type="button"
                    size="square"
                    variant="ghost"
                    {...(singleAddColumn
                      ? { className: "database-table-add-property__button" }
                      : {})}
                    aria-label={DATABASE_COPY.page.addProperty}
                    title={DATABASE_COPY.page.addProperty}
                    onClick={(event) => {
                      if (onCreateProperty === undefined) {
                        onAddProperty(event.currentTarget);
                        return;
                      }
                      setNewColumnName("");
                      setNewColumnIcon(null);
                      setAddingProperty(true);
                    }}
                  >
                    <AppIcon name="add" size="small" />
                    {singleAddColumn ? (
                      <span className="database-table-add-property__label">
                        Ajouter une propriété
                      </span>
                    ) : null}
                  </Button>
                  {properties.length <= 1 ? null : onOpenViewSettings !== undefined ? (
                    <Button
                      type="button"
                      size="square"
                      variant="ghost"
                      className="database-header-more"
                      aria-label="Options de la vue"
                      title="Options de la vue"
                      onClick={onOpenViewSettings}
                    >
                      <AppIcon name="more" size="small" />
                    </Button>
                  ) : onToggleColumn === undefined ? null : (
                    <PopoverRoot>
                      <PopoverTrigger
                        className="database-header-more"
                        aria-label={DATABASE_COPY.page.showProperties}
                        title={DATABASE_COPY.page.showProperties}
                      >
                        <AppIcon name="more" size="small" />
                      </PopoverTrigger>
                      <PopoverContent>
                        <ul className="database-property-visibility">
                          {viewColumns(properties, view.properties).map((column) => (
                            <li key={column.property.id}>
                              <span className="database-column-label__name">
                                {column.property.name}
                              </span>
                              <PropertyVisibilitySwitch
                                property={column.property}
                                visible={column.visible}
                                onToggle={onToggleColumn}
                              />
                            </li>
                          ))}
                        </ul>
                      </PopoverContent>
                    </PopoverRoot>
                  )}
                </div>
              )}
            </th>
          )}
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: Empty filler cells are not focusable and carry no column semantics. */}
          <th className="database-table-filler" aria-hidden="true" />
        </tr>
      ))}
    </thead>
  );

  return (
    <section className="database-view" aria-label={DATABASE_COPY.table.viewLabel(view.name)}>
      <section
        ref={scrollRef}
        className="database-table-scroll"
        data-page-flow={viewport.pageFlow || undefined}
        // Keep the page extent while React replaces virtual rows/spacers.
        // WebKit otherwise clamps scrollTop during intermediate DOM removals.
        style={
          viewport.pageFlow && virtualized
            ? { minHeight: virtualizer.getTotalSize() + viewport.headerHeight }
            : undefined
        }
        aria-label={DATABASE_COPY.table.scrollLabel(view.name)}
      >
        {viewport.pageFlow ? (
          <div className="database-page-header">
            <div ref={headerRef} className="database-page-header-scroll">
              {withColumnDrag(
                <table
                  className="database-table database-grid"
                  style={{ minWidth: tableWidth }}
                  aria-label={`En-têtes de ${view.name}`}
                >
                  {columnWidths}
                  {tableHeader}
                </table>,
              )}
            </div>
          </div>
        ) : null}
        <div ref={bodyRef} className="database-table-body-scroll">
          {(viewport.pageFlow ? (node: ReactNode) => node : withColumnDrag)(
            <table
              className="database-table database-grid"
              data-resizing={columnResize?.dragging ? "" : undefined}
              role="grid"
              aria-rowcount={totalKnown ? page.expectedCount + 1 : -1}
              aria-colcount={visible.length + (onAddProperty ? 1 : 0)}
              style={{
                minWidth: tableWidth,
              }}
            >
              {columnWidths}
              {viewport.pageFlow ? null : tableHeader}
              <tbody>
                {renderedRows.length === 0 && page.coverage === "partial" ? (
                  <tr>
                    <td colSpan={Math.max(1, visible.length + (onAddProperty ? 1 : 0) + 1)}>
                      <AsyncState
                        compact
                        kind="offline"
                        description={DATABASE_COPY.common.noEntriesAvailable}
                      />
                    </td>
                  </tr>
                ) : (
                  renderedRows.map(({ row, index, item, gap }) =>
                    row === undefined ? null : (
                      <Fragment key={row.id}>
                        {spacer(gap)}
                        <tr
                          aria-rowindex={index + 2}
                          data-index={item?.index}
                          ref={item === null ? undefined : virtualizer.measureElement}
                          onContextMenu={(event) => {
                            if ((event.target as HTMLElement).closest("td") !== null) return;
                            event.preventDefault();
                            const titleColumn = visible.findIndex(
                              (property) => property.type === "title",
                            );
                            if (titleColumn < 0) return;
                            setRowMenu({
                              entryId: row.original.entryId as Uuid,
                              title: row.original.title,
                              rowIndex: index,
                              titleColumn,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          {row.getAllCells().map((cell, column) => {
                            const property = visible[column];
                            if (property === undefined) return null;
                            const position = { row: index, column };
                            const key = refKey(position);
                            const editing = editingCell?.key === key;
                            return (
                              <td
                                key={cell.id}
                                onContextMenu={(event) => {
                                  if (editing) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setRowMenu(null);
                                  setCellMenu({
                                    rowIndex: index,
                                    column,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                ref={(element) => {
                                  if (element === null) refs.current.delete(key);
                                  else refs.current.set(key, element);
                                }}
                                className={
                                  property.type === "title" ||
                                  property.type === "text" ||
                                  property.type === "number" ||
                                  property.type === "url" ||
                                  property.type === "email" ||
                                  property.type === "phone"
                                    ? "database-cell--text"
                                    : "database-cell--property"
                                }
                                role="gridcell"
                                headers={
                                  viewport.pageFlow
                                    ? undefined
                                    : `database-column-${view.id}-${property.id}`
                                }
                                aria-colindex={column + 1}
                                aria-label={`${property.name}, ${displayDatabaseValue(row.original, property, properties)}`}
                                tabIndex={
                                  activeCell.row === index && activeCell.column === column ? 0 : -1
                                }
                                data-grid-mode={
                                  editing ||
                                  (property.type === "title" &&
                                    (row.original.entryId === namingEntryId ||
                                      titleEdit?.id === row.original.entryId))
                                    ? "editing"
                                    : "navigation"
                                }
                                onFocus={() => {
                                  // Keep a focused entry button (or editor) in the
                                  // virtual range after its temporary return pin ends.
                                  setActiveCell((current) =>
                                    current.row === index && current.column === column
                                      ? current
                                      : position,
                                  );
                                }}
                                onKeyDown={(event) =>
                                  onCellKeyDown(event, position, property, row.original)
                                }
                                onClick={(event) => {
                                  if (property.type === "title") {
                                    const target = event.target;
                                    if (
                                      target instanceof Element &&
                                      target.closest(
                                        ".database-cell-title__open, input, textarea, select",
                                      )
                                    ) {
                                      return;
                                    }
                                    if (row.original.entryId === namingEntryId) return;
                                    startTitleEdit(row.original.entryId, null);
                                    return;
                                  }
                                  if (editing) return;
                                  if (property.type === "place") {
                                    const value = row.original.values[property.id];
                                    setPlaceEditor({
                                      entryId: row.original.entryId as Uuid,
                                      property,
                                      value: value?.kind === "place" ? value : null,
                                      rect: event.currentTarget.getBoundingClientRect(),
                                    });
                                    return;
                                  }
                                  const target = event.target;
                                  if (
                                    target instanceof Element &&
                                    target.closest("button, select, input, textarea, a")
                                  ) {
                                    return;
                                  }
                                  if (isImmediateProperty(property)) {
                                    openImmediateControl(event.currentTarget, "Enter");
                                    return;
                                  }
                                  beginEdit(position, property, row.original);
                                }}
                              >
                                {property.type === "title" &&
                                row.original.entryId === namingEntryId ? (
                                  <label className="database-cell-title database-cell-title--naming">
                                    <TitleItemIcon row={row.original} />
                                    <input
                                      className="database-cell-title-input"
                                      data-naming-entry={row.original.entryId}
                                      aria-label={`Nom de ${row.original.title}`}
                                      placeholder={row.original.title}
                                      defaultValue=""
                                      onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key !== "Enter" && event.key !== "Escape") return;
                                        event.preventDefault();
                                        finishNaming(
                                          row.original.entryId as Uuid,
                                          event.currentTarget,
                                          event.key === "Escape",
                                        );
                                      }}
                                      onBlur={(event) =>
                                        finishNaming(
                                          row.original.entryId as Uuid,
                                          event.currentTarget,
                                          false,
                                        )
                                      }
                                    />
                                  </label>
                                ) : editing && property.type !== "title" ? (
                                  <ValueEditor
                                    presentation="inline"
                                    property={property}
                                    input={editingCell.draft}
                                    error={editingCell.error}
                                    idSuffix={row.original.entryId}
                                    entryId={row.original.entryId as Uuid}
                                    relationOptions={relationOptions.filter(
                                      ({ id }) => id !== row.original.entryId,
                                    )}
                                    onBlur={() => {
                                      if (ignoreEditBlur.current) {
                                        ignoreEditBlur.current = false;
                                        return;
                                      }
                                      void saveEdit(position, property, row.original);
                                    }}
                                    onChange={(draft) => {
                                      setEditingCell((current) =>
                                        current?.key === key
                                          ? { ...current, draft, error: null }
                                          : current,
                                      );
                                      const commitsOnChange =
                                        property.type === "checkbox" ||
                                        property.type === "status" ||
                                        property.type === "select" ||
                                        (property.type === "relation" &&
                                          property.config.cardinality === "one");
                                      if (commitsOnChange) {
                                        void commitProperty(
                                          position,
                                          property,
                                          row.original,
                                          draft,
                                        );
                                      }
                                    }}
                                  />
                                ) : editing ? (
                                  <div className="database-cell-editor">
                                    <label>
                                      <span className="sr-only">
                                        {DATABASE_COPY.table.titleFor(row.original.title)}
                                      </span>
                                      <input
                                        value={
                                          typeof editingCell.draft === "string"
                                            ? editingCell.draft
                                            : ""
                                        }
                                        onChange={(event) =>
                                          setEditingCell((current) =>
                                            current?.key === key
                                              ? {
                                                  ...current,
                                                  draft: event.target.value,
                                                  error: null,
                                                }
                                              : current,
                                          )
                                        }
                                      />
                                    </label>
                                    {editingCell.error !== null ? (
                                      <span className="database-field__error" role="alert">
                                        {editingCell.error}
                                      </span>
                                    ) : null}
                                    <div className="database-cell-editor__actions">
                                      <Button
                                        type="button"
                                        size="compact"
                                        busy={editingCell.saving}
                                        disabled={editingCell.saving}
                                        onClick={() =>
                                          void saveEdit(position, property, row.original)
                                        }
                                      >
                                        {editingCell.saving
                                          ? DATABASE_COPY.table.saving(property.name)
                                          : DATABASE_COPY.table.saveFor(
                                              property.name,
                                              row.original.title,
                                            )}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="compact"
                                        variant="ghost"
                                        disabled={editingCell.saving}
                                        onClick={() => cancelEdit(position)}
                                      >
                                        {DATABASE_COPY.table.cancelEdit}
                                      </Button>
                                      <StableActionButton
                                        type="button"
                                        className="link"
                                        data-entry-trigger={row.original.entryId}
                                        onActivate={(trigger) =>
                                          onOpenEntry(row.original.entryId as Uuid, trigger)
                                        }
                                      >
                                        {DATABASE_COPY.table.openEntry}
                                      </StableActionButton>
                                    </div>
                                  </div>
                                ) : property.type === "title" ? (
                                  <div className="database-cell-title">
                                    <TitleItemIcon row={row.original} />
                                    {titleEdit?.id === row.original.entryId ? (
                                      <input
                                        className="database-cell-title-input"
                                        data-title-edit={row.original.entryId}
                                        aria-label={`Nom de ${row.original.title}`}
                                        placeholder={DATABASE_COPY.value.emptyPlaceholder}
                                        defaultValue={titleEdit.seed ?? row.original.title}
                                        onKeyDown={(event) => {
                                          event.stopPropagation();
                                          if (event.key !== "Enter" && event.key !== "Escape")
                                            return;
                                          event.preventDefault();
                                          finishTitleEdit(
                                            row.original.entryId as Uuid,
                                            row.original.title,
                                            event.currentTarget,
                                            event.key === "Escape",
                                          );
                                        }}
                                        onBlur={(event) =>
                                          finishTitleEdit(
                                            row.original.entryId as Uuid,
                                            row.original.title,
                                            event.currentTarget,
                                            false,
                                          )
                                        }
                                      />
                                    ) : (
                                      <span className="database-cell-text">
                                        {String(cell.getValue())}
                                      </span>
                                    )}
                                    {titleEdit?.id === row.original.entryId ? null : (
                                      <StableActionButton
                                        type="button"
                                        className="database-cell-title__open"
                                        pinDuringPointer
                                        size="square"
                                        variant="ghost"
                                        aria-label="Ouvrir en volet latéral"
                                        title="Ouvrir en volet latéral"
                                        data-entry-trigger={row.original.entryId}
                                        tabIndex={-1}
                                        onKeyDown={(event) => event.stopPropagation()}
                                        onActivate={(trigger) =>
                                          onOpenEntry(row.original.entryId as Uuid, trigger)
                                        }
                                      >
                                        <AppIcon name="sidePeek" size="small" />
                                      </StableActionButton>
                                    )}
                                  </div>
                                ) : isImmediateProperty(property) ? (
                                  <ImmediatePropertyControl
                                    property={property}
                                    row={row.original}
                                    onCommit={(draft) =>
                                      void commitProperty(position, property, row.original, draft)
                                    }
                                  />
                                ) : property.type === "number" &&
                                  numberConfigOf(property).display !== "number" ? (
                                  <NumberDisplayCell property={property} row={row.original} />
                                ) : (
                                  <span className="database-cell-value database-cell-text">
                                    {String(cell.getValue())}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          {onAddProperty === undefined ? null : (
                            <td className="database-table-add-property" aria-hidden="true" />
                          )}
                          <td className="database-table-filler" aria-hidden="true" />
                        </tr>
                      </Fragment>
                    ),
                  )
                )}
                {spacer(trailingGap)}
                {onCreateEntry === undefined ? null : (
                  <tr className="database-table-add-entry">
                    <td
                      colSpan={visible.length + 1 + (onAddProperty === undefined ? 0 : 1)}
                      className="database-table-add-entry__cell"
                    >
                      <div className="database-table-add-entry__actions">
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          onClick={onCreateEntry}
                        >
                          <AppIcon name="fileAdd" size="small" />
                          {DATABASE_COPY.page.newPage}
                        </Button>
                        {onCreateFolder === undefined ? null : (
                          <Button
                            type="button"
                            size="compact"
                            variant="ghost"
                            onClick={onCreateFolder}
                          >
                            <AppIcon name="folderAdd" size="small" />
                            {DATABASE_COPY.page.newFolder}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>,
          )}
          {viewport.pageFlow && page.rows.length === 0 && page.coverage === "complete" ? (
            <div
              aria-hidden="true"
              className="database-table-empty-extent"
              style={{ minWidth: tableWidth }}
            />
          ) : null}
        </div>
      </section>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <PopoverRoot
        open={rowMenu !== null}
        setOpen={(open) => {
          if (!open) setRowMenu(null);
        }}
        placement="bottom-start"
      >
        <PopoverContent
          className="database-row-menu"
          aria-label="Actions de la ligne"
          getAnchorRect={() =>
            rowMenu === null
              ? null
              : DOMRect.fromRect({ x: rowMenu.x, y: rowMenu.y, width: 0, height: 0 })
          }
        >
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = rowMenu;
              setRowMenu(null);
              if (menu !== null) onOpenEntry(menu.entryId, null);
            }}
          >
            <AppIcon name="fileText" size="small" />
            Ouvrir la page
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = rowMenu;
              setRowMenu(null);
              if (menu === null) return;
              const property = visible[menu.titleColumn];
              const row = page.rows[menu.rowIndex];
              if (property !== undefined && row !== undefined) {
                beginEdit({ row: menu.rowIndex, column: menu.titleColumn }, property, row);
              }
            }}
          >
            <AppIcon name="edit" size="small" />
            Renommer
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = rowMenu;
              setRowMenu(null);
              if (menu !== null) void navigator.clipboard.writeText(menu.title);
            }}
          >
            <AppIcon name="copy" size="small" />
            Copier le titre
          </Button>
        </PopoverContent>
      </PopoverRoot>
      <PopoverRoot
        open={cellMenu !== null}
        setOpen={(open) => {
          if (!open) setCellMenu(null);
        }}
        placement="bottom-start"
      >
        <PopoverContent
          className="database-row-menu"
          aria-label="Actions de la cellule"
          getAnchorRect={() =>
            cellMenu === null
              ? null
              : DOMRect.fromRect({ x: cellMenu.x, y: cellMenu.y, width: 0, height: 0 })
          }
        >
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = cellMenu;
              setCellMenu(null);
              if (menu === null) return;
              const property = visible[menu.column];
              const row = page.rows[menu.rowIndex];
              if (property !== undefined && row !== undefined) {
                beginEdit({ row: menu.rowIndex, column: menu.column }, property, row);
              }
            }}
          >
            <AppIcon name="edit" size="small" />
            Modifier
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = cellMenu;
              setCellMenu(null);
              const property = menu === null ? undefined : visible[menu.column];
              if (property !== undefined) onFilterProperty?.(property.id);
            }}
          >
            <AppIcon name="filter" size="small" />
            Filtrer sur cette propriété
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-row-menu__item"
            onClick={() => {
              const menu = cellMenu;
              setCellMenu(null);
              if (menu === null) return;
              const property = visible[menu.column];
              const row = page.rows[menu.rowIndex];
              if (property !== undefined && row !== undefined) {
                void navigator.clipboard.writeText(displayDatabaseValue(row, property));
              }
            }}
          >
            <AppIcon name="copy" size="small" />
            Copier la valeur
          </Button>
        </PopoverContent>
      </PopoverRoot>
      {placeEditor === null
        ? null
        : createPortal(
            <div
              className="database-place-popover__backdrop"
              onMouseDown={() => setPlaceEditor(null)}
            >
              <div
                className="database-place-popover"
                style={{
                  left: Math.min(placeEditor.rect.left, window.innerWidth - 360),
                  top: Math.min(placeEditor.rect.bottom + 4, window.innerHeight - 260),
                }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <PlacePropertyField
                  property={placeEditor.property}
                  value={placeEditor.value}
                  disabled={onUpdateEntry === undefined}
                  onChange={(value) => {
                    const editor = placeEditor;
                    setPlaceEditor(null);
                    if (editor === null) return;
                    if (onUpdateEntry === undefined) {
                      onOpenEntry(editor.entryId, null);
                      return;
                    }
                    void onUpdateEntry(editor.entryId, {
                      kind: "property",
                      propertyId: editor.property.id,
                      ...(value === null ? {} : { value }),
                    });
                  }}
                />
              </div>
            </div>,
            document.body,
          )}
    </section>
  );
}
