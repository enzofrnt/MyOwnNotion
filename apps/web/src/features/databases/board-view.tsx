import type { DatabaseProperty, DatabaseView, PropertyOption, Uuid } from "@myownnotion/domain";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { type MutableRefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon } from "../../ui/item-icon.tsx";
import {
  AsyncState,
  Button,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuTrigger,
  PopoverContent,
  PopoverDismiss,
  PopoverHeading,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { OptionPill, optionTone } from "./option-appearance.tsx";
import { observeTableScrollOffset } from "./table-scroll-observer.ts";
import type { DatabaseCellUpdate } from "./table-view.tsx";
import { usePageHeaders } from "./use-page-headers.ts";
import { useTableViewport } from "./use-table-viewport.ts";

type BoardViewDefinition = Extract<DatabaseView, { type: "board" }>;
type OptionProperty = Extract<
  DatabaseProperty,
  { readonly config: { readonly options: readonly PropertyOption[] } }
>;
type BoardAxisProperty = OptionProperty & { readonly type: "status" | "select" | "multi-select" };

export interface BoardColumn {
  readonly id: Uuid | "missing";
  readonly label: string;
  readonly tone?: string | undefined;
  readonly rows: readonly DatabaseViewRow[];
}

function boardAxisValues(
  row: DatabaseViewRow,
  property: BoardAxisProperty,
): readonly (Uuid | "missing")[] {
  const value = row.values[property.id];
  const ids =
    value?.kind === "multi-select"
      ? value.optionIds
      : value?.kind === "status" || value?.kind === "select"
        ? [value.optionId]
        : [];
  const active = new Set(
    property.config.options.filter((o) => o.state === "active").map((o) => o.id),
  );
  const memberships = [...new Set(ids)].filter((id) => active.has(id as Uuid)) as Uuid[];
  return memberships.length === 0 ? ["missing"] : memberships;
}

function isBoardAxisProperty(property: DatabaseProperty): property is BoardAxisProperty {
  return (
    property.type === "status" || property.type === "select" || property.type === "multi-select"
  );
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
      tone: byId.get(id)?.tone,
      rows: rows.filter((row) => boardAxisValues(row, property).includes(id)),
    })),
    {
      id: "missing" as const,
      label: DATABASE_COPY.board.noPropertyValue(property.name),
      rows: rows.filter((row) => boardAxisValues(row, property).includes("missing")),
    },
  ];
}

export function boardMoveUpdate(
  property: DatabaseProperty,
  targetColumnId: Uuid | "missing",
  sourceColumnId?: Uuid | "missing",
): DatabaseCellUpdate | null {
  if (
    property.state !== "active" ||
    !isBoardAxisProperty(property) ||
    sourceColumnId === targetColumnId
  )
    return null;
  if (property.type === "multi-select") {
    if (
      sourceColumnId === undefined ||
      (sourceColumnId !== "missing" &&
        !property.config.options.some((o) => o.id === sourceColumnId && o.state === "active"))
    )
      return null;
    if (
      targetColumnId !== "missing" &&
      !property.config.options.some((o) => o.id === targetColumnId && o.state === "active")
    )
      return null;
    return {
      kind: "property",
      propertyId: property.id,
      optionMove: { from: sourceColumnId, to: targetColumnId },
    };
  }
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

export type BoardInitialValues = DatabaseViewRow["values"];
export function boardCreateValues(
  property: DatabaseProperty,
  columnId: Uuid | "missing",
): BoardInitialValues | null {
  if (property.state !== "active" || !isBoardAxisProperty(property)) return null;
  if (columnId === "missing") return {};
  if (!property.config.options.some((o) => o.id === columnId && o.state === "active")) return null;
  return {
    [property.id]:
      property.type === "multi-select"
        ? { kind: "multi-select", optionIds: [columnId] }
        : { kind: property.type, optionId: columnId },
  };
}

function BoardCardMenu({
  row,
  column,
  columns,
  pending,
  multiSelect,
  onMove,
}: {
  readonly row: DatabaseViewRow;
  readonly column: BoardColumn;
  readonly columns: readonly BoardColumn[];
  readonly pending: boolean;
  readonly multiSelect: boolean;
  readonly onMove: (
    entryId: Uuid,
    targetColumnId: Uuid | "missing",
    sourceColumnId: Uuid | "missing",
  ) => Promise<void>;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const choosingDestination = useRef(false);
  const [open, setOpen] = useState(false);
  return (
    <MenuRoot
      open={open}
      setOpen={(next) => {
        if (next) choosingDestination.current = false;
        setOpen(next);
      }}
    >
      <MenuTrigger
        ref={triggerRef}
        className="database-card__menu"
        aria-label={DATABASE_COPY.board.moveToAnother(row.title)}
        title={DATABASE_COPY.board.moveToAnother(row.title)}
        data-pending={pending || undefined}
      >
        <AppIcon name={pending ? "loading" : "more"} />
      </MenuTrigger>
      <MenuContent
        unmountOnHide
        className="database-board-menu"
        data-board-menu-entry={row.entryId}
        autoFocusOnHide={() => !choosingDestination.current}
      >
        <MenuLabel>{DATABASE_COPY.board.moveTo}</MenuLabel>
        {columns.map((target) => (
          <MenuItem
            key={target.id}
            disabled={pending || target.id === column.id}
            data-board-destination={target.id}
            shortcut={target.id === column.id ? <AppIcon name="check" size="small" /> : undefined}
            onClick={() => {
              // Return to the card before moving: its origin survives portal focus,
              // and BoardView can return to the destination once rows refresh.
              choosingDestination.current = true;
              setOpen(false);
              triggerRef.current?.focus({ preventScroll: true });
              void onMove(row.entryId as Uuid, target.id, column.id);
            }}
          >
            <span className="database-board-menu__destination">
              {target.tone === undefined ? (
                target.label
              ) : (
                <OptionPill label={target.label} tone={target.tone} />
              )}
              {target.id === "missing" && multiSelect ? (
                <span className="database-board-menu__hint">
                  {DATABASE_COPY.board.clearSelections}
                </span>
              ) : null}
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}

function BoardCards({
  column,
  columns,
  draggedCard,
  onOpenEntry,
  onUpdateEntry,
  onMove,
  pendingEntryIds,
  multiSelect,
}: {
  readonly column: BoardColumn;
  readonly columns: readonly BoardColumn[];
  readonly draggedCard: MutableRefObject<{
    entryId: Uuid;
    sourceColumnId: Uuid | "missing";
  } | null>;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onUpdateEntry:
    | ((entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>)
    | undefined;
  readonly pendingEntryIds: ReadonlySet<Uuid>;
  readonly multiSelect: boolean;
  readonly onMove: (
    entryId: Uuid,
    targetColumnId: Uuid | "missing",
    sourceColumnId: Uuid | "missing",
  ) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useTableViewport(scrollRef, ".database-card-list");
  const [focusedEntryId, setFocusedEntryId] = useState<Uuid | null>(null);
  const focusedIndex = column.rows.findIndex(({ entryId }) => entryId === focusedEntryId);
  const virtualizer = useVirtualizer({
    count: column.rows.length,
    enabled: viewport.element !== null,
    getScrollElement: () => viewport.element,
    observeElementOffset: observeTableScrollOffset,
    initialOffset: () => viewport.element?.scrollTop ?? 0,
    scrollMargin: viewport.scrollMargin,
    gap: 8,
    estimateSize: () => 50,
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
              aria-busy={pendingEntryIds.has(row.entryId as Uuid) || undefined}
              style={
                start === null
                  ? undefined
                  : {
                      position: "absolute",
                      transform: `translateY(${start - viewport.scrollMargin}px)`,
                      width: "100%",
                    }
              }
              draggable={onUpdateEntry !== undefined && !pendingEntryIds.has(row.entryId as Uuid)}
              onFocusCapture={() => setFocusedEntryId(row.entryId as Uuid)}
              onBlurCapture={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                  !(event.relatedTarget as Element | null)?.closest?.(
                    `[data-board-menu-entry="${row.entryId}"]`,
                  )
                ) {
                  setFocusedEntryId(null);
                }
              }}
              onDragStart={(event) => {
                draggedCard.current = { entryId: row.entryId as Uuid, sourceColumnId: column.id };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.entryId);
              }}
              onDragEnd={() => {
                draggedCard.current = null;
              }}
            >
              <StableActionButton
                type="button"
                className="link database-card__title"
                variant="ghost"
                data-entry-trigger={row.entryId}
                data-entry-column={column.id}
                onActivate={(trigger) => onOpenEntry(row.entryId as Uuid, trigger)}
              >
                {row.icon || row.itemKind === "folder" || row.holdsContent ? (
                  <ItemIcon
                    kind={row.itemKind === "folder" ? "folder" : "page"}
                    icon={row.icon ?? null}
                    holdsContent={row.holdsContent === true}
                    size="tree"
                  />
                ) : null}
                <span>{row.title}</span>
              </StableActionButton>
              {onUpdateEntry === undefined ? null : (
                <BoardCardMenu
                  row={row}
                  column={column}
                  columns={columns}
                  pending={pendingEntryIds.has(row.entryId as Uuid)}
                  multiSelect={multiSelect}
                  onMove={onMove}
                />
              )}
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
  onCreateInColumn,
  canCreateFolder = false,
  scrollTop = 0,
  onScroll,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: BoardViewDefinition;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly onChangeView: (view: BoardViewDefinition) => void | Promise<void>;
  readonly onCreateInColumn?: (
    kind: "page" | "folder",
    values: BoardInitialValues,
  ) => void | Uuid | Promise<void | Uuid>;
  readonly canCreateFolder?: boolean;
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const axes = properties.filter(
    (property): property is BoardAxisProperty =>
      property.state === "active" && isBoardAxisProperty(property),
  );
  const axis = axes.find(({ id }) => id === view.options.axisPropertyId);
  const columns = axis === undefined ? [] : boardColumns(view, axis, page.rows);
  const draggedCard = useRef<{ entryId: Uuid; sourceColumnId: Uuid | "missing" } | null>(null);
  const pendingRef = useRef(new Set<Uuid>());
  const [pendingEntryIds, setPendingEntryIds] = useState<ReadonlySet<Uuid>>(new Set());
  const pendingFocus = useRef<{
    entryId: Uuid;
    columnId: Uuid | "missing";
    origin: Element | null;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [moveError, setMoveError] = useState(false);
  const [savingAxis, setSavingAxis] = useState(false);
  const [axisError, setAxisError] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const viewport = useTableViewport(scrollRef, ".database-board");
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  usePageHeaders(scrollRef, viewport, headerRef, bodyRef);
  const previousViewId = useRef(view.id);
  const creating = useRef(false);
  const [creatingColumn, setCreatingColumn] = useState<string | null>(null);
  const [createErrorColumn, setCreateErrorColumn] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = viewport.element;
    const changedView = previousViewId.current !== view.id;
    if (element === null) return;
    previousViewId.current = view.id;
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
  useLayoutEffect(() => {
    if (!moveError || announcement === "") return;
    // A short viewport may end at the card; reveal its refusal without taking focus.
    scrollRef.current
      ?.querySelector<HTMLElement>(".database-board__feedback")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [moveError, announcement]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the view or axis invalidates an in-progress drag even without a render dependency
  useLayoutEffect(() => {
    draggedCard.current = null;
    pendingFocus.current = null;
  }, [view.id, view.options.axisPropertyId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry focus when asynchronous query rows replace the moved occurrence
  useLayoutEffect(() => {
    const intent = pendingFocus.current;
    if (intent === null || pendingEntryIds.has(intent.entryId)) return;
    const active = document.activeElement;
    if (active !== document.body && active !== intent.origin && active?.isConnected) {
      pendingFocus.current = null;
      return;
    }
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-board-column="${intent.columnId}"] [data-entry-trigger="${intent.entryId}"]`,
    );
    if (target !== null && target !== undefined) {
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      pendingFocus.current = null;
    }
  }, [page.rows, pendingEntryIds]);
  const selectAxis = async (id: string): Promise<void> => {
    const next = axes.find((p) => p.id === id);
    if (next === undefined || savingAxis) return;
    setSavingAxis(true);
    setAxisError(false);
    try {
      await onChangeView({
        ...view,
        group: { propertyId: next.id },
        options: {
          axisPropertyId: next.id,
          columnOrder: next.config.options.filter((o) => o.state === "active").map((o) => o.id),
          collapsedColumnIds: [],
        },
      });
    } catch {
      setAxisError(true);
    } finally {
      setSavingAxis(false);
    }
  };
  if (axis === undefined) {
    return (
      <section className="database-view" aria-label={DATABASE_COPY.board.viewLabel(view.name)}>
        <AsyncState kind="unavailable" description={DATABASE_COPY.board.needsProperty} />
        {axes.length > 0 ? (
          <label>
            {DATABASE_COPY.board.groupingProperty}
            <NativeSelect
              value=""
              disabled={savingAxis}
              onChange={(event) => void selectAxis(event.target.value)}
            >
              <option value="" disabled>
                Choisir une propriété
              </option>
              {axes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {axisError ? <p role="alert">Le regroupement n’a pas pu être modifié. Réessayez.</p> : null}
      </section>
    );
  }

  const move = async (
    entryId: Uuid,
    targetColumnId: Uuid | "missing",
    sourceColumnId: Uuid | "missing",
  ): Promise<void> => {
    if (pendingRef.current.has(entryId)) return;
    const update = boardMoveUpdate(axis, targetColumnId, sourceColumnId);
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
    pendingRef.current.add(entryId);
    setPendingEntryIds(new Set(pendingRef.current));
    setMoveError(false);
    const origin = document.activeElement;
    if (
      origin?.closest(".database-card") !== null &&
      origin?.closest(".database-card") !== undefined
    )
      pendingFocus.current = { entryId, columnId: targetColumnId, origin };
    try {
      await onUpdateEntry(entryId, update);
      setAnnouncement(DATABASE_COPY.board.moved(row.title, target.label));
    } catch {
      pendingFocus.current = null;
      setMoveError(true);
      setAnnouncement(DATABASE_COPY.board.moveFailed(row.title));
    } finally {
      pendingRef.current.delete(entryId);
      setPendingEntryIds(new Set(pendingRef.current));
    }
  };

  const create = async (
    kind: "page" | "folder",
    columnId: Uuid | "missing",
    trigger: HTMLElement,
  ): Promise<void> => {
    if (creating.current || onCreateInColumn === undefined) return;
    const values = boardCreateValues(axis, columnId);
    if (values === null) return;
    creating.current = true;
    setCreatingColumn(columnId);
    setCreateErrorColumn(null);
    try {
      const id = await onCreateInColumn(kind, values);
      if (typeof id === "string") onOpenEntry(id, trigger);
    } catch {
      setCreateErrorColumn(columnId);
    } finally {
      creating.current = false;
      setCreatingColumn(null);
    }
  };

  const columnHeader = (column: BoardColumn, collapsed: boolean) => {
    const headingId = `board-column-${view.id}-${column.id}`;
    return (
      <header
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const dragged = draggedCard.current;
          if (dragged !== null) void move(dragged.entryId, column.id, dragged.sourceColumnId);
          draggedCard.current = null;
        }}
      >
        <h3 id={headingId}>
          {column.tone === undefined ? (
            column.label
          ) : (
            <OptionPill label={column.label} tone={column.tone} />
          )}
          <span className="visually-hidden"> · </span>
          <span className="database-board__count">
            {page.groups.find((g) => g.id === column.id)?.count ?? column.rows.length}
          </span>
        </h3>
        {column.id === "missing" ? null : (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            className="database-board__collapse"
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
            <AppIcon name={collapsed ? "chevronRight" : "chevronDown"} size="small" />
          </Button>
        )}
      </header>
    );
  };

  return (
    <section
      ref={scrollRef}
      className="database-view database-board-scroll"
      data-page-flow={viewport.pageFlow || undefined}
      aria-label={DATABASE_COPY.board.viewLabel(view.name)}
    >
      <div className="database-board__toolbar">
        <PopoverRoot>
          <PopoverTrigger
            className="database-board__group-trigger"
            aria-label={DATABASE_COPY.board.groupingSettings}
          >
            <AppIcon name="layers" size="small" />
            <span>{axis.name}</span>
            <AppIcon name="chevronDown" size="small" />
          </PopoverTrigger>
          <PopoverContent unmountOnHide className="database-board-settings">
            <PopoverHeading>{DATABASE_COPY.board.groupingSettings}</PopoverHeading>
            <PopoverDismiss />
            <label>
              {DATABASE_COPY.board.groupingProperty}
              <NativeSelect
                value={axis.id}
                disabled={savingAxis}
                onChange={(event) => void selectAxis(event.target.value)}
              >
                {axes.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </PopoverContent>
        </PopoverRoot>
      </div>
      {axisError ? <p role="alert">Le regroupement n’a pas pu être modifié. Réessayez.</p> : null}
      {viewport.pageFlow ? (
        <div className="database-page-header database-board-headers">
          <div ref={headerRef} className="database-page-header-scroll">
            <ol
              className="database-board database-board--headers"
              aria-label={`En-têtes des colonnes de ${axis.name}`}
            >
              {columns.map((column) => {
                const collapsed =
                  column.id !== "missing" && view.options.collapsedColumnIds.includes(column.id);
                return (
                  <li
                    key={column.id}
                    className="database-board__column"
                    data-tone={optionTone(column.tone ?? "gray")}
                    data-collapsed={collapsed || undefined}
                  >
                    {columnHeader(column, collapsed)}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}
      <div ref={bodyRef} className="database-board-body-scroll">
        <ol className="database-board" aria-label={DATABASE_COPY.board.columnsGroupedBy(axis.name)}>
          {columns.map((column) => {
            const collapsed =
              column.id !== "missing" && view.options.collapsedColumnIds.includes(column.id);
            const headingId = `board-column-${view.id}-${column.id}`;
            return (
              <li
                key={column.id}
                className="database-board__column"
                data-tone={optionTone(column.tone ?? "gray")}
                data-collapsed={collapsed || undefined}
              >
                <section
                  aria-labelledby={headingId}
                  data-board-column={column.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = draggedCard.current;
                    if (dragged !== null)
                      void move(dragged.entryId, column.id, dragged.sourceColumnId);
                    draggedCard.current = null;
                  }}
                >
                  {viewport.pageFlow ? null : columnHeader(column, collapsed)}
                  {collapsed ? null : column.rows.length === 0 ? (
                    <p className="database-board__empty">{DATABASE_COPY.board.noCards}</p>
                  ) : (
                    <BoardCards
                      column={column}
                      columns={columns}
                      draggedCard={draggedCard}
                      pendingEntryIds={pendingEntryIds}
                      multiSelect={axis.type === "multi-select"}
                      onOpenEntry={onOpenEntry}
                      onUpdateEntry={onUpdateEntry}
                      onMove={move}
                    />
                  )}
                  {collapsed || onCreateInColumn === undefined ? null : (
                    <div
                      className="database-board__create"
                      role="group"
                      aria-label={`Ajouter dans ${column.label}`}
                      aria-busy={creatingColumn === column.id}
                    >
                      <Button
                        type="button"
                        size="compact"
                        variant="ghost"
                        aria-label={`Nouvelle page dans ${column.label}`}
                        data-board-create="page"
                        data-entry-column={column.id}
                        disabled={creatingColumn !== null}
                        onClick={(event) => void create("page", column.id, event.currentTarget)}
                      >
                        <AppIcon
                          name={creatingColumn === column.id ? "loading" : "fileAdd"}
                          size="small"
                        />{" "}
                        Page
                      </Button>
                      {canCreateFolder ? (
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          aria-label={`Nouveau dossier dans ${column.label}`}
                          data-board-create="folder"
                          data-entry-column={column.id}
                          disabled={creatingColumn !== null}
                          onClick={(event) => void create("folder", column.id, event.currentTarget)}
                        >
                          <AppIcon name="folderAdd" size="small" /> Dossier
                        </Button>
                      ) : null}
                    </div>
                  )}
                  {createErrorColumn !== column.id ? null : (
                    <p role="alert" className="database-board__create-error">
                      {DATABASE_COPY.page.entryCreateFailed}
                    </p>
                  )}
                  {column.id === "missing" && axis.type === "multi-select" ? (
                    <p className="database-board__drop-hint">
                      {DATABASE_COPY.board.clearSelections}
                    </p>
                  ) : null}
                </section>
              </li>
            );
          })}
        </ol>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={moveError ? "database-board__feedback" : "visually-hidden"}
      >
        {announcement}
      </p>
    </section>
  );
}
