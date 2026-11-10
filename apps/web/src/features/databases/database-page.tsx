import {
  type DatabaseDto,
  type DatabaseEntryDto,
  presentDatabaseQuery,
} from "@myownnotion/contracts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  DatabaseView,
  DefinitionImpact,
  PropertyOption,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import {
  evaluateDatabaseView,
  extractSearchableDocumentText,
  generateUuidV7,
  pageBodyHoldsEditorialContent,
  readDocumentBody,
} from "@myownnotion/domain";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  DatabaseViewPage,
  DatabaseViewResult,
  DatabaseViewRow,
} from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import {
  AsyncState,
  Button,
  DialogContent,
  DialogDescription,
  DialogHeading,
  DialogRoot,
  PopoverContent,
  PopoverHeading,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { defaultItemTitle } from "../workspace/default-item-title.ts";
import { BoardView } from "./board-view.tsx";
import { CalendarView } from "./calendar-view.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { DatabaseEntryOpenContext } from "./database-entry-open-context.tsx";
import { DatabaseToolbar, replaceSavedView } from "./database-toolbar.tsx";
import { FilterEditor } from "./filter-editor.tsx";
import { type GalleryPreview, GalleryView } from "./gallery-view.tsx";
import { GroupEditor } from "./group-editor.tsx";
import { ListView } from "./list-view.tsx";
import { MapView } from "./map-view.tsx";
import {
  isChoiceProperty,
  PropertyOptionsEditor,
  replaceChoiceOptions,
} from "./option-appearance.tsx";
import { propertyWithType } from "./property-configuration.tsx";
import {
  type DatabasePropertyDraft,
  defaultSelectionOptions,
  PropertyEditor,
  propertyFromDraft,
  validatePropertyDraft,
} from "./property-editor.tsx";
import { DatabasePropertyIcon, PropertyIconPicker } from "./property-icon.tsx";
import { PropertyVisibilitySwitch } from "./property-visibility-switch.tsx";
import { SortGroupEditor } from "./sort-group-editor.tsx";
import { type DatabaseCellUpdate, TableView } from "./table-view.tsx";
import { TaskConfiguration } from "./task-configuration.tsx";
import { useDatabaseView } from "./use-database-view.ts";
import type { RelationOption } from "./value-editor.tsx";
import { columnPresentations, viewColumns } from "./view-columns.ts";

const EMPTY_PROPERTY_DRAFT: DatabasePropertyDraft = { name: "", type: "text" };

const PROPERTY_TYPE_GROUPS: readonly {
  readonly label: string;
  readonly types: readonly DatabaseProperty["type"][];
}[] = [
  {
    label: "Basique",
    types: [
      "text",
      "number",
      "date",
      "select",
      "multi-select",
      "status",
      "checkbox",
      "url",
      "email",
      "phone",
      "files",
    ],
  },
  {
    label: "Avancé",
    types: ["relation", "rollup", "formula", "unique-id", "created-time", "last-edited-time"],
  },
];

export function withEntryPresentation(
  page: DatabaseViewPage,
  entries: readonly DatabaseEntryDto[],
): DatabaseViewPage {
  if (entries.length === 0) return page;
  const byId = new Map(
    entries.map((entry) => [
      entry.entryId,
      {
        itemKind: entry.kind === "folder" ? ("folder" as const) : ("page" as const),
        icon: entry.icon ?? null,
        holdsContent:
          entry.kind !== "folder" && pageBodyHoldsEditorialContent(entry.document?.body),
        revisionId: entry.revisionId,
        values: entry.values,
        relationTargets: entry.relationTargets,
      },
    ]),
  );
  return {
    ...page,
    rows: page.rows.map((row) => {
      const presentation = byId.get(row.entryId);
      if (presentation === undefined) return row;
      const { revisionId, values, relationTargets, ...appearance } = presentation;
      // Query DTOs omit hidden properties. The expanded card edits the full
      // entry, but must not replace a newer query with stale local values.
      return {
        ...row,
        ...appearance,
        ...(row.revisionId === revisionId ? { values, relationTargets } : {}),
      };
    }),
  };
}

export interface DefinitionConfirmation {
  readonly digest: string;
  readonly decision: "preserve-incompatible" | "discard-confirmed";
}

interface PendingDatabaseEntry {
  readonly entryId: Uuid;
  readonly title: string;
  readonly itemKind: "page" | "folder";
  readonly createdAt: string;
}

/** Append optimistic rows at the end of the grid until the projection catches up. */
function withPendingEntries(
  page: DatabaseViewPage | null,
  pending: readonly PendingDatabaseEntry[],
): DatabaseViewPage | null {
  if (page === null || pending.length === 0) return page;
  const known = new Set(page.rows.map((row) => row.entryId));
  const additions = pending.filter((entry) => !known.has(entry.entryId));
  if (additions.length === 0) return page;
  const rows: DatabaseViewRow[] = additions.map((entry) => ({
    entryId: entry.entryId,
    revisionId: entry.entryId,
    createdAt: entry.createdAt,
    title: entry.title,
    values: {},
    relationTargets: {},
    groupId: null,
    syncState: "pending",
    itemKind: entry.itemKind,
    icon: null,
    holdsContent: false,
  }));
  return {
    ...page,
    rows: [...page.rows, ...rows],
    availableCount: page.availableCount + rows.length,
    expectedCount: page.expectedCount + rows.length,
  };
}

export function DatabasePage({
  database,
  embeddingId,
  formatPlacement = "panel",
  toolsSlotId,
  entries,
  onReplaceDefinition,
  onPreviewDefinitionImpact,
  onOpenViewSettings,
  onCreateEntry,
  onCreateFolder,
  onOpenEntry,
  onUpdateEntry,
  relationOptions = [],
  queryPage,
  queryState,
  discoveryState,
  onRetryDiscovery,
  onQueryView,
  returnFocusEntryId,
  onReturnFocusRestored,
}: {
  readonly database: DatabaseDto;
  readonly embeddingId?: Uuid;
  /** The container page owns the format control, so this panel does not repeat it. */
  readonly formatPlacement?: "panel" | "chrome";
  /** When set, the filter trigger is placed in this already-mounted element. */
  readonly toolsSlotId?: string;
  readonly entries: readonly DatabaseEntryDto[];
  readonly onReplaceDefinition: (
    definition: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ) => void | Promise<void>;
  readonly onOpenViewSettings?: () => void;
  readonly onPreviewDefinitionImpact?: (
    definition: DatabaseDefinition,
  ) => DefinitionImpact | null | Promise<DefinitionImpact | null>;
  readonly onCreateEntry: (
    title: string,
    initialValues?: DatabaseEntryDto["values"],
    relationTargets?: RelationTargets,
    entryId?: Uuid,
  ) => void | Promise<void | Uuid>;
  readonly onCreateFolder?: (
    title: string,
    initialValues?: DatabaseEntryDto["values"],
    relationTargets?: RelationTargets,
    entryId?: Uuid,
  ) => void | Promise<void | Uuid>;
  readonly onOpenEntry: (entryId: Uuid, trigger?: HTMLElement | null) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly relationOptions?: readonly RelationOption[];
  readonly queryPage?: DatabaseViewPage | null;
  readonly queryState?: "loading" | "ready" | "invalid" | "degraded";
  /** Known local rows remain usable while workspace membership is still being discovered. */
  readonly discoveryState?: "loading" | "offline" | "error";
  readonly onRetryDiscovery?: () => void;
  readonly onQueryView?: (viewId: Uuid, cursor?: string) => Promise<DatabaseViewResult>;
  readonly returnFocusEntryId?: Uuid | null;
  readonly onReturnFocusRestored?: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const entryReturnAttempt = useRef<{
    entryId: Uuid;
    initialFocus: Element | null;
    lastFocusedTrigger: HTMLElement | null;
    attempts: number;
    completed: boolean;
  } | null>(null);
  const [editingProperty, setEditingProperty] = useState(false);
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [propertyCreatorAnchor, setPropertyCreatorAnchor] = useState<DOMRect | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setToolsSlot(toolsSlotId === undefined ? null : document.getElementById(toolsSlotId));
  }, [toolsSlotId]);
  const [propertyDraft, setPropertyDraft] = useState<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const propertyDraftRef = useRef<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const propertySubmissionInFlight = useRef(false);
  const [pendingDefinitionMutations, setPendingDefinitionMutations] = useState(0);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [renameEntryId, setRenameEntryId] = useState<Uuid | null>(null);
  const [pendingEntries, setPendingEntries] = useState<readonly PendingDatabaseEntry[]>([]);
  const pendingEntryIds = useRef<Set<Uuid>>(new Set());
  const pendingEntryUpdates = useRef<Map<Uuid, DatabaseCellUpdate[]>>(new Map());
  const [savingEntry, setSavingEntry] = useState(false);
  const entrySubmissionInFlight = useRef(false);
  const [pendingDefinition, setPendingDefinition] = useState<DatabaseDefinition | null>(null);
  const [impact, setImpact] = useState<DefinitionImpact | null>(null);
  const [loadedPage, setLoadedPage] = useState<DatabaseViewPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const pageGeneration = useRef(0);
  const [loadedState, setLoadedState] = useState<"loading" | "ready" | "invalid" | "degraded">(
    onQueryView === undefined ? "ready" : "loading",
  );

  // Contract schemas intentionally expose JSON strings, while the domain
  // brands UUIDs once validation has crossed the boundary. DatabaseDto has
  // already passed that contract validation, so the UI works on the branded
  // shape from here onward.
  const definition = database.definition as unknown as DatabaseDefinition;
  const impactRemovesProperty =
    pendingDefinition !== null &&
    definition.properties.some(
      (property) =>
        property.state === "active" &&
        pendingDefinition.properties.every(
          (candidate) => candidate.id !== property.id || candidate.state !== "active",
        ),
    );
  const replaceDefinition = async (
    next: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ): Promise<void> => {
    setPendingDefinitionMutations((current) => current + 1);
    setSchemaError(null);
    try {
      await onReplaceDefinition(next, confirmation);
    } catch (cause) {
      setSchemaError(
        cause instanceof Error ? cause.message : "La modification n’a pas pu être enregistrée.",
      );
    } finally {
      setPendingDefinitionMutations((current) => Math.max(0, current - 1));
    }
  };
  const activeProperties = definition.properties.filter((property) => property.state === "active");
  const viewContext = useDatabaseView(definition, embeddingId);
  const activeView =
    definition.views.find(
      ({ id, state }) => id === viewContext.context.activeViewId && state === "active",
    ) ?? definition.views.find(({ state }) => state === "active");
  const activeViewId = activeView?.id;
  const creationRows = useMemo<readonly DatabaseViewRow[]>(
    () =>
      entries.map((entry) => ({
        entryId: entry.entryId,
        revisionId: entry.revisionId,
        title: entry.title,
        values: entry.values,
        relationTargets: entry.relationTargets,
        groupId: null,
        syncState: "pending",
        itemKind: entry.kind === "folder" ? "folder" : "page",
        icon: entry.icon ?? null,
        holdsContent:
          entry.kind !== "folder" && pageBodyHoldsEditorialContent(entry.document?.body),
      })),
    [entries],
  );
  const entryRevisionKey = entries
    .map(({ entryId, revisionId }) => `${entryId}:${revisionId}`)
    .join("|");
  const galleryPreviews = useMemo(() => {
    const previews = new Map<Uuid, GalleryPreview>();
    for (const entry of entries) {
      if (entry.document === null) continue;
      const read = readDocumentBody(entry.document.body);
      if (read.kind !== "blocks" || !read.result.ok) continue;
      const text = extractSearchableDocumentText(read.result.document).trim();
      if (text !== "") {
        previews.set(entry.entryId as Uuid, {
          kind: "page",
          text: text.length > 180 ? `${text.slice(0, 177)}…` : text,
        });
      }
    }
    return previews;
  }, [entries]);
  const fallbackPage = useMemo<DatabaseViewPage | null>(() => {
    if (activeView === undefined) return null;
    const evaluated = evaluateDatabaseView(
      definition,
      activeView.id,
      entries.map((entry) => ({
        entryId: entry.entryId as Uuid,
        ...(entry.entryNumber === undefined ? {} : { entryNumber: entry.entryNumber }),
        ...(entry.createdAt === undefined ? {} : { createdAt: entry.createdAt }),
        ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
        title: entry.title,
        values: entry.values as never,
        relationTargets: entry.relationTargets as never,
      })),
    );
    if (!evaluated.ok) return null;
    const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
    const projected = presentDatabaseQuery({
      definition,
      view: activeView,
      entries: evaluated.value.rows.flatMap((row) => {
        const entry = byId.get(row.entryId);
        return entry === undefined ? [] : [{ ...row, revisionId: entry.revisionId as Uuid }];
      }),
      groups: evaluated.value.groups,
      includeGroups: true,
    });
    return {
      databaseId: database.databaseId,
      viewId: activeView.id,
      definitionRevisionId: database.definitionRevisionId,
      generation: 1,
      coverage: "complete",
      availableCount: entries.length,
      expectedCount: entries.length,
      rows: projected.rows.map((row) => ({ ...row, syncState: "synced" as const })),
      groups: projected.groups,
      nextCursor: null,
      source: "local",
      staleCursorRecovered: false,
    } as DatabaseViewPage;
  }, [activeView, database.databaseId, database.definitionRevisionId, definition, entries]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: definition and entry revisions invalidate a same-ID saved view's server result
  useEffect(() => {
    if (activeViewId === undefined || onQueryView === undefined) return;
    let cancelled = false;
    ++pageGeneration.current;
    setLoadingMore(false);
    setPageError(null);
    setLoadedState("loading");
    void onQueryView(activeViewId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setLoadedPage(result.value);
          setLoadedState("ready");
          return;
        }
        setLoadedState(
          result.problem.code === "database.invalid-view"
            ? "invalid"
            : result.problem.code.includes("projection")
              ? "degraded"
              : "ready",
        );
      })
      .catch(() => {
        if (!cancelled) setLoadedState("degraded");
      });
    return () => {
      cancelled = true;
      ++pageGeneration.current;
    };
  }, [activeViewId, database.definitionRevisionId, entryRevisionKey, onQueryView]);
  const effectiveQueryState = queryState ?? loadedState;
  const resolvedPage =
    queryPage !== undefined && queryPage !== null && queryPage.viewId === activeView?.id
      ? queryPage
      : effectiveQueryState === "ready" && loadedPage?.viewId === activeView?.id
        ? loadedPage
        : fallbackPage;
  const presentedPage = resolvedPage === null ? null : withEntryPresentation(resolvedPage, entries);
  const basePage =
    presentedPage === null || discoveryState === undefined
      ? presentedPage
      : { ...presentedPage, coverage: "partial" as const, groups: [] };
  const page = withPendingEntries(basePage, pendingEntries);
  useEffect(() => {
    if (pendingEntries.length === 0) return;
    const known = new Set(entries.map((entry) => entry.entryId));
    const remaining = pendingEntries.filter((entry) => !known.has(entry.entryId));
    if (remaining.length !== pendingEntries.length) setPendingEntries(remaining);
  }, [entries, pendingEntries]);
  const loadMore = useCallback(async (): Promise<void> => {
    if (
      loadingMore ||
      page?.nextCursor == null ||
      onQueryView === undefined ||
      activeViewId === undefined
    )
      return;
    const currentPage = page;
    const generation = pageGeneration.current;
    setLoadingMore(true);
    setPageError(null);
    try {
      const result = await onQueryView(activeViewId, currentPage.nextCursor ?? undefined);
      if (generation !== pageGeneration.current) return;
      if (!result.ok) {
        setPageError("Les entrées suivantes n'ont pas pu être chargées. Réessayez.");
        return;
      }
      const next = result.value;
      const compatible =
        !next.staleCursorRecovered &&
        next.viewId === currentPage.viewId &&
        next.definitionRevisionId === currentPage.definitionRevisionId &&
        next.generation === currentPage.generation;
      setLoadedPage(
        compatible
          ? {
              ...next,
              rows: [
                ...new Map(
                  [
                    ...currentPage.rows.filter(
                      (row) => !pendingEntries.some((pending) => pending.entryId === row.entryId),
                    ),
                    ...next.rows,
                  ].map((row) => [row.entryId, row]),
                ).values(),
              ],
            }
          : { ...next, staleCursorRecovered: true },
      );
      setLoadedState("ready");
    } catch {
      if (generation === pageGeneration.current)
        setPageError("Les entrées suivantes n'ont pas pu être chargées. Réessayez.");
    } finally {
      if (generation === pageGeneration.current) setLoadingMore(false);
    }
  }, [activeViewId, loadingMore, onQueryView, page, pendingEntries]);
  const returnEntryIsLoaded = page?.rows.some((row) => row.entryId === returnFocusEntryId) === true;
  const canRestoreEntryFocus =
    page !== null &&
    effectiveQueryState === "ready" &&
    (returnEntryIsLoaded || page.nextCursor === null);
  // Returning from a canonical entry may remount this display at page one.
  // Follow the saved view's cursors until its trigger is available again.
  useEffect(() => {
    if (
      returnFocusEntryId != null &&
      effectiveQueryState === "ready" &&
      !returnEntryIsLoaded &&
      page?.nextCursor != null &&
      pageError === null &&
      !loadingMore
    )
      void loadMore();
  }, [
    returnFocusEntryId,
    effectiveQueryState,
    returnEntryIsLoaded,
    page?.nextCursor,
    pageError,
    loadingMore,
    loadMore,
  ]);
  useEffect(() => {
    if (returnFocusEntryId == null) {
      entryReturnAttempt.current = null;
      return;
    }
    // A projection refresh can interrupt this effect after focus was restored.
    // Keep the same attempt so its successor still recognizes a new owner draft.
    if (entryReturnAttempt.current?.entryId !== returnFocusEntryId) {
      entryReturnAttempt.current = {
        entryId: returnFocusEntryId,
        initialFocus: document.activeElement,
        lastFocusedTrigger: null,
        attempts: 0,
        completed: false,
      };
    }
    const attempt = entryReturnAttempt.current;
    if (!canRestoreEntryFocus || attempt.completed) return;
    let frame: number | undefined;

    // Clear the saved selection now, never from a delayed callback that could
    // land after the owner has started another controlled-input draft.
    viewContext.finishEntryReturn();

    const complete = (): void => {
      if (attempt.completed) return;
      attempt.completed = true;
      onReturnFocusRestored?.();
    };

    const restore = (): void => {
      const savedColumn = viewContext.context.returnColumnId;
      const columnTrigger =
        savedColumn === undefined
          ? null
          : (sectionRef.current?.querySelector<HTMLElement>(
              `[data-board-column="${savedColumn}"] [data-entry-trigger="${returnFocusEntryId}"]`,
            ) ??
            sectionRef.current?.querySelector<HTMLElement>(
              `[data-board-column="${savedColumn}"] [data-board-create="page"]`,
            ));
      const trigger =
        columnTrigger ??
        sectionRef.current?.querySelector<HTMLElement>(
          `[data-entry-trigger="${returnFocusEntryId}"]`,
        );
      const activeElement = document.activeElement;
      const userMovedFocus =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== trigger &&
        activeElement !== attempt.lastFocusedTrigger &&
        activeElement !== attempt.initialFocus &&
        activeElement.isConnected;
      if (userMovedFocus) {
        complete();
        return;
      }

      // A local fallback, then the loaded view, can each render their own
      // trigger. Follow only those replacements; never steal focus once the
      // owner has moved to another connected control.
      if (trigger != null) {
        if (activeElement !== trigger) trigger.focus();
        // The table follows the workspace's vertical scroll in page flow.
        // WebKit can focus a virtual row while leaving the canvas scrolled
        // below the viewport. Center the returned trigger in both ancestors so
        // subpixel scroll rounding does not leave its bottom edge clipped.
        trigger.scrollIntoView({ block: "center", inline: "nearest" });
        attempt.lastFocusedTrigger = trigger;
      }
      attempt.attempts += 1;
      if (attempt.attempts < 20) {
        frame = requestAnimationFrame(restore);
      } else {
        complete();
      }
    };
    restore();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    canRestoreEntryFocus,
    onReturnFocusRestored,
    returnFocusEntryId,
    viewContext.finishEntryReturn,
    viewContext.context.returnColumnId,
  ]);

  const saveView = async (view: NonNullable<typeof activeView>): Promise<void> => {
    await replaceDefinition(replaceSavedView(definition, view));
  };
  const setColumnVisible = (propertyId: Uuid, visible: boolean): void => {
    if (activeView === undefined) return;
    const columns = viewColumns(definition.properties, activeView.properties).map((column) =>
      column.property.id === propertyId && column.property.type !== "title"
        ? { ...column, visible }
        : column,
    );
    void saveView({
      ...activeView,
      properties: columnPresentations(activeView.properties, columns),
    });
  };

  const sortProperty = (propertyId: Uuid, direction: "ascending" | "descending" | null): void => {
    if (activeView === undefined) return;
    const sorts = activeView.sorts.filter((sort) => sort.propertyId !== propertyId);
    void saveView({
      ...activeView,
      sorts:
        direction === null
          ? sorts
          : [...sorts, { propertyId, direction, missing: "last" as const }],
    });
  };

  const filterProperty = (propertyId: Uuid): void => {
    if (activeView === undefined) return;
    const active = activeView.filter.criteria.some(
      (criterion) => criterion.propertyId === propertyId && criterion.operator === "is-not-empty",
    );
    void saveView({
      ...activeView,
      filter: {
        ...activeView.filter,
        criteria: active
          ? activeView.filter.criteria.filter(
              (criterion) =>
                criterion.propertyId !== propertyId || criterion.operator !== "is-not-empty",
            )
          : [
              ...activeView.filter.criteria,
              { id: generateUuidV7(), propertyId, operator: "is-not-empty" as const },
            ],
      },
    });
  };

  const placeProperty = (
    property: DatabaseProperty,
    anchorId: Uuid,
    side: "before" | "after",
  ): void => {
    if (activeView === undefined) return;
    const columns = viewColumns(definition.properties, activeView.properties).filter(
      (column) => column.property.id !== property.id,
    );
    const index = columns.findIndex((column) => column.property.id === anchorId);
    const at = index < 0 ? columns.length : side === "before" ? Math.max(index, 1) : index + 1;
    const ordered = [...columns];
    ordered.splice(at, 0, { property, visible: true });
    const presentations = ordered.map((column, position) => {
      const previous = activeView.properties.find((item) => item.propertyId === column.property.id);
      const positionKey = `col-${String(position + 1).padStart(6, "0")}`;
      return {
        propertyId: column.property.id,
        visible: column.property.type === "title" ? true : column.visible,
        positionKey,
        ...(previous?.width === undefined ? {} : { width: previous.width }),
      };
    });
    const placed = presentations.find((item) => item.propertyId === property.id);
    const stored =
      placed === undefined ? property : { ...property, positionKey: placed.positionKey };
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: [...definition.properties, stored],
      views: definition.views.map((view) =>
        view.id === activeView.id
          ? ({ ...view, properties: presentations } as DatabaseView)
          : {
              ...view,
              properties: [
                ...view.properties,
                {
                  propertyId: stored.id,
                  visible: true,
                  positionKey: `z-${String(view.properties.length + 1).padStart(6, "0")}`,
                },
              ],
            },
      ),
    };
    void replaceDefinition(candidate);
  };

  const insertProperty = (anchorId: Uuid, side: "before" | "after"): void => {
    const names = new Set(definition.properties.map((property) => property.name));
    let name = "Texte";
    for (let index = 2; names.has(name); index += 1) name = `Texte ${index}`;
    const validated = validatePropertyDraft({ name, type: "text" });
    if (!validated.ok) return;
    placeProperty(propertyFromDraft(validated, "col-new"), anchorId, side);
  };

  const duplicateProperty = (propertyId: Uuid): void => {
    const source = definition.properties.find((property) => property.id === propertyId);
    if (source === undefined || source.type === "title") return;
    const id = generateUuidV7();
    const copy = {
      ...source,
      id,
      name: `${source.name} (copie)`,
      positionKey: `${source.positionKey}-copie`,
      ...(source.type === "status" || source.type === "select" || source.type === "multi-select"
        ? {
            config: {
              options: source.config.options.map((option) => ({ ...option, id: generateUuidV7() })),
            },
          }
        : {}),
    } as DatabaseProperty;
    placeProperty(copy, propertyId, "after");
  };

  const openDatabaseEntry = useContext(DatabaseEntryOpenContext);
  const openEntryFromView = (entryId: Uuid, trigger: HTMLElement | null): void => {
    viewContext.rememberTrigger(entryId, trigger);
    viewContext.openEntry(entryId);
    if (openDatabaseEntry === null) onOpenEntry(entryId, trigger);
    else
      openDatabaseEntry({
        entryId,
        trigger,
        ...(database.sourceId === undefined ? {} : { sourceId: database.sourceId as Uuid }),
      });
  };

  const addProperty = (submittedDraft: DatabasePropertyDraft): void => {
    if (propertySubmissionInFlight.current) return;
    // Preserve exactly what the form submitted when validation fails. The
    // final input event can be newer than this component's last committed
    // render on a constrained browser.
    propertyDraftRef.current = submittedDraft;
    setPropertyDraft(submittedDraft);
    const result = validatePropertyDraft(submittedDraft);
    if (!result.ok) {
      setPropertyError(result.error);
      return;
    }
    const property = propertyFromDraft(
      result,
      `property-${String(definition.properties.length).padStart(6, "0")}`,
    );
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: [...definition.properties, property],
      views: definition.views.map((view) => ({
        ...view,
        properties: [
          ...view.properties,
          { propertyId: property.id, visible: true, positionKey: property.positionKey },
        ],
      })),
    };
    const acceptedDraft = submittedDraft;
    // Commit the form state at submission time. A previous asynchronous save
    // must never close a newer editor that the owner has already opened.
    propertyDraftRef.current = EMPTY_PROPERTY_DRAFT;
    propertySubmissionInFlight.current = true;
    setPropertyDraft(EMPTY_PROPERTY_DRAFT);
    setPropertyError(null);
    setEditingProperty(false);
    setCreatingProperty(false);
    setSavingProperty(true);
    void replaceDefinition(candidate)
      .catch(() => {
        propertyDraftRef.current = acceptedDraft;
        setPropertyDraft(acceptedDraft);
        setPropertyError(DATABASE_COPY.page.propertySaveFailed);
        setEditingProperty(true);
      })
      .finally(() => {
        propertySubmissionInFlight.current = false;
        setSavingProperty(false);
      });
  };

  const retireProperty = async (propertyId: Uuid): Promise<void> => {
    const taskRoles =
      definition.taskRoles === null || definition.taskRoles.statusPropertyId === propertyId
        ? null
        : {
            ...definition.taskRoles,
            dueDatePropertyId:
              definition.taskRoles.dueDatePropertyId === propertyId
                ? null
                : definition.taskRoles.dueDatePropertyId,
            priorityPropertyId:
              definition.taskRoles.priorityPropertyId === propertyId
                ? null
                : definition.taskRoles.priorityPropertyId,
          };
    const candidate: DatabaseDefinition = {
      ...definition,
      taskRoles,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? { ...property, state: "retired" as const } : property,
      ),
      views: definition.views.map((view) => ({
        ...view,
        properties: view.properties.map((presentation) =>
          presentation.propertyId === propertyId
            ? { ...presentation, visible: false }
            : presentation,
        ),
      })),
    };
    let preview: DefinitionImpact | null | undefined;
    try {
      preview = await onPreviewDefinitionImpact?.(candidate);
    } catch (cause) {
      setSchemaError(
        cause instanceof Error
          ? cause.message
          : "L’impact de cette modification ne peut pas être vérifié.",
      );
      return;
    }
    if (preview?.destructive) {
      setPendingDefinition(candidate);
      setImpact(preview);
      return;
    }
    await replaceDefinition(candidate);
  };

  const changePropertyIcon = async (propertyId: Uuid, icon: string | null): Promise<void> => {
    const current = definition.properties.find((property) => property.id === propertyId);
    if (current === undefined) return;
    await replaceDefinition({
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? { ...property, icon } : property,
      ),
    });
  };

  const renameProperty = async (propertyId: Uuid, name: string): Promise<void> => {
    const current = definition.properties.find((property) => property.id === propertyId);
    if (current === undefined || current.name === name) return;
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? { ...property, name } : property,
      ),
    };
    await replaceDefinition(candidate);
  };

  const savePropertyOptions = async (
    propertyId: Uuid,
    options: readonly PropertyOption[],
  ): Promise<void> => {
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: replaceChoiceOptions(definition.properties, propertyId, options),
    };
    let preview: DefinitionImpact | null | undefined;
    try {
      preview = await onPreviewDefinitionImpact?.(candidate);
    } catch (cause) {
      setSchemaError(
        cause instanceof Error
          ? cause.message
          : "L’impact de cette modification ne peut pas être vérifié.",
      );
      return;
    }
    if (preview?.destructive) {
      setPendingDefinition(candidate);
      setImpact(preview);
      return;
    }
    await replaceDefinition(candidate);
  };

  const propertyCreationDefaults = (
    type: DatabasePropertyDraft["type"],
  ): Partial<DatabasePropertyDraft> => {
    const title = definition.properties.find(
      (property) => property.type === "title" && property.state === "active",
    );
    const relation = definition.properties.find(
      (property) => property.type === "relation" && property.state === "active",
    );
    return {
      ...(type === "formula"
        ? { expression: `prop(${JSON.stringify(title?.name ?? "Titre")})` }
        : {}),
      ...(type === "rollup" && relation !== undefined ? { relationPropertyId: relation.id } : {}),
    };
  };

  const addPropertyOfType = (type: DatabasePropertyDraft["type"]): void => {
    const label = DATABASE_COPY.property.typeLabels[type].replace(/^./, (c) => c.toUpperCase());
    const names = new Set(
      definition.properties
        .filter((property) => property.state === "active")
        .map((property) => property.name),
    );
    let name = label;
    for (let index = 2; names.has(name); index += 1) name = `${label} ${index}`;
    addProperty({
      name,
      type,
      ...propertyCreationDefaults(type),
      ...(type === "select" || type === "status" || type === "multi-select"
        ? { options: defaultSelectionOptions() }
        : {}),
    });
  };

  const changePropertyType = async (
    propertyId: Uuid,
    type: Exclude<DatabaseProperty["type"], "title">,
  ): Promise<void> => {
    const current = definition.properties.find((property) => property.id === propertyId);
    if (current === undefined || current.type === type || current.type === "title") return;
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? propertyWithType(property, type) : property,
      ),
    };
    let preview: DefinitionImpact | null | undefined;
    try {
      preview = await onPreviewDefinitionImpact?.(candidate);
    } catch (cause) {
      setSchemaError(
        cause instanceof Error
          ? cause.message
          : "L’impact de cette modification ne peut pas être vérifié.",
      );
      return;
    }
    if (preview?.destructive) {
      setPendingDefinition(candidate);
      setImpact(preview);
      return;
    }
    await replaceDefinition(candidate);
  };

  /** Buffer edits made on an optimistic row until its store write resolves. */
  const updateEntry = useCallback(
    (entryId: Uuid, update: DatabaseCellUpdate) => {
      if (pendingEntryIds.current.has(entryId)) {
        const queued = pendingEntryUpdates.current.get(entryId);
        if (queued === undefined) pendingEntryUpdates.current.set(entryId, [update]);
        else queued.push(update);
        return;
      }
      return onUpdateEntry?.(entryId, update);
    },
    [onUpdateEntry],
  );
  const createKind = async (kind: "page" | "folder"): Promise<void> => {
    // The ref closes the gap synchronously, before React has rendered
    // `disabled`, so one physical gesture can never create two entries.
    if (entrySubmissionInFlight.current) return;
    if (kind === "folder" && onCreateFolder === undefined) return;
    entrySubmissionInFlight.current = true;
    setEntryError(null);
    setSavingEntry(true);
    // The id is generated here so the optimistic row and the stored entry
    // share it: the row appears immediately, at the end, and is reconciled in
    // place instead of disappearing and reappearing.
    const entryId = generateUuidV7();
    const title = defaultItemTitle(kind);
    pendingEntryIds.current.add(entryId);
    setPendingEntries((current) => [
      ...current,
      { entryId, title, itemKind: kind, createdAt: new Date().toISOString() },
    ]);
    // Open the title on the optimistic row: the user can name the entry while
    // the store write settles. Its edits are queued on the row id.
    setRenameEntryId(entryId);
    try {
      const created =
        kind === "folder"
          ? await onCreateFolder?.(title, {}, {}, entryId)
          : await onCreateEntry(title, {}, {}, entryId);
      const resolved = typeof created === "string" ? created : entryId;
      if (resolved !== entryId) {
        pendingEntryIds.current.delete(entryId);
        pendingEntryIds.current.add(resolved);
        const queued = pendingEntryUpdates.current.get(entryId);
        if (queued !== undefined) {
          pendingEntryUpdates.current.set(resolved, queued);
          pendingEntryUpdates.current.delete(entryId);
        }
        setPendingEntries((current) =>
          current.map((entry) =>
            entry.entryId === entryId ? { ...entry, entryId: resolved } : entry,
          ),
        );
        setRenameEntryId((current) => (current === entryId ? resolved : current));
      }
      pendingEntryIds.current.delete(resolved);
      const queued = pendingEntryUpdates.current.get(resolved) ?? [];
      pendingEntryUpdates.current.delete(resolved);
      for (const update of queued) await onUpdateEntry?.(resolved, update);
    } catch {
      pendingEntryIds.current.delete(entryId);
      pendingEntryUpdates.current.delete(entryId);
      setPendingEntries((current) => current.filter((entry) => entry.entryId !== entryId));
      setRenameEntryId((current) => (current === entryId ? null : current));
      setEntryError(DATABASE_COPY.page.entryCreateFailed);
    } finally {
      entrySubmissionInFlight.current = false;
      setSavingEntry(false);
    }
  };
  const clearRename = useCallback(() => setRenameEntryId(null), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: createKind closes over the current definition and entry callbacks; re-subscribing on every render is not needed
  useEffect(() => {
    const onCreate = () => {
      if (onCreateEntry !== undefined) void createKind("page");
    };
    window.addEventListener("myownnotion:create-database-entry", onCreate);
    return () => window.removeEventListener("myownnotion:create-database-entry", onCreate);
  }, [onCreateEntry]);

  const compactTools = (
    <div className="database-tools">
      <PopoverRoot placement="bottom-end">
        <PopoverTrigger className="database-chrome-trigger" aria-label="Filtrer" title="Filtrer">
          <AppIcon name="filter" size="small" />
        </PopoverTrigger>
        <PopoverContent className="database-filter-popover">
          <PopoverHeading>Filtres</PopoverHeading>
          {activeView === undefined ? (
            <AsyncState compact kind="error" description={DATABASE_COPY.common.noUsableView} />
          ) : (
            <FilterEditor
              properties={definition.properties}
              view={activeView}
              onChange={saveView}
              defaultOpen
              live
            />
          )}
        </PopoverContent>
      </PopoverRoot>
      <PopoverRoot placement="bottom-end">
        <PopoverTrigger className="database-chrome-trigger" aria-label="Trier" title="Trier">
          <AppIcon name="sort" size="small" />
        </PopoverTrigger>
        <PopoverContent className="database-sort-popover">
          <PopoverHeading>Trier</PopoverHeading>
          {activeView === undefined ? (
            <AsyncState compact kind="error" description={DATABASE_COPY.common.noUsableView} />
          ) : (
            <SortGroupEditor
              properties={definition.properties}
              view={activeView}
              onChange={saveView}
              showGrouping={false}
              defaultOpen
              live
            />
          )}
        </PopoverContent>
      </PopoverRoot>
    </div>
  );

  return (
    <section
      ref={sectionRef}
      className="database-page"
      aria-labelledby={`database-heading-${embeddingId ?? database.databaseId}`}
      aria-busy={pendingDefinitionMutations > 0}
      data-definition-state={pendingDefinitionMutations > 0 ? "saving" : "idle"}
    >
      <header className="database-page__header">
        <div className="visually-hidden">
          <p className="muted">
            {embeddingId === undefined ? DATABASE_COPY.page.eyebrow : "Base de données"}
          </p>
          <h2 id={`database-heading-${embeddingId ?? database.databaseId}`}>
            {embeddingId === undefined ? DATABASE_COPY.page.contents : database.name}
          </h2>
        </div>
      </header>

      <div className="database-settings">
        {formatPlacement === "chrome" && toolsSlot === null ? compactTools : null}
        <PopoverRoot open={settingsOpen} setOpen={setSettingsOpen}>
          {(() => {
            const trigger = (
              <PopoverTrigger
                className="database-chrome-trigger"
                aria-label="Filtrer, trier et configurer"
                title="Filtrer, trier et configurer"
              >
                <AppIcon name="filter" size="small" />
              </PopoverTrigger>
            );
            if (formatPlacement === "chrome") return null;
            return toolsSlot === null ? trigger : createPortal(trigger, toolsSlot);
          })()}
          <PopoverContent className="database-settings-panel">
            <PopoverHeading>{DATABASE_COPY.page.display}</PopoverHeading>
            {activeView === undefined ? (
              <AsyncState compact kind="error" description={DATABASE_COPY.common.noUsableView} />
            ) : formatPlacement === "chrome" && embeddingId !== undefined ? null : (
              <DatabaseToolbar
                definition={definition}
                singleView={embeddingId !== undefined}
                activeViewId={activeView.id}
                onSelectView={viewContext.selectView}
                onChange={replaceDefinition}
              />
            )}
            {activeView === undefined ? null : (
              <div className="database-view-config">
                <FilterEditor
                  properties={definition.properties}
                  view={activeView}
                  onChange={saveView}
                />
                <SortGroupEditor
                  properties={definition.properties}
                  view={activeView}
                  onChange={saveView}
                  showGrouping={false}
                />
                <section className="database-panel-section" aria-label="Grouper">
                  <h3>Grouper</h3>
                  <GroupEditor
                    key={activeView.id}
                    properties={definition.properties}
                    view={activeView}
                    onChange={saveView}
                  />
                </section>
              </div>
            )}

            {activeView === undefined || embeddingId === undefined ? null : (
              <section
                className="database-panel-section"
                aria-labelledby="database-columns-heading"
              >
                <h3 id="database-columns-heading">{DATABASE_COPY.page.columns}</h3>
                <p className="muted">{DATABASE_COPY.page.columnsHint}</p>
                <ul className="database-column-list">
                  {viewColumns(definition.properties, activeView.properties).map((column) => (
                    <li key={column.property.id} className="database-column-row">
                      <span>
                        {column.property.name}
                        <span className="muted">
                          {DATABASE_COPY.property.typeLabels[column.property.type]}
                        </span>
                      </span>
                      <PropertyVisibilitySwitch
                        property={column.property}
                        visible={column.visible}
                        onToggle={setColumnVisible}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section
              className="database-schema database-panel-section"
              aria-labelledby={`database-schema-heading-${embeddingId ?? database.databaseId}`}
            >
              <div className="database-schema__heading">
                <h3 id={`database-schema-heading-${embeddingId ?? database.databaseId}`}>
                  {DATABASE_COPY.page.properties}
                </h3>
                {activeView?.type === "table" ? null : (
                  <Button
                    type="button"
                    size="compact"
                    variant="ghost"
                    disabled={savingProperty}
                    onClick={() => {
                      setPropertyError(null);
                      setEditingProperty(true);
                    }}
                  >
                    <AppIcon name="add" size="small" />
                    {DATABASE_COPY.page.addProperty}
                  </Button>
                )}
              </div>
              {editingProperty ? (
                <PropertyEditor
                  properties={definition.properties}
                  draft={propertyDraft}
                  error={propertyError}
                  onChange={(draft) => {
                    propertyDraftRef.current = draft;
                    setPropertyDraft(draft);
                    setPropertyError(null);
                  }}
                  onSubmit={addProperty}
                  onCancel={() => setEditingProperty(false)}
                  submitting={savingProperty}
                />
              ) : null}
              <ul>
                {activeProperties.map((property) => (
                  <li key={property.id} className="database-schema__property">
                    <div className="database-schema__summary">
                      <PropertyIconPicker
                        property={property}
                        onChange={(icon) => {
                          void replaceDefinition({
                            ...definition,
                            properties: definition.properties.map((p) =>
                              p.id === property.id ? { ...p, icon } : p,
                            ),
                          });
                        }}
                      />
                      <span>{property.name}</span>
                      <span className="muted">
                        {DATABASE_COPY.property.typeLabels[property.type]}
                      </span>
                      {property.type !== "title" ? (
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          onClick={() => void retireProperty(property.id)}
                        >
                          {DATABASE_COPY.common.remove}
                        </Button>
                      ) : null}
                    </div>
                    {isChoiceProperty(property) ? (
                      <PropertyOptionsEditor
                        options={property.config.options}
                        onChange={(options) => void savePropertyOptions(property.id, options)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <TaskConfiguration definition={definition} onChange={replaceDefinition} />
          </PopoverContent>
        </PopoverRoot>
      </div>

      {formatPlacement === "chrome" && toolsSlot !== null
        ? createPortal(compactTools, toolsSlot)
        : null}

      <PopoverRoot
        open={creatingProperty}
        setOpen={(open) => {
          if (!open) {
            setCreatingProperty(false);
            setEditingProperty(false);
          }
        }}
        placement="bottom-end"
      >
        <PopoverContent
          className="database-property-popover"
          aria-label="Nouvelle propriété"
          getAnchorRect={() => propertyCreatorAnchor}
        >
          <div className="database-property-type-heading">
            <span>Sélectionner le type</span>
            <AppIcon name="search" size="small" />
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: the grid is a visual type picker, not a form fieldset */}
          <div className="database-property-type-sections">
            {PROPERTY_TYPE_GROUPS.map((group) => (
              <section className="database-property-type-section" key={group.label}>
                <h3 className="database-property-type-section__label">{group.label}</h3>
                <div className="database-property-type-grid">
                  {group.types.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="database-property-type-grid__choice"
                      onClick={() => addPropertyOfType(type as DatabasePropertyDraft["type"])}
                    >
                      <DatabasePropertyIcon type={type} />
                      <span>{DATABASE_COPY.property.typeLabels[type]}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </PopoverContent>
      </PopoverRoot>

      {schemaError === null ? null : (
        <p className="database-field__error" role="alert">
          {schemaError}
        </p>
      )}
      <DialogRoot
        open={impact !== null && pendingDefinition !== null}
        setOpen={(open) => {
          if (!open) {
            setImpact(null);
            setPendingDefinition(null);
          }
        }}
      >
        <DialogContent
          className="database-impact-dialog"
          aria-label={DATABASE_COPY.page.confirmSchemaChange}
        >
          <DialogHeading>
            {impactRemovesProperty
              ? "Supprimer cette propriété ?"
              : DATABASE_COPY.page.schemaImpactHeading}
          </DialogHeading>
          <DialogDescription>
            {impact === null
              ? ""
              : impactRemovesProperty
                ? `${String(impact.affectedValueCount)} valeur(s) dans ${String(impact.affectedEntryCount)} entrée(s) seront supprimées de façon définitive.`
                : DATABASE_COPY.page.impact(impact.affectedValueCount, impact.affectedEntryCount)}
          </DialogDescription>
          <div className="database-impact-dialog__actions">
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => {
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              {DATABASE_COPY.common.cancel}
            </Button>
            {impactRemovesProperty ? null : (
              <Button
                type="button"
                size="compact"
                onClick={() => {
                  if (impact === null || pendingDefinition === null) return;
                  void replaceDefinition(pendingDefinition, {
                    digest: impact.impactDigest,
                    decision: "preserve-incompatible",
                  });
                  setImpact(null);
                  setPendingDefinition(null);
                }}
              >
                {DATABASE_COPY.common.preserveIncompatible}
              </Button>
            )}
            <Button
              type="button"
              size="compact"
              variant="danger"
              onClick={() => {
                if (impact === null || pendingDefinition === null) return;
                void replaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "discard-confirmed",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              {impactRemovesProperty
                ? "Supprimer la propriété"
                : DATABASE_COPY.common.discardAffected}
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>

      {activeView?.type === "board" || activeView?.type === "table" ? null : (
        <div className="database-entry-create">
          {/* biome-ignore lint/a11y/useSemanticElements: Action choices are a labelled button group, not form controls. */}
          <div className="database-entry-kind" role="group" aria-label="Type du nouvel élément">
            <Button
              type="button"
              size="compact"
              variant="ghost"
              aria-label="Nouvelle page"
              disabled={savingEntry}
              onClick={() => void createKind("page")}
            >
              <AppIcon name="fileAdd" size="small" />
              Page
            </Button>
            {onCreateFolder === undefined ? null : (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                aria-label="Nouveau dossier"
                disabled={savingEntry}
                onClick={() => void createKind("folder")}
              >
                <AppIcon name="folderAdd" size="small" />
                Dossier
              </Button>
            )}
          </div>
        </div>
      )}
      {entryError === null ? null : (
        <p className="database-field__error" role="alert">
          {entryError}
        </p>
      )}

      <div className="database-view-status" aria-live="polite">
        {discoveryState === undefined ? null : (
          <AsyncState
            compact
            testId="database-discovery-state"
            state={discoveryState}
            kind={discoveryState === "loading" ? "info" : discoveryState}
            description={
              discoveryState === "offline"
                ? "Données locales disponibles. Reconnectez-vous pour charger les autres entrées."
                : discoveryState === "error"
                  ? "Les entrées n’ont pas pu être actualisées. Les données locales restent disponibles."
                  : "Chargement des autres entrées… Les données locales restent disponibles."
            }
            action={
              discoveryState === "loading" || onRetryDiscovery === undefined ? undefined : (
                <Button size="compact" onClick={onRetryDiscovery}>
                  Réessayer
                </Button>
              )
            }
          />
        )}
        {effectiveQueryState === "loading" ? (
          <AsyncState compact kind="loading" description={DATABASE_COPY.page.loadingView} />
        ) : null}
        {effectiveQueryState === "invalid" ? (
          <AsyncState compact kind="error" description={DATABASE_COPY.page.invalidView} />
        ) : null}
        {effectiveQueryState === "degraded" ? (
          <AsyncState compact kind="offline" description={DATABASE_COPY.page.rebuildingView} />
        ) : null}
        {page?.staleCursorRecovered ? (
          <AsyncState compact kind="info" description={DATABASE_COPY.page.staleView} />
        ) : null}
        {pageError === null ? null : <AsyncState compact kind="error" description={pageError} />}
        {page === null ||
        effectiveQueryState === "loading" ||
        effectiveQueryState === "degraded" ||
        discoveryState !== undefined ||
        page.coverage === "complete" ? null : (
          <AsyncState
            compact
            kind="offline"
            description={DATABASE_COPY.page.partialResult(page.availableCount, page.expectedCount)}
          />
        )}
      </div>

      {page === null ||
      onQueryView === undefined ||
      (page.nextCursor === null && page.rows.length <= 100) ? null : (
        <section
          className="database-pagination"
          aria-label="Chargement des entrées"
          aria-busy={effectiveQueryState === "loading"}
        >
          <span role="status">
            {effectiveQueryState === "loading"
              ? "Actualisation des entrées…"
              : `${page.rows.length} ${page.rows.length === 1 ? "entrée chargée" : "entrées chargées"}`}
          </span>
          {page.nextCursor !== null && onQueryView !== undefined ? (
            <StableActionButton
              type="button"
              busy={loadingMore}
              disabled={effectiveQueryState !== "ready"}
              onActivate={() => {
                void loadMore();
              }}
            >
              Charger les entrées suivantes
            </StableActionButton>
          ) : null}
        </section>
      )}

      {activeView !== undefined &&
      (activeView.filter.criteria.length > 0 || activeView.sorts.length > 0) ? (
        <div className="database-active-chips">
          {activeView.filter.criteria.map((criterion) => {
            const property = definition.properties.find(
              (candidate) => candidate.id === criterion.propertyId,
            );
            return (
              <span key={criterion.id} className="database-active-chip">
                <span>
                  {property?.name ?? "Propriété"}{" "}
                  {DATABASE_COPY.filter.operatorLabels[criterion.operator]}
                </span>
                <button
                  type="button"
                  className="database-active-chip__remove"
                  aria-label={`${DATABASE_COPY.page.removeFilter} : ${property?.name ?? "Propriété"}`}
                  onClick={() => {
                    void saveView({
                      ...activeView,
                      filter: {
                        ...activeView.filter,
                        criteria: activeView.filter.criteria.filter(
                          (candidate) => candidate.id !== criterion.id,
                        ),
                      },
                    });
                  }}
                >
                  <AppIcon name="close" size="small" />
                </button>
              </span>
            );
          })}
          {activeView.sorts.map((sort) => {
            const property = definition.properties.find(
              (candidate) => candidate.id === sort.propertyId,
            );
            return (
              <span key={sort.propertyId} className="database-active-chip">
                <span>
                  {property?.name ?? "Propriété"} ·{" "}
                  {sort.direction === "ascending"
                    ? DATABASE_COPY.page.sortChipAscending
                    : DATABASE_COPY.page.sortChipDescending}
                </span>
                <button
                  type="button"
                  className="database-active-chip__remove"
                  aria-label={`${DATABASE_COPY.page.removeSort} : ${property?.name ?? "Propriété"}`}
                  onClick={() => {
                    void saveView({
                      ...activeView,
                      sorts: activeView.sorts.filter(
                        (candidate) => candidate.propertyId !== sort.propertyId,
                      ),
                    });
                  }}
                >
                  <AppIcon name="close" size="small" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {activeView !== undefined && page !== null ? (
        activeView.type === "list" ? (
          <ListView
            properties={definition.properties}
            view={activeView}
            page={page}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
            onOpenEntry={openEntryFromView}
          />
        ) : activeView.type === "table" ? (
          <TableView
            totalKnown={discoveryState === undefined}
            {...(returnFocusEntryId === undefined ? {} : { returnFocusEntryId })}
            renameEntryId={renameEntryId}
            onRenameStarted={clearRename}
            properties={definition.properties}
            view={activeView}
            page={page}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry: updateEntry })}
            relationOptions={relationOptions}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
            onOpenEntry={openEntryFromView}
            {...(onOpenViewSettings === undefined ? {} : { onOpenViewSettings })}
            onCreateProperty={({ name, type, icon }) => {
              const label = DATABASE_COPY.property.typeLabels[type].replace(/^./, (c) =>
                c.toUpperCase(),
              );
              const names = new Set(
                definition.properties
                  .filter((property) => property.state === "active")
                  .map((property) => property.name),
              );
              let propertyName = name;
              if (propertyName.length === 0) {
                propertyName = label;
                for (let index = 2; names.has(propertyName); index += 1)
                  propertyName = `${label} ${index}`;
              }
              addProperty({
                name: propertyName,
                type,
                icon,
                ...propertyCreationDefaults(type),
                ...(type === "select" || type === "status" || type === "multi-select"
                  ? { options: defaultSelectionOptions() }
                  : {}),
              });
            }}
            onAddProperty={(anchor) => {
              const rect = anchor.getBoundingClientRect();
              const width = Math.min(480, window.innerWidth - 24);
              const right = Math.min(Math.max(rect.right, width + 12), window.innerWidth - 12);
              setPropertyCreatorAnchor(
                DOMRect.fromRect({ x: right - 1, y: rect.bottom, width: 1, height: 1 }),
              );
              propertyDraftRef.current = EMPTY_PROPERTY_DRAFT;
              setPropertyDraft(EMPTY_PROPERTY_DRAFT);
              setPropertyError(null);
              setCreatingProperty(true);
            }}
            onCreateEntry={() => void createKind("page")}
            {...(onCreateFolder === undefined
              ? {}
              : { onCreateFolder: () => void createKind("folder") })}
            onRenameProperty={(propertyId, name) => void renameProperty(propertyId, name)}
            onRetireProperty={(propertyId) => void retireProperty(propertyId)}
            onChangePropertyOptions={(propertyId, options) =>
              void savePropertyOptions(propertyId, options)
            }
            onChangeProperty={(propertyId, edit) => {
              const properties = definition.properties.map((property) =>
                property.id === propertyId ? edit(property) : property,
              );
              void replaceDefinition({ ...definition, properties });
            }}
            onToggleColumn={setColumnVisible}
            onSortProperty={sortProperty}
            onFilterProperty={filterProperty}
            onChangePropertyType={(propertyId, type) => void changePropertyType(propertyId, type)}
            onChangePropertyIcon={(propertyId, icon) => void changePropertyIcon(propertyId, icon)}
            onInsertProperty={insertProperty}
            onDuplicateProperty={duplicateProperty}
            onResize={(propertyId, width) =>
              saveView({
                ...activeView,
                properties: activeView.properties.map((presentation) =>
                  presentation.propertyId === propertyId
                    ? { ...presentation, width }
                    : presentation,
                ),
              })
            }
          />
        ) : activeView.type === "board" ? (
          <BoardView
            creationRows={creationRows}
            onCreateInColumn={(kind, values, title, relations) =>
              kind === "folder"
                ? onCreateFolder?.(title, values, relations)
                : onCreateEntry(title, values, relations)
            }
            canCreateFolder={onCreateFolder !== undefined}
            relationOptions={relationOptions}
            properties={definition.properties}
            view={activeView}
            page={page}
            onOpenEntry={openEntryFromView}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry: updateEntry })}
            onChangeView={saveView}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
          />
        ) : activeView.type === "gallery" ? (
          <GalleryView
            {...(returnFocusEntryId === undefined ? {} : { returnFocusEntryId })}
            properties={definition.properties}
            view={activeView}
            page={page}
            previews={galleryPreviews}
            onOpenEntry={openEntryFromView}
            onChangeView={saveView}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
          />
        ) : activeView.type === "map" ? (
          <MapView
            properties={definition.properties}
            view={activeView}
            page={page}
            onOpenEntry={openEntryFromView}
            onChangeView={saveView}
          />
        ) : (
          <CalendarView
            properties={definition.properties}
            view={activeView}
            page={page}
            onOpenEntry={openEntryFromView}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry: updateEntry })}
            onChangeView={saveView}
          />
        )
      ) : null}
    </section>
  );
}
