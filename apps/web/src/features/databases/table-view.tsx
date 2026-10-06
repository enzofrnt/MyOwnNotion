// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: this component intentionally implements the editable ARIA grid model required by the feature plan
import type {
  DatabaseProperty,
  DatabaseView,
  NonRelationPropertyValue,
  PropertyOption,
  Uuid,
} from "@myownnotion/domain";
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
  Fragment,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { isChoiceProperty, OptionValueMenu, PropertyOptionsEditor } from "./option-appearance.tsx";
import { DatabasePropertyIcon } from "./property-icon.tsx";
import { PropertyVisibilitySwitch } from "./property-visibility-switch.tsx";
import { observeTableScrollOffset } from "./table-scroll-observer.ts";
import { usePageHeaders } from "./use-page-headers.ts";
import { useTableViewport } from "./use-table-viewport.ts";
import {
  type RelationOption,
  type ValueDraft,
  ValueEditor,
  validateValueDraft,
} from "./value-editor.tsx";
import { viewColumns, visibleViewColumns } from "./view-columns.ts";

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
    return "";
  }
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "status":
    case "select":
      return value.optionId;
    case "multi-select":
      return value.optionIds;
    case "checkbox":
      return value.checked;
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
  onChangeOptions,
  onToggleColumn,
  onSort,
  onFilter,
  onInsert,
  onDuplicate,
}: {
  readonly property: DatabaseProperty;
  readonly view: DatabaseView;
  readonly onRename?: (propertyId: Uuid, name: string) => void;
  readonly onRetire?: (propertyId: Uuid) => void;
  readonly onChangeOptions?: (propertyId: Uuid, options: readonly PropertyOption[]) => void;
  readonly onToggleColumn?: (propertyId: Uuid, visible: boolean) => void;
  readonly onSort?: (propertyId: Uuid, direction: "ascending" | "descending" | null) => void;
  readonly onFilter?: (propertyId: Uuid) => void;
  readonly onInsert?: (propertyId: Uuid, side: "before" | "after") => void;
  readonly onDuplicate?: (propertyId: Uuid) => void;
}) {
  const [name, setName] = useState(property.name);
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
    <PopoverRoot>
      <PopoverTrigger
        className="database-column-header"
        aria-label={DATABASE_COPY.page.editProperty(property.name)}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="database-column-editor">
        <label>
          Nom
          <input
            value={name}
            aria-label={`Nom de ${property.name}`}
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
        </label>
        <p className="muted">{DATABASE_COPY.property.typeLabels[property.type]}</p>
        {isChoiceProperty(property) && onChangeOptions !== undefined ? (
          <PropertyOptionsEditor
            options={property.config.options}
            onChange={(options) => onChangeOptions(property.id, options)}
          />
        ) : null}
        <div className="database-column-menu__actions">
          {onSort === undefined ? null : (
            <>
              <Button
                type="button"
                size="compact"
                variant="ghost"
                aria-pressed={sort?.direction === "ascending"}
                onClick={() =>
                  onSort(property.id, sort?.direction === "ascending" ? null : "ascending")
                }
              >
                <AppIcon name="arrowUp" size="small" />
                {DATABASE_COPY.page.sortAscending}
              </Button>
              <Button
                type="button"
                size="compact"
                variant="ghost"
                aria-pressed={sort?.direction === "descending"}
                onClick={() =>
                  onSort(property.id, sort?.direction === "descending" ? null : "descending")
                }
              >
                <AppIcon name="arrowDown" size="small" />
                {DATABASE_COPY.page.sortDescending}
              </Button>
            </>
          )}
          {onFilter === undefined ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              aria-pressed={filtered}
              onClick={() => onFilter(property.id)}
            >
              <AppIcon name="filter" size="small" />
              {filtered ? DATABASE_COPY.page.clearFilter : DATABASE_COPY.page.filterFilled}
            </Button>
          )}
          {property.type === "title" || onToggleColumn === undefined ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => onToggleColumn(property.id, false)}
            >
              {DATABASE_COPY.page.hideProperty}
            </Button>
          )}
          {property.type === "title" || onInsert === undefined ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => onInsert(property.id, "before")}
            >
              <AppIcon name="arrowLeft" size="small" />
              {DATABASE_COPY.page.insertBefore}
            </Button>
          )}
          {onInsert === undefined ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => onInsert(property.id, "after")}
            >
              <AppIcon name="arrowRight" size="small" />
              {DATABASE_COPY.page.insertAfter}
            </Button>
          )}
          {property.type === "title" || onDuplicate === undefined ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => onDuplicate(property.id)}
            >
              <AppIcon name="copy" size="small" />
              {DATABASE_COPY.page.duplicateProperty}
            </Button>
          )}
          {property.type !== "title" && onRetire !== undefined ? (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => onRetire(property.id)}
            >
              <AppIcon name="delete" size="small" />
              {DATABASE_COPY.page.deleteProperty}
            </Button>
          ) : null}
        </div>
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

export function TableView({
  properties,
  view,
  page,
  onOpenEntry,
  onResize,
  onAddProperty,
  onRenameProperty,
  onRetireProperty,
  onChangePropertyOptions,
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
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onResize: (propertyId: Uuid, width: number) => void;
  readonly onAddProperty?: () => void;
  readonly onRenameProperty?: (propertyId: Uuid, name: string) => void;
  readonly onRetireProperty?: (propertyId: Uuid) => void;
  readonly onChangePropertyOptions?: (propertyId: Uuid, options: readonly PropertyOption[]) => void;
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
  const stablePresentations = useDeepStableValue(view.properties);
  const visible = useMemo(
    () => visibleProperties(stableProperties, stablePresentations),
    [stablePresentations, stableProperties],
  );
  const columns = useMemo(
    () =>
      columnHelper.columns(
        visible.map((property) => {
          const presentation = stablePresentations.find(
            ({ propertyId }) => propertyId === property.id,
          );
          return columnHelper.accessor((row) => displayDatabaseValue(row, property), {
            id: property.id,
            header: property.name,
            size: presentation?.width ?? (property.type === "title" ? 260 : 180),
          });
        }),
      ),
    [stablePresentations, visible],
  );
  const data = useMemo(() => [...page.rows], [page.rows]);
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
    const initial = draftForCell(property, row);
    const draft =
      typedCharacter !== undefined &&
      (property.type === "title" || property.type === "text" || property.type === "number")
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
  const tableWidth =
    widths.reduce((sum, column) => sum + column.width, 0) + (onAddProperty === undefined ? 0 : 68);
  const columnWidths = (
    <colgroup>
      {widths.map((column) => (
        <col key={column.id} style={{ width: column.width }} />
      ))}
      {onAddProperty === undefined ? null : <col style={{ width: 68 }} />}
      <col />
    </colgroup>
  );
  const tableHeader = (
    <thead>
      {table.getHeaderGroups().map((group) => (
        <tr key={group.id}>
          {group.headers.map((header) => {
            const property = properties.find(({ id }) => id === header.column.id);
            const sort = view.sorts.find(({ propertyId }) => propertyId === header.column.id);
            const width =
              property !== undefined && columnResize?.propertyId === property.id
                ? columnResize.width
                : header.column.getSize();
            return (
              <th
                key={header.id}
                scope="col"
                id={`database-column-${view.id}-${header.column.id}`}
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
                    {...(onChangePropertyOptions === undefined
                      ? {}
                      : { onChangeOptions: onChangePropertyOptions })}
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
              </th>
            );
          })}
          {onAddProperty === undefined ? null : (
            <th className="database-table-add-property" scope="col">
              <div className="database-header-actions">
                <Button
                  type="button"
                  size="square"
                  variant="ghost"
                  aria-label={DATABASE_COPY.page.addProperty}
                  title={DATABASE_COPY.page.addProperty}
                  onClick={onAddProperty}
                >
                  <AppIcon name="add" size="small" />
                </Button>
                {onToggleColumn === undefined ? null : (
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
              <table
                className="database-table database-grid"
                style={{ minWidth: tableWidth }}
                aria-label={`En-têtes de ${view.name}`}
              >
                {columnWidths}
                {tableHeader}
              </table>
            </div>
          </div>
        ) : null}
        <div ref={bodyRef} className="database-table-body-scroll">
          <table
            className="database-table database-grid"
            data-resizing={columnResize?.dragging ? "" : undefined}
            role="grid"
            aria-rowcount={page.expectedCount + 1}
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
                              ref={(element) => {
                                if (element === null) refs.current.delete(key);
                                else refs.current.set(key, element);
                              }}
                              className={
                                property.type === "title" ||
                                property.type === "text" ||
                                property.type === "number"
                                  ? "database-cell--text"
                                  : "database-cell--property"
                              }
                              role="gridcell"
                              headers={`database-column-${view.id}-${property.id}`}
                              aria-colindex={column + 1}
                              aria-label={`${property.name}, ${displayDatabaseValue(row.original, property)}`}
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
                                      void commitProperty(position, property, row.original, draft);
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
                                        if (event.key !== "Enter" && event.key !== "Escape") return;
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
                                      aria-label={DATABASE_COPY.table.openEntry}
                                      data-entry-trigger={row.original.entryId}
                                      tabIndex={-1}
                                      onKeyDown={(event) => event.stopPropagation()}
                                      onActivate={(trigger) =>
                                        onOpenEntry(row.original.entryId as Uuid, trigger)
                                      }
                                    >
                                      <AppIcon name="reference" size="small" />
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
            </tbody>
          </table>
        </div>
      </section>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
