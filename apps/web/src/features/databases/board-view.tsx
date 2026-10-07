import type {
  DatabaseProperty,
  DatabaseView,
  PropertyOption,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type MutableRefObject,
  type Ref,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
} from "../../ui/primitives/index.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { ConvertItemControl } from "../navigation/convert-item.tsx";
import {
  type BoardCardDraft,
  BoardCardEditor,
  type BoardCardEditorHandle,
} from "./board-card-editor.tsx";
import { BoardCreateCard } from "./board-create-card.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { DatabaseEntryActionsContext } from "./database-entry-actions-context.tsx";
import {
  choiceOptionsForRow,
  isChoiceProperty,
  OptionPill,
  optionTone,
  PropertyValue,
} from "./option-appearance.tsx";
import { observeTableScrollOffset } from "./table-scroll-observer.ts";
import type { DatabaseCellUpdate } from "./table-view.tsx";
import { usePageHeaders } from "./use-page-headers.ts";
import { useTableViewport } from "./use-table-viewport.ts";
import type { RelationOption } from "./value-editor.tsx";
import { visibleViewColumns } from "./view-columns.ts";

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
  onEdit,
  onOpenEntry,
}: {
  readonly onEdit: () => void;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
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
  const actions = useContext(DatabaseEntryActionsContext);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const actionBusy = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const choosingDestination = useRef(false);
  const [open, setOpen] = useState(false);
  const runAction = async (action: () => Promise<void>, fallback: string) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setActionPending(true);
    setError(null);
    try {
      await action();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      actionBusy.current = false;
      setActionPending(false);
    }
  };
  return (
    <MenuRoot
      open={open}
      setOpen={(next) => {
        if (next) {
          choosingDestination.current = false;
          setMoving(false);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <MenuTrigger
        ref={triggerRef}
        className="database-card__menu"
        aria-label={`Actions de ${row.title}`}
        title="Actions de la carte"
        data-pending={pending || undefined}
      >
        <AppIcon name={pending ? "loading" : "more"} />
      </MenuTrigger>
      <MenuContent
        className="database-board-menu"
        aria-busy={actionPending}
        data-board-menu-entry={row.entryId}
        autoFocusOnHide={() => !choosingDestination.current}
      >
        {moving ? (
          <MenuItem hideOnClick={false} onClick={() => setMoving(false)}>
            <AppIcon name="arrowLeft" size="small" /> Actions de la carte
          </MenuItem>
        ) : (
          <>
            {actions === null ? null : (
              <MenuItem onClick={onEdit}>
                <AppIcon name="edit" size="small" /> Modifier les propriétés
              </MenuItem>
            )}
            {actions === null ? null : (
              <MenuItem onClick={() => actions.editIcon(row.entryId as Uuid)}>
                <AppIcon name="smile" size="small" /> Modifier l’icône
              </MenuItem>
            )}
            <MenuItem onClick={() => onOpenEntry(row.entryId as Uuid, triggerRef.current)}>
              <AppIcon name="sidePeek" size="small" /> Ouvrir en volet latéral
            </MenuItem>
            {actions === null ? null : (
              <MenuItem onClick={() => actions.openFullPage(row.entryId as Uuid)}>
                <AppIcon name="expand" size="small" /> Ouvrir en pleine page
              </MenuItem>
            )}
            <MenuItem
              hideOnClick={false}
              disabled={actionPending}
              onClick={() => {
                void runAction(
                  () =>
                    navigator.clipboard.writeText(
                      new URL(`/notes/${row.entryId}`, window.location.origin).href,
                    ),
                  "Le lien n’a pas pu être copié. Réessayez.",
                );
              }}
            >
              <AppIcon name="link" size="small" /> Copier le lien
            </MenuItem>
            <MenuItem hideOnClick={false} onClick={() => setMoving(true)}>
              <AppIcon name="arrowRight" size="small" /> Déplacer dans un groupe
              <AppIcon name="chevronRight" size="small" />
            </MenuItem>
            {actions === null ? null : (
              <>
                <ConvertItemControl
                  itemId={row.entryId as Uuid}
                  itemName={row.title}
                  kind={row.itemKind ?? "page"}
                  convert={actions.convert}
                  finalFocus={triggerRef}
                  variant="menu"
                />
                <MenuItem
                  hideOnClick={false}
                  disabled={actionPending}
                  onClick={() => {
                    void runAction(
                      () => actions.trash(row.entryId as Uuid),
                      "La suppression a échoué.",
                    );
                  }}
                >
                  <AppIcon name="delete" size="small" /> Déplacer dans la corbeille
                </MenuItem>
              </>
            )}
          </>
        )}
        {error === null ? null : <p role="alert">{error}</p>}
        {moving ? <MenuLabel>{DATABASE_COPY.board.moveTo}</MenuLabel> : null}
        {moving
          ? columns.map((target) => (
              <MenuItem
                key={target.id}
                disabled={pending || target.id === column.id}
                data-board-destination={target.id}
                shortcut={
                  target.id === column.id ? <AppIcon name="check" size="small" /> : undefined
                }
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
            ))
          : null}
      </MenuContent>
    </MenuRoot>
  );
}

function BoardCards({
  properties,
  column,
  columns,
  draggedCard,
  onOpenEntry,
  onUpdateEntry,
  onMove,
  pendingEntryIds,
  multiSelect,
  cardProperties,
  editingEntryId,
  onEditCard,
  onCloseEditor,
  editorRef,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly cardProperties: readonly DatabaseProperty[];
  readonly editingEntryId: string | null;
  readonly onEditCard: (row: DatabaseViewRow) => void;
  readonly onCloseEditor: (entryId: string) => void;
  readonly editorRef: Ref<BoardCardEditorHandle>;
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
  const actions = useContext(DatabaseEntryActionsContext);
  const editCard = onEditCard;
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
      const editingIndex = column.rows.findIndex((row) => row.entryId === editingEntryId);
      if (editingIndex >= 0 && !indexes.includes(editingIndex)) indexes.push(editingIndex);
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
              data-editing={editingEntryId === row.entryId || undefined}
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
              draggable={
                editingEntryId !== row.entryId &&
                onUpdateEntry !== undefined &&
                !pendingEntryIds.has(row.entryId as Uuid)
              }
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
              {actions !== null ? (
                <BoardCardEditor
                  ref={editingEntryId === row.entryId ? editorRef : undefined}
                  expanded={editingEntryId === row.entryId}
                  cardProperties={cardProperties}
                  titleIcon={
                    row.icon || row.itemKind === "folder" || row.holdsContent ? (
                      <ItemIcon
                        kind={row.itemKind === "folder" ? "folder" : "page"}
                        icon={row.icon ?? null}
                        holdsContent={row.holdsContent === true}
                        size="tree"
                      />
                    ) : null
                  }
                  columnId={column.id}
                  onOpenEntry={(trigger) => onOpenEntry(row.entryId as Uuid, trigger)}
                  properties={properties}
                  initial={{
                    kind: row.itemKind ?? "page",
                    title: row.title,
                    values: row.values as BoardCardDraft["values"],
                    relationTargets:
                      row.relationTargets as unknown as BoardCardDraft["relationTargets"],
                  }}
                  label={`Nom de ${row.title}`}
                  relationOptions={actions.relationOptions}
                  canChooseKind
                  entryId={row.entryId as Uuid}
                  onConvert={actions.convert}
                  onCancel={(restoreFocus = true) => {
                    onCloseEditor(row.entryId);
                    if (restoreFocus)
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLElement>(`[data-entry-trigger="${row.entryId}"]`)
                          ?.focus({ preventScroll: true }),
                      );
                  }}
                  onSave={async (draft, _next, previous) => {
                    await actions.save(
                      {
                        ...row,
                        title: previous.title,
                        values: previous.values as DatabaseViewRow["values"],
                        relationTargets:
                          previous.relationTargets as unknown as DatabaseViewRow["relationTargets"],
                      },
                      draft,
                    );
                  }}
                />
              ) : (
                <StableActionButton
                  type="button"
                  className="link database-card__title"
                  variant="ghost"
                  data-entry-trigger={row.entryId}
                  data-entry-column={column.id}
                  onActivate={(trigger) => onOpenEntry(row.entryId as Uuid, trigger)}
                >
                  <span className="database-card__identity">
                    {row.icon || row.itemKind === "folder" || row.holdsContent ? (
                      <ItemIcon
                        kind={row.itemKind === "folder" ? "folder" : "page"}
                        icon={row.icon ?? null}
                        holdsContent={row.holdsContent === true}
                        size="tree"
                      />
                    ) : null}
                    <span>{row.title}</span>
                  </span>
                  <span className="database-card__properties">
                    {cardProperties.map((property) => {
                      const value = row.values[property.id];
                      if (
                        isChoiceProperty(property) &&
                        choiceOptionsForRow(property, row).length === 0
                      )
                        return null;
                      if (
                        property.type !== "checkbox" &&
                        value === undefined &&
                        (row.relationTargets[property.id]?.length ?? 0) === 0
                      )
                        return null;
                      return (
                        <span
                          key={property.id}
                          className="database-card__property"
                          title={property.name}
                        >
                          {property.type === "checkbox" ? (
                            <span className="database-card__checkbox-value">
                              <span
                                className="database-card__checkbox"
                                data-checked={
                                  (value?.kind === "checkbox" && value.checked) || undefined
                                }
                                aria-hidden="true"
                              >
                                {value?.kind === "checkbox" && value.checked ? (
                                  <AppIcon name="check" size="small" />
                                ) : null}
                              </span>
                              <span>{property.name}</span>
                            </span>
                          ) : (
                            <>
                              <span className="sr-only">{property.name} : </span>
                              <PropertyValue property={property} row={row} />
                            </>
                          )}
                        </span>
                      );
                    })}
                  </span>
                </StableActionButton>
              )}
              {onUpdateEntry === undefined || editingEntryId === row.entryId ? null : (
                <div className="database-card__actions">
                  {actions === null ? null : (
                    <Button
                      className="database-card__edit"
                      data-board-edit-trigger
                      size="square"
                      variant="ghost"
                      aria-label={`Modifier ${row.title}`}
                      title="Modifier les propriétés"
                      onClick={() => editCard(row)}
                    >
                      <AppIcon name="edit" size="small" />
                    </Button>
                  )}
                  <BoardCardMenu
                    onEdit={() => editCard(row)}
                    onOpenEntry={onOpenEntry}
                    row={row}
                    column={column}
                    columns={columns}
                    pending={pendingEntryIds.has(row.entryId as Uuid)}
                    multiSelect={multiSelect}
                    onMove={onMove}
                  />
                </div>
              )}
              {row.syncState !== "conflict" ? null : (
                <span className="database-sync database-sync--conflict">
                  {DATABASE_COPY.common.conflict}
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
  relationOptions = [],
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
    title: string,
    relations: RelationTargets,
  ) => void | Uuid | Promise<void | Uuid>;
  readonly canCreateFolder?: boolean;
  readonly relationOptions?: readonly RelationOption[];
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const actions = useContext(DatabaseEntryActionsContext);
  const axes = properties.filter(
    (property): property is BoardAxisProperty =>
      property.state === "active" && isBoardAxisProperty(property),
  );
  const axis = axes.find(({ id }) => id === view.options.axisPropertyId);
  const [editingCard, setEditingCard] = useState<{ row: DatabaseViewRow; columnId: string } | null>(
    null,
  );
  const editorRef = useRef<BoardCardEditorHandle>(null);
  const editRequest = useRef(0);
  const editCard = async (row: DatabaseViewRow, columnId: string) => {
    const request = ++editRequest.current;
    if ((await editorRef.current?.finish()) === false || request !== editRequest.current) return;
    setEditingCard({ row, columnId });
  };
  const columns = (axis === undefined ? [] : boardColumns(view, axis, page.rows)).map((column) => {
    if (editingCard === null) return column;
    const rows = column.rows.filter((row) => row.entryId !== editingCard.row.entryId);
    if (column.id === editingCard.columnId) {
      const index = column.rows.findIndex((row) => row.entryId === editingCard.row.entryId);
      rows.splice(
        index < 0 ? rows.length : index,
        0,
        page.rows.find((row) => row.entryId === editingCard.row.entryId) ?? editingCard.row,
      );
    }
    return { ...column, rows };
  });
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
  const scrollRef = useRef<HTMLElement>(null);
  const viewport = useTableViewport(scrollRef, ".database-board");
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  usePageHeaders(scrollRef, viewport, headerRef, bodyRef);
  const previousViewId = useRef(view.id);
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
    setEditingCard(null);
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
  if (axis === undefined) {
    return (
      <section className="database-view" aria-label={DATABASE_COPY.board.viewLabel(view.name)}>
        <AsyncState kind="unavailable" description={DATABASE_COPY.board.needsProperty} />
        <p className="muted">
          Ouvrez « Grouper » dans les réglages de la vue pour choisir une propriété.
        </p>
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

  const columnHeader = (column: BoardColumn, collapsed: boolean) => {
    const headingId = `board-column-${view.id}-${column.id}`;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: drop surface also has a keyboard move menu on each card.
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
                  {collapsed || column.rows.length === 0 ? null : (
                    <BoardCards
                      properties={properties}
                      editingEntryId={
                        editingCard?.columnId === column.id ? editingCard.row.entryId : null
                      }
                      editorRef={editorRef}
                      onEditCard={(row) => void editCard(row, column.id)}
                      onCloseEditor={(entryId) =>
                        setEditingCard((current) =>
                          current?.row.entryId === entryId ? null : current,
                        )
                      }
                      cardProperties={visibleViewColumns(properties, view.properties).filter(
                        (property) => property.type !== "title",
                      )}
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
                    <BoardCreateCard
                      columnLabel={column.label}
                      canCreateFolder={canCreateFolder}
                      properties={properties}
                      initialValues={boardCreateValues(axis, column.id) ?? {}}
                      relationOptions={
                        relationOptions.length ? relationOptions : (actions?.relationOptions ?? [])
                      }
                      onCreate={async (kind, title, values, relations) => {
                        if (boardCreateValues(axis, column.id) === null)
                          throw new Error("Colonne indisponible");
                        return await onCreateInColumn(kind, values, title, relations);
                      }}
                    />
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
