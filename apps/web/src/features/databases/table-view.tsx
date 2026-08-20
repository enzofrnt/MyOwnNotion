// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: this component intentionally implements the editable ARIA grid model required by the feature plan
import type {
  DatabaseProperty,
  DatabaseView,
  NonRelationPropertyValue,
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
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MutableRefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { displayDatabaseValue } from "./database-value.ts";
import {
  type RelationOption,
  type ValueDraft,
  ValueEditor,
  validateValueDraft,
} from "./value-editor.tsx";

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

export type DatabaseCellUpdate =
  | { readonly kind: "title"; readonly title: string }
  | {
      readonly kind: "property";
      readonly propertyId: Uuid;
      readonly value?: NonRelationPropertyValue;
      readonly relationTargets?: readonly Uuid[];
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
  const byId = new Map(properties.map((property) => [property.id, property]));
  return presentations
    .filter(({ visible }) => visible)
    .sort(
      (left, right) =>
        left.positionKey.localeCompare(right.positionKey) ||
        left.propertyId.localeCompare(right.propertyId),
    )
    .flatMap((presentation) => {
      const property = byId.get(presentation.propertyId);
      return property === undefined || property.state !== "active" ? [] : [property];
    });
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
  onUpdateEntry,
  relationOptions = [],
  scrollTop = 0,
  onScroll,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onResize: (propertyId: Uuid, width: number) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly relationOptions?: readonly RelationOption[];
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const stableProperties = useDeepStableValue(properties);
  const stablePresentations = useDeepStableValue(view.properties);
  const openEntry = useRef(onOpenEntry);
  openEntry.current = onOpenEntry;
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
            cell: (info) =>
              property.type === "title" ? (
                <button
                  type="button"
                  className="link database-cell-title"
                  data-entry-trigger={info.row.original.entryId}
                  tabIndex={-1}
                  onClick={(event) =>
                    openEntry.current(info.row.original.entryId as Uuid, event.currentTarget)
                  }
                >
                  {String(info.getValue())}
                </button>
              ) : (
                <span>{String(info.getValue())}</span>
              ),
          });
        }),
      ),
    [stablePresentations, visible],
  );
  const data = useMemo(() => [...page.rows], [page.rows]);
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
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element !== null && Math.abs(element.scrollTop - scrollTop) >= 1) {
      element.scrollTop = scrollTop;
    }
  }, [scrollTop]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const [activeCell, setActiveCell] = useState<GridCellPosition>({ row: 0, column: 0 });
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refs = useRef(new Map<string, HTMLTableCellElement>());

  const cancelEdit = (position: GridCellPosition): void => {
    setEditingCell(null);
    setAnnouncement("Edit cancelled");
    focusCell(refs, position);
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
    setAnnouncement(`Editing ${property.name} for ${row.title}`);
    queueMicrotask(() => {
      refs.current.get(refKey(position))?.querySelector<HTMLElement>("input, select")?.focus();
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
        setEditingCell({ ...editing, error: "Give the page a title." });
        return;
      }
      update = { kind: "title", title };
    } else {
      const result = validateValueDraft(property, editing.draft);
      if (!result.ok) {
        setEditingCell({ ...editing, error: result.error });
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
    setEditingCell({ ...editing, saving: true, error: null });
    try {
      await onUpdateEntry(row.entryId as Uuid, update);
      setEditingCell(null);
      setAnnouncement(`${property.name} saved for ${row.title}`);
      focusCell(refs, position);
    } catch {
      setEditingCell({ ...editing, saving: false, error: "The value could not be saved." });
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
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = nextGridCell(position, event.key, rows.length, visible.length, event.ctrlKey);
      setActiveCell(next);
      focusCell(refs, next);
      return;
    }
    if (
      event.key === "Enter" ||
      event.key === "F2" ||
      (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
    ) {
      event.preventDefault();
      beginEdit(position, property, row, event.key.length === 1 ? event.key : undefined);
    }
  };

  const virtualized = rows.length > 60 && virtualRows.length > 0;
  const renderedRows = virtualized
    ? virtualRows.map((item) => ({ row: rows[item.index], index: item.index, item }))
    : rows.map((row, index) => ({ row, index, item: null }));

  return (
    <section className="database-view" aria-label={`${view.name} table view`}>
      <section
        ref={scrollRef}
        className="database-table-scroll"
        aria-label={`${view.name} scrollable table`}
        onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      >
        <table
          className="database-table database-grid"
          role="grid"
          aria-rowcount={page.expectedCount + 1}
          aria-colcount={visible.length}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const property = properties.find(({ id }) => id === header.column.id);
                  const sort = view.sorts.find(({ propertyId }) => propertyId === header.column.id);
                  const width = header.column.getSize();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sort === undefined
                          ? "none"
                          : sort.direction === "ascending"
                            ? "ascending"
                            : "descending"
                      }
                      style={{ width }}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      {property === undefined ? null : (
                        <fieldset className="database-column-size">
                          <legend className="sr-only">
                            {property.name} width {width} pixels
                          </legend>
                          <button
                            type="button"
                            aria-label={`Narrow ${property.name}`}
                            onClick={() => onResize(property.id, Math.max(80, width - 20))}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            aria-label={`Widen ${property.name}`}
                            onClick={() => onResize(property.id, Math.min(800, width + 20))}
                          >
                            +
                          </button>
                        </fieldset>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={
              virtualized ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined
            }
          >
            {renderedRows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, visible.length)}>
                  {page.coverage === "partial"
                    ? "No entries in the data available on this device."
                    : "No entries in this view."}
                </td>
              </tr>
            ) : (
              renderedRows.map(({ row, index, item }) =>
                row === undefined ? null : (
                  <tr
                    key={row.id}
                    aria-rowindex={index + 2}
                    data-index={item?.index}
                    ref={item === null ? undefined : virtualizer.measureElement}
                    style={
                      item === null
                        ? undefined
                        : {
                            position: "absolute",
                            transform: `translateY(${item.start}px)`,
                            width: "100%",
                          }
                    }
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
                          role="gridcell"
                          aria-colindex={column + 1}
                          aria-label={`${property.name}, ${displayDatabaseValue(row.original, property)}`}
                          tabIndex={
                            activeCell.row === index && activeCell.column === column ? 0 : -1
                          }
                          data-grid-mode={editing ? "editing" : "navigation"}
                          onFocus={(event) => {
                            if (event.target === event.currentTarget) setActiveCell(position);
                          }}
                          onKeyDown={(event) =>
                            onCellKeyDown(event, position, property, row.original)
                          }
                        >
                          {editing ? (
                            <div className="database-cell-editor">
                              {property.type === "title" ? (
                                <label>
                                  <span className="sr-only">Title for {row.original.title}</span>
                                  <input
                                    value={
                                      typeof editingCell.draft === "string" ? editingCell.draft : ""
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
                              ) : (
                                <ValueEditor
                                  property={property}
                                  input={editingCell.draft}
                                  error={editingCell.error}
                                  idSuffix={row.original.entryId}
                                  relationOptions={relationOptions.filter(
                                    ({ id }) => id !== row.original.entryId,
                                  )}
                                  onChange={(draft) =>
                                    setEditingCell((current) =>
                                      current?.key === key
                                        ? { ...current, draft, error: null }
                                        : current,
                                    )
                                  }
                                />
                              )}
                              {property.type === "title" && editingCell.error !== null ? (
                                <span className="database-field__error" role="alert">
                                  {editingCell.error}
                                </span>
                              ) : null}
                              <div className="database-cell-editor__actions">
                                <button
                                  type="button"
                                  disabled={editingCell.saving}
                                  onClick={() => void saveEdit(position, property, row.original)}
                                >
                                  {editingCell.saving
                                    ? `Saving ${property.name}…`
                                    : `Save ${property.name} for ${row.original.title}`}
                                </button>
                                <button
                                  type="button"
                                  disabled={editingCell.saving}
                                  onClick={() => cancelEdit(position)}
                                >
                                  Cancel edit
                                </button>
                                <button
                                  type="button"
                                  className="link"
                                  data-entry-trigger={row.original.entryId}
                                  onClick={(event) =>
                                    onOpenEntry(row.original.entryId as Uuid, event.currentTarget)
                                  }
                                >
                                  Open full entry
                                </button>
                              </div>
                            </div>
                          ) : (
                            <table.FlexRender cell={cell} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </section>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
