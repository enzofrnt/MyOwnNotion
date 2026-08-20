import type { DatabaseProperty, DatabaseView, PropertyOption, Uuid } from "@myownnotion/domain";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type MutableRefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import type { DatabaseCellUpdate } from "./table-view.tsx";

type BoardViewDefinition = Extract<DatabaseView, { type: "board" }>;
type OptionProperty = Extract<
  DatabaseProperty,
  { readonly config: { readonly options: readonly PropertyOption[] } }
>;
type BoardAxisProperty = OptionProperty & { readonly type: "status" | "select" };

export interface BoardColumn {
  readonly id: Uuid | "missing";
  readonly label: string;
  readonly rows: readonly DatabaseViewRow[];
}

function boardAxisValue(row: DatabaseViewRow, property: BoardAxisProperty): Uuid | "missing" {
  const value = row.values[property.id];
  if (
    value !== undefined &&
    (value.kind === "status" || value.kind === "select") &&
    property.config.options.some(({ id, state }) => id === value.optionId && state === "active")
  ) {
    return value.optionId as Uuid;
  }
  return "missing";
}

function isBoardAxisProperty(property: DatabaseProperty): property is BoardAxisProperty {
  return property.type === "status" || property.type === "select";
}

export function boardColumns(
  view: BoardViewDefinition,
  property: DatabaseProperty,
  rows: readonly DatabaseViewRow[],
): readonly BoardColumn[] {
  if (!isBoardAxisProperty(property)) return [];
  const activeOptions = property.config.options
    .filter(({ state }) => state === "active")
    .sort(
      (left, right) =>
        left.positionKey.localeCompare(right.positionKey) || left.id.localeCompare(right.id),
    );
  const byId = new Map(activeOptions.map((option) => [option.id, option]));
  const orderedIds = [
    ...view.options.columnOrder.filter((id) => byId.has(id)),
    ...activeOptions.map(({ id }) => id).filter((id) => !view.options.columnOrder.includes(id)),
  ];
  return [
    ...orderedIds.map((id) => ({
      id,
      label: byId.get(id)?.label ?? DATABASE_COPY.common.unavailableOption,
      rows: rows.filter((row) => boardAxisValue(row, property) === id),
    })),
    {
      id: "missing" as const,
      label: DATABASE_COPY.board.noPropertyValue(property.name),
      rows: rows.filter((row) => boardAxisValue(row, property) === "missing"),
    },
  ];
}

export function boardMoveUpdate(
  property: DatabaseProperty,
  targetColumnId: Uuid | "missing",
): DatabaseCellUpdate | null {
  if (!isBoardAxisProperty(property)) return null;
  if (targetColumnId === "missing") {
    return { kind: "property", propertyId: property.id };
  }
  const option = property.config.options.find(
    ({ id, state }) => id === targetColumnId && state === "active",
  );
  if (option === undefined) return null;
  return {
    kind: "property",
    propertyId: property.id,
    value: { kind: property.type, optionId: option.id },
  };
}

function BoardCards({
  column,
  columns,
  draggedEntryId,
  onOpenEntry,
  onUpdateEntry,
  onMove,
}: {
  readonly column: BoardColumn;
  readonly columns: readonly BoardColumn[];
  readonly draggedEntryId: MutableRefObject<Uuid | null>;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onUpdateEntry:
    | ((entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>)
    | undefined;
  readonly onMove: (entryId: Uuid, targetColumnId: Uuid | "missing") => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedEntryId, setFocusedEntryId] = useState<Uuid | null>(null);
  const focusedIndex = column.rows.findIndex(({ entryId }) => entryId === focusedEntryId);
  const virtualizer = useVirtualizer({
    count: column.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 174,
    getItemKey: (index) => column.rows[index]?.entryId ?? index,
    overscan: 4,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
      return indexes.sort((left, right) => left - right);
    },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const virtualized = column.rows.length > 60 && virtualRows.length > 0;
  const renderedRows = virtualized
    ? virtualRows.map((item) => ({
        row: column.rows[item.index],
        index: item.index,
        start: item.start,
      }))
    : column.rows.map((row, index) => ({ row, index, start: null }));
  const moveAdjacent = (row: DatabaseViewRow, direction: -1 | 1): void => {
    const index = columns.findIndex(({ id }) => id === column.id);
    const target = columns[index + direction];
    if (target !== undefined) void onMove(row.entryId as Uuid, target.id);
  };
  const suppressNativeButtonActivation = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
  };
  const moveAdjacentFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    row: DatabaseViewRow,
    direction: -1 | 1,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    moveAdjacent(row, direction);
  };

  return (
    <div
      ref={scrollRef}
      className={virtualized ? "database-card-list-scroll" : undefined}
      data-virtualized={virtualized ? "true" : undefined}
    >
      <ul
        className="database-card-list"
        aria-label={DATABASE_COPY.board.cardsFor(column.label)}
        style={
          virtualized ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined
        }
      >
        {renderedRows.map(({ row, index, start }) =>
          row === undefined ? null : (
            <li
              key={row.entryId}
              ref={start === null ? undefined : virtualizer.measureElement}
              data-index={start === null ? undefined : index}
              aria-posinset={index + 1}
              aria-setsize={column.rows.length}
              className="database-card"
              style={
                start === null
                  ? undefined
                  : {
                      position: "absolute",
                      transform: `translateY(${start}px)`,
                      width: "100%",
                    }
              }
              draggable
              onFocusCapture={() => setFocusedEntryId(row.entryId as Uuid)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setFocusedEntryId(null);
                }
              }}
              onDragStart={(event) => {
                draggedEntryId.current = row.entryId as Uuid;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.entryId);
              }}
              onDragEnd={() => {
                draggedEntryId.current = null;
              }}
            >
              <button
                type="button"
                className="link database-card__title"
                data-entry-trigger={row.entryId}
                onClick={(event) => onOpenEntry(row.entryId as Uuid, event.currentTarget)}
              >
                {row.title}
              </button>
              <label>
                <span className="visually-hidden">
                  {DATABASE_COPY.board.moveToAnother(row.title)}
                </span>
                <select
                  aria-label={DATABASE_COPY.board.moveToAnother(row.title)}
                  value={column.id}
                  disabled={onUpdateEntry === undefined}
                  onChange={(event) =>
                    void onMove(row.entryId as Uuid, event.target.value as Uuid | "missing")
                  }
                >
                  {columns.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="database-card__move-actions">
                <button
                  type="button"
                  aria-label={DATABASE_COPY.board.movePrevious(row.title)}
                  disabled={columns[0]?.id === column.id || onUpdateEntry === undefined}
                  onClick={() => moveAdjacent(row, -1)}
                  onKeyDown={suppressNativeButtonActivation}
                  onKeyUp={(event) => moveAdjacentFromKeyboard(event, row, -1)}
                >
                  {DATABASE_COPY.board.previous}
                </button>
                <button
                  type="button"
                  aria-label={DATABASE_COPY.board.moveNext(row.title)}
                  disabled={columns.at(-1)?.id === column.id || onUpdateEntry === undefined}
                  onClick={() => moveAdjacent(row, 1)}
                  onKeyDown={suppressNativeButtonActivation}
                  onKeyUp={(event) => moveAdjacentFromKeyboard(event, row, 1)}
                >
                  {DATABASE_COPY.board.next}
                </button>
              </div>
              {row.syncState === "synced" ? null : (
                <span className={`database-sync database-sync--${row.syncState}`}>
                  {row.syncState === "pending"
                    ? DATABASE_COPY.common.savedLocally
                    : DATABASE_COPY.common.conflict}
                </span>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function BoardView({
  properties,
  view,
  page,
  onOpenEntry,
  onUpdateEntry,
  onChangeView,
  scrollTop = 0,
  onScroll,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: BoardViewDefinition;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly onChangeView: (view: BoardViewDefinition) => void | Promise<void>;
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const axes = properties.filter(
    (property): property is BoardAxisProperty =>
      property.state === "active" && isBoardAxisProperty(property),
  );
  const axis = axes.find(({ id }) => id === view.options.axisPropertyId) ?? axes[0];
  const columns = axis === undefined ? [] : boardColumns(view, axis, page.rows);
  const draggedEntryId = useRef<Uuid | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element !== null && Math.abs(element.scrollTop - scrollTop) >= 1) {
      element.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  if (axis === undefined) {
    return (
      <section className="database-view" aria-label={DATABASE_COPY.board.viewLabel(view.name)}>
        <p role="alert">{DATABASE_COPY.board.needsProperty}</p>
      </section>
    );
  }

  const move = async (entryId: Uuid, targetColumnId: Uuid | "missing"): Promise<void> => {
    const update = boardMoveUpdate(axis, targetColumnId);
    const target = columns.find(({ id }) => id === targetColumnId);
    const row = page.rows.find((candidate) => candidate.entryId === entryId);
    if (
      update === null ||
      target === undefined ||
      row === undefined ||
      onUpdateEntry === undefined
    ) {
      return;
    }
    try {
      await onUpdateEntry(entryId, update);
      setAnnouncement(DATABASE_COPY.board.moved(row.title, target.label));
    } catch {
      setAnnouncement(DATABASE_COPY.board.moveFailed(row.title));
    }
  };

  return (
    <section
      ref={scrollRef}
      className="database-view database-board-scroll"
      aria-label={DATABASE_COPY.board.viewLabel(view.name)}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
    >
      <label className="database-view-setting">
        {DATABASE_COPY.board.groupingProperty}
        <select
          value={axis.id}
          onChange={(event) => {
            const next = axes.find(({ id }) => id === event.target.value);
            if (next === undefined) return;
            void onChangeView({
              ...view,
              options: {
                axisPropertyId: next.id,
                columnOrder: next.config.options
                  .filter(({ state }) => state === "active")
                  .map(({ id }) => id),
                collapsedColumnIds: [],
              },
            });
          }}
        >
          {axes.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      <ol className="database-board" aria-label={DATABASE_COPY.board.columnsGroupedBy(axis.name)}>
        {columns.map((column) => {
          const collapsed =
            column.id !== "missing" && view.options.collapsedColumnIds.includes(column.id);
          const headingId = `board-column-${view.id}-${column.id}`;
          return (
            <li key={column.id} className="database-board__column">
              <section
                aria-labelledby={headingId}
                data-board-column={column.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const entryId =
                    draggedEntryId.current ??
                    (event.dataTransfer.getData("text/plain") as Uuid | "");
                  if (entryId !== "") void move(entryId, column.id);
                  draggedEntryId.current = null;
                }}
              >
                <header>
                  <h3 id={headingId}>
                    {column.label} · {column.rows.length}
                  </h3>
                  {column.id === "missing" ? null : (
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      aria-label={`${
                        collapsed ? DATABASE_COPY.board.expand : DATABASE_COPY.board.collapse
                      } ${column.label}`}
                      onClick={() => {
                        const collapsedColumnIds = collapsed
                          ? view.options.collapsedColumnIds.filter((id) => id !== column.id)
                          : [...view.options.collapsedColumnIds, column.id as Uuid];
                        void onChangeView({
                          ...view,
                          options: { ...view.options, collapsedColumnIds },
                        });
                      }}
                    >
                      {collapsed ? DATABASE_COPY.board.expand : DATABASE_COPY.board.collapse}
                    </button>
                  )}
                </header>
                {collapsed ? null : column.rows.length === 0 ? (
                  <p className="muted">{DATABASE_COPY.board.noCards}</p>
                ) : (
                  <BoardCards
                    column={column}
                    columns={columns}
                    draggedEntryId={draggedEntryId}
                    onOpenEntry={onOpenEntry}
                    onUpdateEntry={onUpdateEntry}
                    onMove={move}
                  />
                )}
              </section>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
