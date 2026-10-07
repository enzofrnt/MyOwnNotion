/**
 * Accessible offline-first hierarchy explorer (T033 US1 + T045/T046 US6).
 *
 * Reads come from the durable local projection; every mutation is applied
 * optimistically with a durable outbox entry and then synchronized. The
 * tree is a semantic ARIA tree with complete keyboard operation, and
 * loading, empty, offline, error, and conflict states are explicit.
 */

import {
  closeTab,
  DEFAULT_SIDEBAR_WIDTH,
  GRAPH_TAB_ID,
  isGraphTabId,
  META_KEYS,
  neighbourTab,
  normalizeWorkspacePresentationState,
  openTab,
  type PageScrollAnchor,
  type ProjectedItem,
  pruneTabs,
  readNavigationState,
  rememberScrollAnchor,
  reorderTabs,
  scrollAnchorFor,
  updateWorkspacePresentationState,
  type WorkspacePresentationState,
} from "@myownnotion/client-core";
import type {
  DatabaseDto,
  DatabaseEntryDto,
  ReplaceDefinitionRequestDto,
  ReplaceEntryValuesRequestDto,
} from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  databaseEmbeddings,
  generateUuidV7,
  isSafeErrorCode,
  isUuid,
  jsonValuesEqual,
  linkedDatabasePageName,
  type SafeError,
  type Uuid,
} from "@myownnotion/domain";
import type { GraphScope } from "@myownnotion/graph";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { notePath } from "../../routing/paths.ts";
import { DatabaseViewService } from "../../services/databases.ts";
import {
  type LocalContentService,
  type LocalProjectionChange,
  localContent,
} from "../../services/local-content.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { WorkspaceSearchService } from "../../services/search.ts";
import { FR_COPY } from "../../ui/copy/index.ts";
import { ItemEmojiDialog } from "../../ui/emoji-picker.tsx";
import { AppIcon } from "../../ui/icons.tsx";
import { TreeItemIdentitySlot } from "../../ui/item-icon.tsx";
import { AsyncState, Button, ConfirmDialog } from "../../ui/primitives/index.ts";
import { AttachmentPanel } from "../attachments/attachment-panel.tsx";
import { pageAttachmentsByPage } from "../attachments/page-attachments.ts";
import { DatabaseConflictResolution } from "../databases/database-conflict-resolution.tsx";
import { DatabaseContainerPage } from "../databases/database-container-page.tsx";
import { DATABASE_COPY } from "../databases/database-copy.ts";
import { DatabaseCreateChoiceDialog } from "../databases/database-create-choice.tsx";
import type { DatabaseEntryOpenRequest } from "../databases/database-entry-open-context.tsx";
import { DatabaseEntryPeek } from "../databases/database-entry-peek.tsx";
import { DatabasePage, type DefinitionConfirmation } from "../databases/database-page.tsx";
import {
  editEntrySourceDefinition,
  saveEntryPropertyChanges,
} from "../databases/edit-entry-properties.ts";
import { type EntryDrafts, EntryPanel } from "../databases/entry-panel.tsx";
import { PageDatabases } from "../databases/page-databases.tsx";
import type { DatabaseCellUpdate } from "../databases/table-view.tsx";
import { updatedCellProperties } from "../databases/update-database-cell.ts";
import { initializeEditorFileTransfers } from "../editor/editor-file-state.tsx";
import type { CreateSubpageRequest } from "../editor/editor-menus/slash-menu.tsx";
import { KnowledgeGraphView } from "../knowledge-graph/knowledge-graph-view.tsx";
import { BranchState } from "../navigation/branch-state.tsx";
import { CollapsibleRegion } from "../navigation/collapsible-region.tsx";
import { ConvertItemControl, type ConvertibleKind } from "../navigation/convert-item.tsx";
import { NavigationInlineCreate } from "../navigation/navigation-inline-create.tsx";
import { NavigationItemMenu } from "../navigation/navigation-item-menu.tsx";
import { Sidebar, type SidebarShortcutPreferences } from "../navigation/sidebar.tsx";
import { TreeAttachmentDisclosure } from "../navigation/tree-attachment-disclosure.tsx";
import {
  TreeDragDropProvider,
  type TreeDragItem,
  type TreeDropIntent,
  TreeDropTarget,
} from "../navigation/tree-drag-drop.tsx";
import {
  applyTreeRowPointerAction,
  createFolderClickScheduler,
  handleFolderRowPointerClick,
  resolveTreeRowPointerAction,
} from "../navigation/tree-row-pointer.ts";
import { useTreeKeyboard } from "../navigation/use-tree-keyboard.ts";
import { isSearchShortcut, SearchDialog } from "../search/search-dialog.tsx";
import type { SearchBranchOption } from "../search/search-filters.tsx";
import { useChangeStream } from "../sync/use-change-stream.ts";
import { useRealtimeSync } from "../sync/use-realtime-sync.ts";
import { defaultItemTitle } from "../workspace/default-item-title.ts";
import { FolderChildrenList, FolderInlineCreate } from "../workspace/folder-children-list.tsx";
import { OpenTabsStrip, openTabsForItems } from "../workspace/open-tabs-strip.tsx";
import { PageContentSkeleton } from "../workspace/page-content-skeleton.tsx";
import { PageHeader } from "../workspace/page-header.tsx";
import { PageTitleEditor } from "../workspace/page-title-editor.tsx";
import { PathBreadcrumbs } from "../workspace/path-breadcrumbs.tsx";
import { useActiveItem } from "../workspace/use-active-item.ts";
import { WorkspacePageEditor } from "../workspace/workspace-page-editor.tsx";
import { WorkspaceShell } from "../workspace/workspace-shell.tsx";
import { WorkspaceState } from "../workspace/workspace-state.tsx";
import { FileNode } from "./file-node.tsx";
import { pageHoldsTreeContent, replaceProjectedItems } from "./navigation-item-signature.ts";
import {
  holdsStructuredCanvas,
  nextWarmedPageIds,
  type StructuredHostKind,
  visibleWarmedPageIds,
} from "./page-canvas-selection.ts";

import { resolveLocalPageLinkTarget } from "./page-link-target.ts";

type LoadState = "loading" | "ready" | "error";
type LoadPhase = "initializing" | "reading-local" | "seeding" | "navigation" | "refreshing";

function sameItemIds(left: ReadonlySet<Uuid>, right: ReadonlySet<Uuid>): boolean {
  return left.size === right.size && [...left].every((itemId) => right.has(itemId));
}

interface TreeNode {
  readonly item: ProjectedItem;
  readonly placementId: Uuid;
  readonly positionKey: string;
  readonly children: TreeNode[];
}

interface TrashConfirmation {
  readonly node: TreeNode;
  readonly description: string;
  readonly returnToMobileNavigation: boolean;
}

interface TitleDraftSession {
  readonly itemId: Uuid;
  readonly draft: string;
  readonly focused: boolean;
}

export type RoutedItemState =
  | "none"
  | "active"
  | "trashed"
  | "loading"
  | "unavailable-local"
  | "not-found";
export type GraphMode =
  | { readonly kind: "global" }
  | { readonly kind: "local"; readonly centerId: Uuid };

export function resolveInitialRoutedItemId(
  routeItemId: Uuid | null,
  lastVisitedItemId: string | null,
  items: readonly ProjectedItem[],
  projectionComplete = true,
): Uuid | null {
  if (routeItemId !== null) return routeItemId;
  return lastVisitedItemId !== null &&
    isUuid(lastVisitedItemId) &&
    (!projectionComplete ||
      items.some((item) => item.id === lastVisitedItemId && item.lifecycle === "active"))
    ? lastVisitedItemId
    : null;
}

export function resolveRoutedItemState(
  items: readonly ProjectedItem[],
  trashedItems: readonly ProjectedItem[],
  routeItemId: Uuid | null,
  online: boolean,
  projectionComplete = true,
): RoutedItemState {
  if (routeItemId === null) return "none";
  if (items.some((item) => item.id === routeItemId && item.lifecycle === "active")) return "active";
  if (trashedItems.some((item) => item.id === routeItemId)) return "trashed";
  return online ? (projectionComplete ? "not-found" : "loading") : "unavailable-local";
}

/** Native containers own their entry projection; the legacy base still needs it here. */
export async function readParentDatabaseEntries(
  service: Pick<
    LocalContentService,
    "listDatabaseEntries" | "getItem" | "getDatabaseEntryRelationTargets"
  >,
  selectedItem: Pick<ProjectedItem, "id" | "kind">,
): Promise<DatabaseEntryDto[]> {
  if (selectedItem.kind === "database" || selectedItem.kind === "database_view") return [];
  const rows = await service.listDatabaseEntries(selectedItem.id);
  const entries = await Promise.all(
    rows.map(async (row): Promise<DatabaseEntryDto | null> => {
      const [item, relationTargets] = await Promise.all([
        service.getItem(row.entryItemId),
        service.getDatabaseEntryRelationTargets(selectedItem.id, row.entryItemId),
      ]);
      return item === null
        ? null
        : ({
            databaseId: selectedItem.id,
            entryId: row.entryItemId,
            kind: item.kind,
            icon: item.icon ?? null,
            revisionId: item.currentRevisionId,
            lifecycle: item.lifecycle,
            title: item.name,
            document: item.pageDocument,
            values: row.values.values,
            relationTargets,
          } as unknown as DatabaseEntryDto);
    }),
  );
  return entries.filter((entry): entry is DatabaseEntryDto => entry !== null);
}

function buildTree(items: ProjectedItem[]): TreeNode[] {
  const entriesByParent = new Map<
    string,
    Array<{ item: ProjectedItem; placementId: Uuid; positionKey: string }>
  >();
  for (const item of items) {
    for (const placement of item.placements) {
      if (placement.kind !== "hierarchy") {
        continue;
      }
      const key = placement.parentItemId ?? "root";
      const list = entriesByParent.get(key) ?? [];
      list.push({ item, placementId: placement.id, positionKey: placement.positionKey });
      entriesByParent.set(key, list);
    }
  }
  const build = (parentKey: string, guard: Set<string>): TreeNode[] => {
    const entries = (entriesByParent.get(parentKey) ?? []).sort((a, b) =>
      a.positionKey < b.positionKey ? -1 : a.positionKey > b.positionKey ? 1 : 0,
    );
    return entries.flatMap((entry) => {
      if (guard.has(entry.item.id)) {
        return [];
      }
      const nextGuard = new Set(guard);
      nextGuard.add(entry.item.id);
      return [
        {
          item: entry.item,
          placementId: entry.placementId,
          positionKey: entry.positionKey,
          children: build(entry.item.id, nextGuard),
        },
      ];
    });
  };
  return build("root", new Set());
}

/**
 * Whether a row is a branch, and so carries a disclosure and `aria-expanded`.
 *
 * A folder always is, whether or not anything is in it yet: a folder exists in
 * order to contain, and an empty one is the case that most needs an explanation
 * rather than blank space — FR-015's four states are unreachable for a branch
 * that cannot be opened.
 *
 * A page or a file is a branch only when it actually has children. This is the
 * narrower reading, and it is the one `contracts/ui-semantics.md` specifies:
 * `aria-expanded="false"` on a row that will never open announces a branch that
 * does not exist, which is worse than saying nothing. A page *can* hold
 * children, so the temptation is to treat it like a folder; the difference is
 * that an empty page is a document the owner is reading, not a container they
 * are looking into.
 */
function isBranch(node: TreeNode, projectionComplete = true): boolean {
  return (
    node.item.kind === "folder" ||
    node.children.length > 0 ||
    (!projectionComplete && node.item.kind !== "file")
  );
}

export interface ExpandableTreeItem {
  readonly id: string;
  readonly kind: ProjectedItem["kind"];
  readonly childCount: number;
}

/** Removes stale open-page IDs while retaining folders, which remain containers when empty. */
export function retainExpandableItemIds(
  expanded: ReadonlySet<string>,
  items: readonly ExpandableTreeItem[],
): ReadonlySet<string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const retained = [...expanded].filter((id) => {
    const item = byId.get(id);
    // A temporarily absent item may be restored from trash or a partial local
    // projection. Only a page known to be present and childless loses its open
    // state; folders stay expandable even when empty.
    return item === undefined || item.kind === "folder" || item.childCount > 0;
  });
  if (retained.length === expanded.size) return expanded;
  return new Set(retained);
}

/**
 * The rows an owner can currently see, in the order they appear.
 *
 * Keyboard movement walks this list rather than the tree, because "the next
 * item" means the next *visible* one — stepping into a collapsed branch would
 * move focus somewhere invisible.
 */
function flatten(nodes: TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  return nodes.flatMap((node) =>
    expanded.has(node.item.id) ? [node, ...flatten(node.children, expanded)] : [node],
  );
}

function flattenAll(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenAll(node.children)]);
}

function treeDragItems(nodes: readonly TreeNode[]): TreeDragItem[] {
  return nodes.flatMap((node, siblingIndex) => {
    const parentId =
      node.item.placements.find((entry) => entry.kind === "hierarchy")?.parentItemId ?? null;
    return [
      {
        id: node.item.id,
        name: node.item.name,
        parentId,
        siblingIndex,
        canContainChildren: node.item.kind !== "file",
        kind: node.item.kind,
        icon: node.item.icon,
      },
      ...treeDragItems(node.children),
    ];
  });
}

function searchBranchOptions(
  nodes: readonly TreeNode[],
  ancestors: readonly string[] = [],
): SearchBranchOption[] {
  return nodes.flatMap((node) => {
    const path = [...ancestors, node.item.name];
    return [
      { itemId: node.item.id, label: path.join(" / ") },
      ...searchBranchOptions(node.children, path),
    ];
  });
}

export interface HierarchyExplorerProps {
  /** False while the retained workspace is hidden behind a settings destination. */
  readonly active: boolean;
  readonly backupStale: boolean;
  readonly selectedItemId: Uuid | null;
  readonly graphMode: GraphMode | null;
  readonly pageOperationCsrfToken: () => string | null;
  readonly onActiveItemChange: (item: ProjectedItem | null) => void;
  readonly onOpenBackups: () => void;
  readonly onOpenDiagnostics: () => void;
  /** Settings live outside the workspace, so the shortcut asks rather than routes. */
  readonly onOpenSettings: () => void;
  readonly onOpenItem: (itemId: Uuid | null, options?: { readonly replace?: boolean }) => void;
  readonly onOpenGraph: (itemId: Uuid | null, options?: { readonly replace?: boolean }) => void;
  readonly onProblemChange: (problem: SafeError | null) => void;
  readonly onTrashedItemsChange: (items: readonly ProjectedItem[]) => void;
}

export function HierarchyExplorer({
  active,
  backupStale,
  selectedItemId,
  graphMode,
  pageOperationCsrfToken,
  onActiveItemChange,
  onOpenBackups,
  onOpenDiagnostics,
  onOpenSettings,
  onOpenItem,
  onOpenGraph,
  onProblemChange,
  onTrashedItemsChange,
}: HierarchyExplorerProps) {
  const service = useMemo(() => {
    const content = localContent();
    content.configurePageOperationAuthorization(pageOperationCsrfToken);
    return content;
  }, [pageOperationCsrfToken]);
  useRealtimeSync(service);
  const changeStream = useChangeStream(service);
  // Completeness belongs to the catalogue rendered here. A transport can
  // finish before its final IndexedDB read/decryption has reached React.
  const [projectionComplete, setProjectionComplete] = useState(false);
  const projectionCompleteRef = useRef(false);
  const syncState = useSyncExternalStore(
    service.subscribe,
    () => service.getSnapshot().syncState,
    () => service.getSnapshot().syncState,
  );
  const projectionLoadFailed = useSyncExternalStore(
    service.subscribe,
    () => service.getSnapshot().projectionLoadFailed,
    () => service.getSnapshot().projectionLoadFailed,
  );
  const discoveryState = projectionLoadFailed
    ? "error"
    : syncState === "offline"
      ? "offline"
      : "loading";
  const databaseViews = useMemo(() => new DatabaseViewService(service), [service]);
  const [search, setSearch] = useState<WorkspaceSearchService | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const graphModeRef = useRef(graphMode);
  graphModeRef.current = graphMode;
  const [items, setItems] = useState<ProjectedItem[]>([]);
  const [trashedItems, setTrashedItems] = useState<ProjectedItem[]>([]);
  const [databaseSourceIds, setDatabaseSourceIds] = useState<ReadonlySet<Uuid>>(new Set());
  const itemsRef = useRef<ProjectedItem[]>([]);
  const trashedItemsRef = useRef<ProjectedItem[]>([]);
  itemsRef.current = items;
  trashedItemsRef.current = trashedItems;
  const [projectionRevision, setProjectionRevision] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("initializing");
  const [problem, setProblem] = useState<SafeError | null>(null);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const selectedId = selectedItemId;
  // A passive effect can still be finishing the previous database read after
  // the owner has opened an entry. The synchronous generation makes that old
  // result stale immediately, before React gets a chance to run its cleanup;
  // otherwise a sync notification can remount the form and erase typed drafts.
  const selectedIdRef = useRef<Uuid | null>(selectedItemId);
  const selectionGeneration = useRef(0);
  if (selectedIdRef.current !== selectedItemId) {
    selectedIdRef.current = selectedItemId;
    selectionGeneration.current += 1;
  }
  const selectItemById = useCallback(
    (itemId: Uuid | null, options?: { readonly replace?: boolean }): void => {
      // The graph route keeps the last page id in selection state. Re-activating
      // that tab must still leave `/graph`, not no-op here.
      if (selectedIdRef.current === itemId && graphModeRef.current === null) return;
      selectedIdRef.current = itemId;
      selectionGeneration.current += 1;
      onOpenItem(itemId, options);
    },
    [onOpenItem],
  );
  /** Device-local scroll anchors, kept beside the rest of the ergonomics. */
  const presentationRef = useRef<WorkspacePresentationState | null>(null);
  const onCaptureScrollAnchor = useCallback(
    (itemId: Uuid, anchor: PageScrollAnchor) => {
      // The ref is updated synchronously: returning to the page can render
      // before the Dexie commit resolves, and a stale ref would open the page
      // at the top as if the owner had never been there.
      const base = presentationRef.current ?? normalizeWorkspacePresentationState(undefined);
      presentationRef.current = rememberScrollAnchor(base, itemId, anchor);
      void updateWorkspacePresentationState(service.db, (current) =>
        rememberScrollAnchor(current, itemId, anchor),
      );
    },
    [service],
  );
  const refreshGeneration = useRef(0);
  const pendingProjectionItemIds = useRef(new Set<Uuid>());
  const refreshMounted = useRef(false);
  useEffect(() => {
    refreshMounted.current = true;
    return () => {
      refreshMounted.current = false;
      refreshGeneration.current += 1;
    };
  }, []);
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseDto | null>(null);
  const [databaseEntries, setDatabaseEntries] = useState<readonly DatabaseEntryDto[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<
    (DatabaseEntryDto & { readonly valuesAvailable?: boolean; readonly sourceId?: Uuid }) | null
  >(null);
  const selectedDatabaseRef = useRef<DatabaseDto | null>(null);
  const selectedEntryRef = useRef<DatabaseEntryDto | null>(null);
  selectedDatabaseRef.current = selectedDatabase;
  selectedEntryRef.current = selectedEntry;
  const [entryDefinition, setEntryDefinition] = useState<DatabaseDefinition | null>(null);
  const [titleDraftSession, setTitleDraftSession] = useState<TitleDraftSession | null>(null);
  // React state carries the draft across ordinary renders. The matching ref is
  // updated in the input event itself, so a concurrent classification render
  // cannot remount the title from the previous (usually blank) state before
  // React has committed the state update. This matters on WebKit, where a
  // newly-created page can finish opening between a fill and the next key.
  const titleDraftSessionRef = useRef<TitleDraftSession | null>(null);
  const replaceTitleDraftSession = useCallback((next: TitleDraftSession | null): void => {
    titleDraftSessionRef.current = next;
    setTitleDraftSession(next);
  }, []);
  // Retain each entry independently without rerendering the entire tree on
  // every property keystroke. Late acknowledgements cannot clear another entry.
  const entryDraftSessions = useRef(new Map<Uuid, EntryDrafts>());
  const [structuredSelectionLoading, setStructuredSelectionLoading] = useState(false);
  const structuredSelectionItemId = useRef<Uuid | null>(null);
  const structuredKindByItemId = useRef(new Map<string, StructuredHostKind>());
  const [warmedPageIds, setWarmedPageIds] = useState<readonly string[]>([]);
  const definitionMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const titleMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const optimisticDatabaseDefinition = useRef<{
    readonly databaseId: Uuid;
    readonly definition: DatabaseDefinition;
  } | null>(null);
  const [entryReturnFocusId, setEntryReturnFocusId] = useState<Uuid | null>(null);
  const databaseEntryOrigin = useRef<{ entryId: Uuid; containerItemId: Uuid } | null>(null);
  const linkedEntryOrigin = useRef<{
    hostPageId: Uuid;
    embeddingId: Uuid;
    entryId: Uuid;
    returning: boolean;
  } | null>(null);
  const remotelyOpenedEntry = useRef<{
    readonly entry: DatabaseEntryDto;
    readonly definition: DatabaseDefinition;
  } | null>(null);
  // Which branches are open. Everything was permanently expanded before US3,
  // which is workable at ten items and unusable at a hundred.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Guards the persistence effect below. Without it that effect can fire before
  // the stored state has been read and write the empty set back, erasing every
  // open branch on the way in.
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [rootCreationOpen, setRootCreationOpen] = useState(false);
  const [inlineCreationItemId, setInlineCreationItemId] = useState<Uuid | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  // Open hierarchy items shown as tabs, in strip order. Device ergonomics like
  // the sidebar width: hydrated and persisted with the rest of the
  // presentation state, never synchronized (spec 022, FR-016/FR-017).
  const [openTabIds, setOpenTabIds] = useState<readonly string[]>([]);
  const [shortcutPreferences, setShortcutPreferences] = useState<SidebarShortcutPreferences>({
    favouritesVisible: true,
    favouritesExpanded: true,
    recentsVisible: true,
    recentsExpanded: true,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [iconPickerItemId, setIconPickerItemId] = useState<Uuid | null>(null);
  const [trashConfirmation, setTrashConfirmation] = useState<TrashConfirmation | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [databaseCreate, setDatabaseCreate] = useState<{
    parentItemId: Uuid | null;
    returnToMobileNavigation: boolean;
  } | null>(null);
  const [databaseCreateMode, setDatabaseCreateMode] = useState<"choose" | "existing">("choose");
  const [databaseSourceOptions, setDatabaseSourceOptions] = useState<
    readonly { id: Uuid; name: string }[]
  >([]);
  const [databaseSourceId, setDatabaseSourceId] = useState("");
  const [databaseCreateBusy, setDatabaseCreateBusy] = useState(false);
  const [databaseCreateError, setDatabaseCreateError] = useState<string | null>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const lastGraphCenter = useRef<Uuid | null>(null);

  useEffect(() => {
    // Routine backup reminders stay as one compact affordance. A failed owner
    // action opens itself because that is the one case that must interrupt.
    if (problem !== null) setNoticesOpen(true);
  }, [problem]);

  const openSearch = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      searchReturnFocus.current = document.activeElement;
    }
    // Search is a workspace-level modal. Keeping the mobile navigation modal
    // open underneath it leaves two focus traps competing for the keyboard.
    // Mount search on the following frame so the drawer has fully released its
    // focus trap before search sends focus to the query field.
    if (mobileNavigationOpen) {
      setMobileNavigationOpen(false);
      requestAnimationFrame(() => setSearchOpen(true));
      return;
    }
    setSearchOpen(true);
  }, [mobileNavigationOpen]);

  const closeSearch = useCallback(() => {
    const previous = searchReturnFocus.current;
    // Ariakit restores focus after the dialog closes. Give it the current
    // trigger before unmounting, including when a resize replaced the opener.
    if (
      window.innerWidth < 768 ||
      previous?.isConnected !== true ||
      previous.getClientRects().length === 0 ||
      previous.closest(".workspace-sidebar-drawer") !== null
    ) {
      searchReturnFocus.current = document.querySelector<HTMLElement>(
        '[data-testid="toggle-sidebar"]',
      );
    }
    setSearchOpen(false);
  }, []);

  const openItem = useCallback(
    (itemId: Uuid) => {
      selectItemById(itemId);
      setMobileNavigationOpen(false);
    },
    [selectItemById],
  );

  const focusWorkspaceMain = useCallback(() => {
    document.getElementById("workspace-main")?.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isSearchShortcut(event) && !searchOpen) {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, openSearch, searchOpen]);

  useEffect(() => {
    if (active) return;
    setSearchOpen(false);
    setMobileNavigationOpen(false);
  }, [active]);

  useEffect(() => {
    const nextSearch = new WorkspaceSearchService(service);
    setSearch(nextSearch);
    return () => {
      void nextSearch.dispose();
    };
  }, [service]);

  useEffect(() => () => databaseViews.dispose(), [databaseViews]);

  const refresh = useCallback(
    async (change?: LocalProjectionChange): Promise<ProjectedItem[]> => {
      const generation = ++refreshGeneration.current;
      if (change?.kind === "upsert") {
        for (const itemId of change.itemIds) pendingProjectionItemIds.current.add(itemId);
      }
      // Read the boundary first: a read started while discovery was partial
      // must not prune navigation just because the final commit overtook it.
      const readComplete =
        (await service.repository.getMeta<boolean>(META_KEYS.projectionComplete)) === true;
      if (change?.kind === "upsert" && itemsRef.current.length > 0) {
        // A superseded read leaves its identities pending. The newest refresh
        // includes them too, so overlapping notifications cannot lose one batch.
        const itemIds = [...pendingProjectionItemIds.current];
        const [projectedItems, sourceKeys] = await Promise.all([
          service.getItems(itemIds),
          service.db.databases.toCollection().primaryKeys(),
        ]);
        const sourceIds = new Set(sourceKeys);
        const {
          items: nextItems,
          trashed: nextTrash,
          catalogChanged,
        } = replaceProjectedItems(
          itemsRef.current,
          trashedItemsRef.current,
          itemIds,
          projectedItems,
          sourceIds,
        );
        if (refreshMounted.current && generation === refreshGeneration.current) {
          pendingProjectionItemIds.current.clear();
          projectionCompleteRef.current = readComplete;
          setProjectionComplete(readComplete);
          setDatabaseSourceIds((current) =>
            sameItemIds(current, sourceIds) ? current : sourceIds,
          );
          if (catalogChanged) {
            itemsRef.current = nextItems;
            trashedItemsRef.current = nextTrash;
            setItems(nextItems);
            setTrashedItems(nextTrash);
          }
          if (
            catalogChanged ||
            selectedDatabaseRef.current !== null ||
            selectedEntryRef.current !== null
          ) {
            setProjectionRevision((current) => current + 1);
          }
        }
        return nextItems;
      }
      const [activeItems, trash, sourceKeys] = await Promise.all([
        service.listActiveItems(),
        service.listTrashedItems(),
        service.db.databases.toCollection().primaryKeys(),
      ]);
      // Local writes and synchronization can notify almost simultaneously. An
      // older IndexedDB read must never replace the projection produced by a
      // newer refresh: doing so can briefly remove the selected entry and
      // remount its form, discarding an unsaved property draft.
      if (refreshMounted.current && generation === refreshGeneration.current) {
        pendingProjectionItemIds.current.clear();
        projectionCompleteRef.current = readComplete;
        setProjectionComplete(readComplete);
        itemsRef.current = activeItems;
        trashedItemsRef.current = trash;
        setItems(activeItems);
        setTrashedItems(trash);
        const sourceIds = new Set(sourceKeys);
        setDatabaseSourceIds((current) => (sameItemIds(current, sourceIds) ? current : sourceIds));
        // Structured values can hydrate after the item row without changing the
        // item's visible metadata. Give an already-open database entry the same
        // accepted projection signal so it re-reads those late values.
        setProjectionRevision((current) => current + 1);
      }
      return activeItems;
    },
    [service],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadPhase("initializing");
      await service.initialize();
      await initializeEditorFileTransfers(service);
      // initialize makes local/root data available; catch-up continues without
      // holding navigation behind the workspace's complete download.
      setLoadPhase("reading-local");
      // Which branches were open is device ergonomics, not content: it lives
      // in the local projection and never syncs. Restoring it is what makes
      // returning to the workspace feel like returning (FR-014).
      setLoadPhase("navigation");
      const navigation = await readNavigationState(service.db);
      if (cancelled) {
        return;
      }
      setExpanded(new Set(navigation.expandedItemIds));
      // Opening `/graph` must not re-run this effect (graphMode is read from a
      // ref). Hydration still restores IndexedDB tabs, then re-inserts the
      // graph tab so a late read cannot wipe FR-049.
      setOpenTabIds(
        graphModeRef.current === null
          ? navigation.openTabIds
          : openTab(navigation.openTabIds, GRAPH_TAB_ID),
      );
      setSidebarOpen(navigation.sidebarOpen);
      setSidebarWidth(navigation.sidebarWidth);
      setShortcutPreferences({
        favouritesVisible: navigation.favouritesVisible,
        favouritesExpanded: navigation.favouritesExpanded,
        recentsVisible: navigation.recentsVisible,
        recentsExpanded: navigation.recentsExpanded,
      });
      presentationRef.current = navigation;
      setNavigationLoaded(true);
      setLoadPhase("refreshing");
      await refresh();
      if (!cancelled) {
        const initialItemId = resolveInitialRoutedItemId(
          selectedIdRef.current,
          navigation.lastVisitedItemId,
          itemsRef.current,
          projectionCompleteRef.current,
        );
        if (
          activeRef.current &&
          graphModeRef.current === null &&
          selectedIdRef.current === null &&
          initialItemId !== null
        ) {
          selectItemById(initialItemId, { replace: true });
        }
        // Subscription notifications can refresh the projection while the
        // service initializes. The workspace must not become interactive until
        // navigation hydration has also completed, or that late hydration can
        // collapse a branch the owner has just opened.
        setLoadState("ready");
      }
    })().catch(() => {
      if (!cancelled) setLoadState("error");
    });
    const unsubscribeProjection = service.subscribeProjection(async (change) => {
      await refresh(change).catch(() => {
        if (!cancelled) setLoadState("error");
      });
    });
    return () => {
      cancelled = true;
      unsubscribeProjection();
    };
  }, [service, refresh, selectItemById]);

  useEffect(() => {
    if (!active || !navigationLoaded) return;
    let cancelled = false;
    void readNavigationState(service.db).then((navigation) => {
      if (cancelled) return;
      presentationRef.current = navigation;
      setShortcutPreferences({
        favouritesVisible: navigation.favouritesVisible,
        favouritesExpanded: navigation.favouritesExpanded,
        recentsVisible: navigation.recentsVisible,
        recentsExpanded: navigation.recentsExpanded,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, navigationLoaded, service]);

  useEffect(() => {
    // Written on change rather than on unload: a tab closed abruptly never
    // reaches an unload handler, and losing the tree state that way is exactly
    // the case worth surviving.
    if (!navigationLoaded) {
      return;
    }
    // Settings keeps this explorer mounted but inactive. A late projection or
    // selection change can still reach this effect while the settings screen
    // is writing shortcut visibility into the same IndexedDB record. Preserve
    // those fields while inactive so this retained workspace cannot overwrite
    // the owner's acknowledged switch choice with its stale React snapshot.
    const workspaceActive = activeRef.current;
    void (async () => {
      const next = await updateWorkspacePresentationState(service.db, (current) => ({
        ...current,
        sidebarOpen,
        sidebarWidth,
        ...(workspaceActive ? shortcutPreferences : {}),
        expandedItemIds: [...expanded],
        openTabIds: [...openTabIds],
        lastVisitedItemId: selectedId,
      }));
      presentationRef.current = next;
    })();
  }, [
    service,
    expanded,
    openTabIds,
    selectedId,
    navigationLoaded,
    shortcutPreferences,
    sidebarOpen,
    sidebarWidth,
  ]);

  const tree = useMemo(() => buildTree(items), [items]);
  const searchBranches = useMemo(() => searchBranchOptions(tree), [tree]);
  const searchItemIcons = useMemo(
    () => new Map(items.map((item) => [item.id, item.icon] as const)),
    [items],
  );
  const visibleNodes = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const allNodes = useMemo(() => flattenAll(tree), [tree]);
  const draggableTreeItems = useMemo(() => treeDragItems(tree), [tree]);
  const attachmentsByPage = useMemo(() => pageAttachmentsByPage(items), [items]);
  const { item: selectedItem, path: activePath } = useActiveItem(items, selectedId);
  const [entryPeek, setEntryPeek] = useState<DatabaseEntryOpenRequest | null>(null);
  const openDatabasePeek = useCallback(
    (request: DatabaseEntryOpenRequest) => setEntryPeek(request),
    [],
  );
  const closeDatabasePeek = useCallback(() => {
    const origin = entryPeek;
    setEntryPeek(null);
    requestAnimationFrame(() => {
      const trigger = origin?.trigger?.isConnected
        ? origin.trigger
        : origin === null
          ? null
          : document.querySelector<HTMLElement>(
              `.workspace-main [data-entry-trigger="${origin.entryId}"]`,
            );
      trigger?.focus({ preventScroll: true });
    });
  }, [entryPeek]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation ends the independent peek session.
  useEffect(() => {
    setEntryPeek(null);
  }, [selectedId, graphMode]);
  const routedItemState = resolveRoutedItemState(
    items,
    trashedItems,
    selectedId,
    syncState !== "offline" && navigator.onLine,
    projectionComplete,
  );
  const iconPickerItem = useMemo(() => {
    if (iconPickerItemId === null) return null;
    const item = items.find((candidate) => candidate.id === iconPickerItemId);
    if (item === undefined || (item.kind !== "page" && item.kind !== "folder")) return null;
    return { kind: item.kind, icon: item.icon, name: item.name, id: item.id };
  }, [iconPickerItemId, items]);

  useEffect(() => {
    // State schedules the projection check; the ref supplies the newest draft
    // if another input arrived before this effect was allowed to run.
    if (titleDraftSession === null || titleDraftSession.focused) return;
    const current = titleDraftSessionRef.current;
    if (current === null || current.focused) return;
    const projectedTitle = items.find((item) => item.id === current.itemId)?.name;
    if (projectedTitle !== current.draft) return;
    // A successful mutation can resolve one render before its refreshed item
    // projection reaches the canvas. Keep the route-bound draft through that
    // gap, then release it only once the durable title is actually visible.
    replaceTitleDraftSession(null);
  }, [items, replaceTitleDraftSession, titleDraftSession]);

  useEffect(() => {
    if (loadState !== "ready" || !projectionComplete) return;
    const expandableItems = allNodes.map((node) => ({
      id: node.item.id,
      kind: node.item.kind,
      childCount: node.children.length,
    }));
    setExpanded((current) => retainExpandableItemIds(current, expandableItems));
  }, [allNodes, loadState, projectionComplete]);

  // Opening a page, folder, database or linked view adds its tab. Opening the
  // graph adds its own tab. An already-open tab simply becomes active.
  useEffect(() => {
    if (selectedItem === null || selectedItem.kind === "file") return;
    setOpenTabIds((current) => openTab(current, selectedItem.id));
  }, [selectedItem]);

  useEffect(() => {
    if (graphMode === null || !navigationLoaded) return;
    lastGraphCenter.current = graphMode.kind === "local" ? graphMode.centerId : null;
    setOpenTabIds((current) => openTab(current, GRAPH_TAB_ID));
  }, [graphMode, navigationLoaded]);

  // A trashed or deleted item leaves the strip. When it was the active tab the
  // neighbour takes over, so the owner is not left on a dead route.
  useEffect(() => {
    if (loadState !== "ready" || !projectionComplete) return;
    const openable = new Set<string>(
      items.filter((item) => item.kind !== "file").map((item) => item.id),
    );
    const pruned = pruneTabs(openTabIds, openable);
    if (pruned.length === openTabIds.length) return;
    if (
      selectedId !== null &&
      openTabIds.includes(selectedId) &&
      !openable.has(selectedId) &&
      trashedItems.some((item) => item.id === selectedId)
    ) {
      // Neighbours are looked up among the tabs that survive, with the closing
      // tab kept in place so "next, else previous" is measured from it.
      const survivors = openTabIds.filter(
        (id) => isGraphTabId(id) || openable.has(id) || id === selectedId,
      );
      const neighbour = neighbourTab(survivors, selectedId);
      if (neighbour !== null && isGraphTabId(neighbour)) {
        onOpenGraph(lastGraphCenter.current, { replace: true });
      } else {
        selectItemById(neighbour as Uuid | null, { replace: true });
      }
    }
    setOpenTabIds(pruned);
  }, [
    items,
    loadState,
    onOpenGraph,
    openTabIds,
    projectionComplete,
    selectedId,
    selectItemById,
    trashedItems,
  ]);

  const closeOpenTab = useCallback(
    (itemId: string) => {
      const activeTabId = graphMode !== null ? GRAPH_TAB_ID : selectedId;
      if (itemId === activeTabId) {
        const neighbour = neighbourTab(openTabIds, itemId);
        if (neighbour !== null && isGraphTabId(neighbour)) {
          onOpenGraph(lastGraphCenter.current);
        } else {
          selectItemById(neighbour as Uuid | null);
        }
      }
      setOpenTabIds((current) => closeTab(current, itemId));
    },
    [graphMode, onOpenGraph, openTabIds, selectItemById, selectedId],
  );

  const openTabs = useMemo(() => openTabsForItems(openTabIds, items), [items, openTabIds]);

  const pathCrumbs = useMemo(
    () =>
      activePath.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        icon: item.icon,
      })),
    [activePath],
  );

  const folderChildren = useMemo(() => {
    if (selectedItem === null || selectedItem.kind !== "folder") return [];
    const node = allNodes.find((candidate) => candidate.item.id === selectedItem.id);
    return (node?.children ?? []).map((child) => ({
      id: child.item.id,
      href: notePath(child.item.id),
      name: child.item.name,
      kind: databaseSourceIds.has(child.item.id) ? ("database" as const) : child.item.kind,
      icon: child.item.icon,
      childCount: projectionComplete ? child.children.length : null,
    }));
  }, [allNodes, databaseSourceIds, projectionComplete, selectedItem]);

  useEffect(() => {
    onActiveItemChange(selectedItem);
  }, [onActiveItemChange, selectedItem]);

  useEffect(() => {
    onTrashedItemsChange(trashedItems);
  }, [onTrashedItemsChange, trashedItems]);

  useEffect(() => {
    onProblemChange(problem);
  }, [onProblemChange, problem]);

  useEffect(() => {
    // This revision is a signal: its value is irrelevant, but every accepted
    // projection must re-run the structured read below.
    void projectionRevision;
    let cancelled = false;
    const selection = selectionGeneration.current;
    const selectionChanged = (): boolean => cancelled || selection !== selectionGeneration.current;
    const clearStructuredSelection = (): void => {
      setSelectedDatabase(null);
      setDatabaseEntries([]);
      setSelectedEntry(null);
      setEntryDefinition(null);
    };
    // A route navigation records its target synchronously, while the
    // controlled selectedItemId prop reaches this render on the next router
    // update. Never start (or restart) structured reads for the page that is
    // already being left: that stale read can otherwise claim the shared
    // discriminator ref and replace the destination form after its first
    // input event.
    if (selectedItem !== null && selectedItem.id !== selectedIdRef.current) return;
    if (
      selectedItem === null ||
      (selectedItem.kind !== "page" &&
        selectedItem.kind !== "folder" &&
        selectedItem.kind !== "database" &&
        selectedItem.kind !== "database_view")
    ) {
      clearStructuredSelection();
      structuredSelectionItemId.current = null;
      setStructuredSelectionLoading(false);
      return;
    }

    const cachedKind = structuredKindByItemId.current.get(selectedItem.id);
    if (structuredSelectionItemId.current !== selectedItem.id) {
      // Ordinary notes must not wait on this discriminator. Known bases and
      // entries still hold the previous canvas until their projection is ready.
      if (cachedKind === "database" || cachedKind === "entry") {
        setStructuredSelectionLoading(true);
      }
    }
    const restoreRemotelyOpenedEntry = (itemId: Uuid): boolean => {
      const remoteEntry = remotelyOpenedEntry.current;
      if (remoteEntry?.entry.entryId !== itemId) return false;
      setSelectedDatabase(null);
      setDatabaseEntries([]);
      setSelectedEntry(remoteEntry.entry);
      setEntryDefinition(remoteEntry.definition);
      structuredKindByItemId.current.set(itemId, "entry");
      structuredSelectionItemId.current = itemId;
      setStructuredSelectionLoading(false);
      return true;
    };
    void (async () => {
      const kind =
        selectedItem.kind === "database" || selectedItem.kind === "database_view"
          ? "database"
          : await service.classifyStructuredItem(selectedItem.id);
      if (selectionChanged()) return;
      structuredKindByItemId.current.set(selectedItem.id, kind);
      if (kind === "page") {
        if (restoreRemotelyOpenedEntry(selectedItem.id)) return;
        clearStructuredSelection();
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }

      if (kind === "database") {
        const databaseRow = await service.getDatabase(selectedItem.id);
        if (selectionChanged()) return;
        if (databaseRow === null) {
          if (!projectionComplete) {
            clearStructuredSelection();
            setStructuredSelectionLoading(true);
            return;
          }
          structuredKindByItemId.current.set(selectedItem.id, "page");
          clearStructuredSelection();
          structuredSelectionItemId.current = selectedItem.id;
          setStructuredSelectionLoading(false);
          return;
        }
        const entries = await readParentDatabaseEntries(service, selectedItem);
        if (selectionChanged()) return;
        const optimistic =
          optimisticDatabaseDefinition.current?.databaseId === selectedItem.id
            ? optimisticDatabaseDefinition.current.definition
            : null;
        setSelectedDatabase({
          databaseId: selectedItem.id,
          definitionRevisionId: selectedItem.currentRevisionId,
          lifecycle: selectedItem.lifecycle,
          name: selectedItem.name,
          definition: optimistic ?? databaseRow.definition,
        } as unknown as DatabaseDto);
        setDatabaseEntries(entries);
        setSelectedEntry(null);
        setEntryDefinition(null);
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }

      const entryRow = await service.getDatabaseEntry(selectedItem.id);
      if (entryRow === null) {
        // Items, database definitions and memberships are installed in one
        // local snapshot/change transaction. A page absent from both local
        // structured stores is therefore an ordinary page, not a reason to
        // probe `/v1/databases/:pageId`. That old discriminator produced one
        // expected 404 on every tree refresh and amplified sync failures into
        // dozens of meaningless requests.
        if (restoreRemotelyOpenedEntry(selectedItem.id)) return;
        structuredKindByItemId.current.set(selectedItem.id, "page");
        clearStructuredSelection();
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }
      const [ownerDatabase, relationTargets] = await Promise.all([
        service.getDatabase(entryRow.sourceId ?? entryRow.databaseId),
        service.getDatabaseEntryRelationTargets(entryRow.databaseId, selectedItem.id),
      ]);
      if (selectionChanged()) return;
      if (ownerDatabase === null) {
        structuredKindByItemId.current.set(selectedItem.id, "page");
        clearStructuredSelection();
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }
      setSelectedDatabase(null);
      setDatabaseEntries([]);
      setSelectedEntry({
        databaseId: entryRow.databaseId,
        ...(entryRow.sourceId === undefined ? {} : { sourceId: entryRow.sourceId }),
        valuesAvailable: entryRow.availability === "present",
        entryId: selectedItem.id,
        kind: selectedItem.kind,
        icon: selectedItem.icon ?? null,
        revisionId: selectedItem.currentRevisionId,
        lifecycle: selectedItem.lifecycle,
        title: selectedItem.name,
        document: selectedItem.pageDocument,
        values: entryRow.values.values,
        relationTargets,
      } as unknown as DatabaseEntryDto);
      setEntryDefinition(ownerDatabase.definition);
      structuredKindByItemId.current.set(selectedItem.id, "entry");
      structuredSelectionItemId.current = selectedItem.id;
      setStructuredSelectionLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectionComplete, projectionRevision, service, selectedItem]);

  const selectedStructuredKind =
    selectedItem === null ? undefined : structuredKindByItemId.current.get(selectedItem.id);
  const showSelectedDatabase =
    selectedItem !== null &&
    selectedDatabase !== null &&
    selectedDatabase.databaseId === selectedItem.id;
  const showSelectedEntry =
    selectedItem !== null &&
    selectedEntry !== null &&
    selectedEntry.entryId === selectedItem.id &&
    entryDefinition !== null;
  const holdStructuredCanvasBody =
    selectedItem !== null &&
    (holdsStructuredCanvas({
      selectedItemId: selectedItem.id,
      cachedKind: selectedStructuredKind,
      selectedDatabaseId: selectedDatabase?.databaseId ?? null,
      selectedEntryId: selectedEntry?.entryId ?? null,
    }) ||
      (structuredSelectionLoading &&
        (selectedStructuredKind === "database" || selectedStructuredKind === "entry")));
  const pageEditorSessionIds =
    selectedItem === null || selectedItem.kind !== "page"
      ? warmedPageIds
      : visibleWarmedPageIds(
          warmedPageIds,
          showSelectedDatabase || showSelectedEntry || holdStructuredCanvasBody
            ? null
            : selectedItem.id,
          showSelectedDatabase || showSelectedEntry || holdStructuredCanvasBody
            ? "database"
            : selectedStructuredKind,
        );

  useLayoutEffect(() => {
    const retain = new Set<string>(openTabIds);
    if (selectedItem !== null) retain.add(selectedItem.id);
    setWarmedPageIds((current) =>
      nextWarmedPageIds(
        current,
        selectedItem === null ||
          selectedItem.kind !== "page" ||
          showSelectedDatabase ||
          showSelectedEntry
          ? null
          : selectedItem.id,
        retain,
        showSelectedDatabase || showSelectedEntry ? "database" : selectedStructuredKind,
      ),
    );
  }, [openTabIds, selectedItem, selectedStructuredKind, showSelectedDatabase, showSelectedEntry]);

  const openPageLink = useCallback(
    async (rawItemId: string) => {
      setProblem(null);
      const generation = selectionGeneration.current;
      // Creation is durable before its React tree projection necessarily
      // renders. Resolve the local record, rather than rejecting the new child
      // against the click handler's older items array.
      const target = await resolveLocalPageLinkTarget(rawItemId, (id) => service.getItem(id));
      if (!refreshMounted.current || generation !== selectionGeneration.current) return;
      if (target.ok) selectItemById(target.itemId);
      else setProblem(target.error);
    },
    [selectItemById, service],
  );

  const selectedDatabaseId = selectedDatabase?.databaseId as Uuid | undefined;
  const querySelectedDatabaseView = useCallback(
    async (viewId: Uuid, cursor?: string) => {
      if (selectedDatabaseId === undefined) {
        return {
          ok: false as const,
          problem: {
            type: "https://myownnotion.dev/problems/database.not-found",
            title: DATABASE_COPY.hierarchy.notAvailable,
            status: 404,
            code: "database.not-found",
          },
        };
      }
      return await databaseViews.query(selectedDatabaseId, {
        viewId,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
    },
    [databaseViews, selectedDatabaseId],
  );

  const updateSelectedDatabaseEntry = useCallback(
    async (entryId: Uuid, update: DatabaseCellUpdate): Promise<void> => {
      const databaseId = selectedDatabaseId;
      if (databaseId === undefined) throw new Error(DATABASE_COPY.hierarchy.notAvailable);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const currentItem = await service.getItem(entryId);
        if (currentItem === null) throw new Error(DATABASE_COPY.hierarchy.entryNotAvailable);
        if (update.kind === "title") {
          const result = await service.mutate(
            "item.rename",
            { itemId: entryId, name: update.title },
            [currentItem.currentRevisionId],
          );
          if (result.ok) {
            await refresh();
            return;
          }
          if (result.error.code === "revision.stale-base") continue;
          setProblem(result.error);
          throw new Error(result.error.title);
        }

        const currentEntry = await service.getDatabaseEntry(entryId);
        const currentRelations = await service.getDatabaseEntryRelationTargets(databaseId, entryId);
        if (currentEntry === null || currentEntry.databaseId !== databaseId) {
          throw new Error(DATABASE_COPY.hierarchy.valuesNotAvailable);
        }
        const result = await service.replaceDatabaseEntryValues(databaseId, entryId, {
          baseRevisionId: currentItem.currentRevisionId,
          ...updatedCellProperties(currentEntry.values.values, currentRelations, update),
        } as unknown as ReplaceEntryValuesRequestDto);
        if (result.ok) {
          await refresh();
          return;
        }
        if (result.error.code === "revision.stale-base") continue;
        setProblem(result.error);
        throw new Error(result.error.title);
      }
      const error: SafeError = {
        code: "revision.stale-base",
        title: DATABASE_COPY.hierarchy.entryCellChanged,
      };
      setProblem(error);
      throw new Error(error.title);
    },
    [refresh, selectedDatabaseId, service],
  );

  const openSelectedDatabaseEntry = useCallback(
    (entryId: Uuid, _trigger?: HTMLElement | null) => {
      const database = selectedDatabase;
      if (database === null) return;
      databaseEntryOrigin.current = { entryId, containerItemId: database.databaseId as Uuid };
      const visibleEntry = databaseEntries.find((entry) => entry.entryId === entryId);
      if (visibleEntry !== undefined) {
        const definition = database.definition as unknown as DatabaseDefinition;
        // The row the owner clicked is already a durable local projection. Open
        // it synchronously instead of blocking navigation on another IndexedDB
        // read, which can wait behind synchronization on a constrained device.
        // The structured-selection effect still refreshes it in the background.
        remotelyOpenedEntry.current = { entry: visibleEntry, definition };
        setSelectedEntry(visibleEntry);
        setEntryDefinition(definition);
        structuredSelectionItemId.current = entryId;
        selectItemById(entryId);
        return;
      }
      void (async () => {
        if ((await service.getDatabaseEntry(entryId)) === null) {
          const remote = await service.api.getDatabaseEntry(database.databaseId as Uuid, entryId);
          if (remote.ok) {
            remotelyOpenedEntry.current = {
              entry: remote.value,
              definition: database.definition as unknown as DatabaseDefinition,
            };
          }
        }
        selectItemById(entryId);
      })();
    },
    [databaseEntries, selectItemById, selectedDatabase, service],
  );
  const clearEntryReturnFocus = useCallback(() => setEntryReturnFocusId(null), []);

  const runCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown>, baseRevisionIds: Uuid[] = []) => {
      setProblem(null);
      const result = await service.mutate(commandType, payload, baseRevisionIds);
      if (!result.ok) {
        setProblem(result.error);
      }
      await refresh();
      return result.ok;
    },
    [service, refresh],
  );

  const renameSelectedItem = useCallback(
    (itemId: Uuid, name: string): Promise<void> => {
      const operation = async (): Promise<void> => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const current = await service.getItem(itemId);
          if (current === null) throw new Error("Cet élément n’est plus disponible.");
          if (current.name === name) return;
          const result = await service.mutate("item.rename", { itemId, name }, [
            current.currentRevisionId,
          ]);
          if (result.ok) {
            if (current.kind === "database" || current.kind === "database_view") {
              const container = await service.getDatabase(itemId);
              const activeSourceIds = [
                ...new Set(
                  (container?.presentation?.views ?? [])
                    .filter((view) => view.state === "active")
                    .map((view) => view.sourceId),
                ),
              ];
              if (activeSourceIds.length === 1) {
                const source = (await service.listDatabases()).find(
                  (row) => row.sourceId === activeSourceIds[0] && row.itemId === itemId,
                );
                if (
                  source?.sourceId !== undefined &&
                  source.definitionRevisionId !== undefined &&
                  source.definition.name !== name
                ) {
                  await service.mutate(
                    "database.definition.replace",
                    {
                      databaseId: itemId,
                      sourceId: source.sourceId,
                      baseRevisionId: source.definitionRevisionId,
                      definition: { ...source.definition, name },
                    },
                    [source.definitionRevisionId],
                  );
                }
              }
            }
            await refresh();
            return;
          }
          if (result.error.code === "revision.stale-base") continue;
          setProblem(result.error);
          throw new Error(result.error.title);
        }
        const error: SafeError = {
          code: "revision.stale-base",
          title: "Le titre a changé sur un autre appareil. Votre saisie est conservée.",
        };
        setProblem(error);
        throw new Error(error.title);
      };
      const queued = titleMutationQueue.current.then(operation, operation);
      titleMutationQueue.current = queued.catch(() => undefined);
      return queued;
    },
    [refresh, service],
  );

  const titleEditingProps = useCallback(
    (
      itemId: Uuid,
      durableTitle: string,
      kind: "page" | "folder" | "database" | "database_view" = "page",
    ) => ({
      ...(titleDraftSessionRef.current?.itemId === itemId
        ? {
            initialDraft: titleDraftSessionRef.current.draft,
            restoreFocus: titleDraftSessionRef.current.focused,
          }
        : {}),
      onDraftStateChange: (draft: string, focused: boolean) => {
        const projectedTitle = durableTitle || defaultItemTitle(kind);
        const current = titleDraftSessionRef.current;
        replaceTitleDraftSession(
          focused || draft !== projectedTitle
            ? { itemId, draft, focused }
            : current?.itemId === itemId
              ? null
              : current,
        );
      },
      onCommit: async (name: string) => {
        await renameSelectedItem(itemId, name);
      },
    }),
    [renameSelectedItem, replaceTitleDraftSession],
  );

  const changeItemIcon = useCallback(
    async (itemId: Uuid, icon: string | null): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await service.getItem(itemId);
        if (current === null) throw new Error("Cet élément n’est plus disponible.");
        if (current.kind === "file") throw new Error("Un fichier ne peut pas recevoir d’icône.");
        if (current.icon === icon) return;
        const result = await service.mutate("item.icon", { itemId, icon }, [
          current.currentRevisionId,
        ]);
        if (result.ok) {
          await refresh();
          return;
        }
        if (result.error.code === "revision.stale-base") continue;
        setProblem(result.error);
        throw new Error(result.error.title);
      }
      const error: SafeError = {
        code: "revision.stale-base",
        title: "L’icône a changé sur un autre appareil. Réessayez.",
      };
      setProblem(error);
      throw new Error(error.title);
    },
    [refresh, service],
  );

  const siblingKeys = useCallback(
    (parentItemId: Uuid | null): string[] =>
      visibleNodes
        .filter((node) => {
          const placement = node.item.placements.find((entry) => entry.kind === "hierarchy");
          return (placement?.parentItemId ?? null) === parentItemId;
        })
        .map((node) => node.positionKey)
        .sort(),
    [visibleNodes],
  );

  const requestTrash = useCallback(
    async (node: TreeNode) => {
      // A destructive confirmation replaces the mobile navigation drawer; it
      // must not be portalled beside an open modal drawer, whose body lock
      // would correctly reject pointer interaction outside that drawer.
      const returnToMobileNavigation = mobileNavigationOpen;
      setMobileNavigationOpen(false);
      const impact = await service.previewTrashImpact(node.item.id);
      setTrashConfirmation({
        node,
        returnToMobileNavigation,
        description: impact.isDatabase
          ? DATABASE_COPY.hierarchy.trashImpact(impact.ownedSourceCount)
          : FR_COPY.navigation.trashDescription(node.item.name),
      });
    },
    [mobileNavigationOpen, service],
  );

  const confirmTrash = useCallback(async () => {
    if (trashConfirmation === null) return;
    setTrashing(true);
    try {
      await runCommand("item.trash", { itemId: trashConfirmation.node.item.id }, [
        trashConfirmation.node.item.currentRevisionId,
      ]);
      setTrashConfirmation(null);
    } finally {
      setTrashing(false);
    }
  }, [runCommand, trashConfirmation]);

  const createDatabaseItem = useCallback(
    async (parentItemId: Uuid | null) => {
      setRootCreationOpen(false);
      setInlineCreationItemId(null);
      const keys = siblingKeys(parentItemId);
      const itemId = generateUuidV7();
      setProblem(null);
      const result = await service.createDatabase({
        id: itemId,
        name: defaultItemTitle("database"),
        placement: {
          id: generateUuidV7(),
          parentItemId,
          positionKey: safeKeyBetween(keys[keys.length - 1] ?? null, null),
        },
        titlePropertyId: generateUuidV7(),
        titlePropertyName: DATABASE_COPY.create.initialTitlePropertyName,
        initialViewId: generateUuidV7(),
        initialViewName: DATABASE_COPY.create.initialViewName,
      });
      if (!result.ok) {
        setProblem(result.error);
        throw new Error(result.error.title);
      }
      // Classify before navigation so the page editor cannot mount above the
      // database and then jump when classification finishes.
      structuredKindByItemId.current.set(itemId, "database");
      if (parentItemId !== null) {
        setExpanded((current) => new Set(current).add(parentItemId));
      }
      replaceTitleDraftSession({ itemId, draft: "", focused: true });
      openItem(itemId);
      await refresh();
    },
    [openItem, refresh, replaceTitleDraftSession, service, siblingKeys],
  );

  const requestDatabasePage = useCallback(
    (parentItemId: Uuid | null) => {
      setRootCreationOpen(false);
      setInlineCreationItemId(null);
      // As with trash confirmation, replace the modal drawer rather than
      // opening an unrelated modal outside its locked interaction boundary.
      setMobileNavigationOpen(false);
      setDatabaseCreate({ parentItemId, returnToMobileNavigation: mobileNavigationOpen });
      setDatabaseCreateMode("choose");
      setDatabaseCreateError(null);
      setDatabaseCreateBusy(false);
      const owners = new Map(items.map((item) => [item.id, item]));
      void service
        .listDatabases()
        .then((rows) => {
          const options = rows.flatMap((row) => {
            const owner = owners.get(row.itemId);
            if (
              row.sourceId === undefined ||
              owner?.kind !== "database" ||
              owner.lifecycle !== "active"
            ) {
              return [];
            }
            return [{ id: row.sourceId, name: row.definition.name?.trim() || owner.name }];
          });
          setDatabaseSourceOptions(options);
          setDatabaseSourceId(options[0]?.id ?? "");
        })
        .catch(() => {
          setDatabaseSourceOptions([]);
          setDatabaseSourceId("");
          setDatabaseCreateError("Les sources existantes ne sont pas disponibles.");
        });
    },
    [items, mobileNavigationOpen, service],
  );

  const createLinkedDatabasePage = useCallback(async () => {
    if (databaseCreate === null || databaseSourceId === "") return;
    const source = databaseSourceOptions.find((option) => option.id === databaseSourceId);
    if (source === undefined) return;
    setDatabaseCreateBusy(true);
    setDatabaseCreateError(null);
    const parentItemId = databaseCreate.parentItemId;
    const itemId = generateUuidV7();
    const result = await service.mutate("database_view.create", {
      id: itemId,
      name: linkedDatabasePageName(source.name),
      sourceId: source.id,
      placement: {
        id: generateUuidV7(),
        parentItemId,
        positionKey: safeKeyBetween(siblingKeys(parentItemId).at(-1) ?? null, null),
      },
      initialViewId: generateUuidV7(),
    });
    setDatabaseCreateBusy(false);
    if (!result.ok) {
      setDatabaseCreateError(result.error.title);
      return;
    }
    structuredKindByItemId.current.set(itemId, "database");
    if (parentItemId !== null) setExpanded((current) => new Set(current).add(parentItemId));
    setDatabaseCreate(null);
    openItem(itemId);
    await refresh();
  }, [
    databaseCreate,
    databaseSourceId,
    databaseSourceOptions,
    openItem,
    refresh,
    service,
    siblingKeys,
  ]);

  const createItem = useCallback(
    async (kind: "page" | "folder", parentItemId: Uuid | null) => {
      const name = defaultItemTitle(kind);
      setRootCreationOpen(false);
      setInlineCreationItemId(null);
      const keys = siblingKeys(parentItemId);
      const positionKey = safeKeyBetween(keys[keys.length - 1] ?? null, null);
      const itemId = generateUuidV7();
      const created = await runCommand("item.create", {
        id: itemId,
        kind,
        name,
        placement: { id: generateUuidV7(), kind: "hierarchy", parentItemId, positionKey },
        ...(kind === "page"
          ? {
              pageDocument: {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: {},
              },
            }
          : {}),
      });
      if (!created) return;
      if (parentItemId !== null) {
        // Open the branch we just put something into. Creating a page inside a
        // collapsed folder and being shown nothing is indistinguishable from
        // the creation having failed.
        setExpanded((current) => new Set(current).add(parentItemId));
      }
      // Creation is navigation, not merely a tree mutation. Pages and folders
      // share the same identity header, so every entry point lands in the same
      // blank focused title. Keep that draft with the route identity itself:
      // an asynchronous page-classification render may replace the canvas,
      // but it must never replace what the owner is typing.
      replaceTitleDraftSession({ itemId, draft: "", focused: true });
      openItem(itemId);
    },
    [openItem, replaceTitleDraftSession, runCommand, siblingKeys],
  );

  const createLinkedChild = useCallback(
    async (parentItemId: Uuid, request: CreateSubpageRequest, kind: "page" | "folder") => {
      const label = kind === "page" ? "page" : "dossier";
      if (!isUuid(request.id)) throw new Error(`L’identité du ${label} est invalide.`);
      const itemId = request.id as Uuid;
      const existing = await service.getItem(itemId);
      if (existing !== null) {
        const alreadyAttached = existing.placements.some(
          (placement) => placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
        );
        if (!alreadyAttached || existing.kind !== kind) {
          throw new Error("Cette identité appartient déjà à un autre élément.");
        }
        return { id: existing.id, title: existing.name };
      }

      const keys = items
        .flatMap((item) =>
          item.placements
            .filter(
              (placement) =>
                placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
            )
            .map((placement) => placement.positionKey),
        )
        .sort();
      const result = await service.mutate("item.create", {
        id: itemId,
        kind,
        name: request.title.trim() || defaultItemTitle(kind),
        placement: {
          id: generateUuidV7(),
          kind: "hierarchy",
          parentItemId,
          positionKey: safeKeyBetween(keys.at(-1) ?? null, null),
        },
        ...(kind === "page"
          ? {
              pageDocument: {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: {},
              },
            }
          : {}),
      });
      if (!result.ok) {
        setProblem(result.error);
        throw new Error(result.error.title);
      }
      await refresh();
      // Expand only once the refreshed projection contains the child. Opening
      // the page before that refresh lets the stale-branch cleanup observe a
      // childless page and immediately collapse it again.
      setExpanded((current) => new Set(current).add(parentItemId));
      // The slash flow opens the child after its generated page-link change
      // crosses the durable editor boundary. Prepare the same identity-bound
      // blank draft as sidebar creation before that later navigation happens,
      // so the title receives focus without a render-time focus flag racing
      // the first keystroke.
      replaceTitleDraftSession({ itemId, draft: "", focused: true });
      return { id: itemId, title: request.title.trim() || defaultItemTitle(kind) };
    },
    [items, refresh, replaceTitleDraftSession, service],
  );

  const createSubpage = useCallback(
    (parentItemId: Uuid, request: CreateSubpageRequest) =>
      createLinkedChild(parentItemId, request, "page"),
    [createLinkedChild],
  );

  const createSubfolder = useCallback(
    (parentItemId: Uuid, request: CreateSubpageRequest) =>
      createLinkedChild(parentItemId, request, "folder"),
    [createLinkedChild],
  );

  const createDatabaseChild = useCallback(
    async (parentItemId: Uuid, request: CreateSubpageRequest) => {
      if (!isUuid(request.id)) throw new Error("L’identité de la base est invalide.");
      const itemId = request.id as Uuid;
      const existing = await service.getItem(itemId);
      if (existing !== null) {
        if (
          existing.kind !== "database" ||
          existing.lifecycle !== "active" ||
          !existing.placements.some(
            (placement) =>
              placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
          )
        ) {
          throw new Error("Cette identité appartient déjà à un autre élément.");
        }
        const storedView = (await service.getDatabase(itemId))?.presentation?.views[0];
        if (storedView === undefined) throw new Error(FR_COPY.editor.databaseInsertion.missingView);
        return {
          id: itemId,
          title: existing.name,
          viewId: storedView.id,
        };
      }
      const keys = items
        .flatMap((item) =>
          item.placements
            .filter(
              (placement) =>
                placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
            )
            .map((placement) => placement.positionKey),
        )
        .sort();
      const title = request.title.trim() || defaultItemTitle("database");
      const initialViewId = request.initialViewId ?? generateUuidV7();
      const result = await service.createDatabase({
        id: itemId,
        name: title,
        placement: {
          id: generateUuidV7(),
          parentItemId,
          positionKey: safeKeyBetween(keys.at(-1) ?? null, null),
        },
        titlePropertyId: generateUuidV7(),
        titlePropertyName: "Nom",
        initialViewId,
        initialViewName: "Table",
      });
      if (!result.ok) throw new Error(result.error.title);
      structuredKindByItemId.current.set(itemId, "database");
      await refresh();
      setExpanded((current) => new Set(current).add(parentItemId));
      return { id: itemId, title, viewId: initialViewId };
    },
    [items, refresh, service],
  );

  const importHierarchyFile = useCallback(
    async (parentItemId: Uuid, file: File) => {
      const keys = items
        .flatMap((item) =>
          item.placements
            .filter(
              (placement) =>
                placement.kind === "hierarchy" && placement.parentItemId === parentItemId,
            )
            .map((placement) => placement.positionKey),
        )
        .sort();
      const result = await service.api.importFile(generateUuidV7(), file, {
        kind: "hierarchy",
        parentItemId,
        positionKey: safeKeyBetween(keys.at(-1) ?? null, null),
      });
      if (!result.ok) {
        setProblem({
          code: isSafeErrorCode(result.problem.code) ? result.problem.code : "internal.unexpected",
          title: result.problem.title,
        });
        return;
      }
      await service.synchronize();
      await refresh();
      // `importFile` writes through the API, so the local tree still sees a
      // childless page until synchronization and refresh finish. Expanding
      // earlier races the stale-branch cleanup and hides the imported file.
      setExpanded((current) => new Set(current).add(parentItemId));
    },
    [items, refresh, service],
  );

  const renameItem = useCallback(
    async (node: TreeNode) => {
      const name = window.prompt("New name", node.item.name);
      if (name === null || name.trim().length === 0) {
        return;
      }
      await runCommand("item.rename", { itemId: node.item.id, name }, [
        node.item.currentRevisionId,
      ]);
    },
    [runCommand],
  );

  /**
   * Converts an item, and reports back whether the server asked for a
   * confirmation rather than treating that refusal as a failure.
   *
   * The distinction matters: `conversion.confirmation-required` is not an
   * error the owner should see as a red banner, it is the server saying "ask
   * them first". Everything else is a real failure.
   */
  const convertItem = useCallback(
    async (itemId: Uuid, targetKind: "page" | "folder", confirmedDestruction: boolean) => {
      setProblem(null);
      const result = await service.mutate("item.convert", {
        itemId,
        targetKind,
        confirmedDestruction,
      });
      if (result.ok) {
        await refresh({ kind: "upsert", itemIds: [itemId] });
        return { ok: true, needsConfirmation: false };
      }
      const needsConfirmation = result.error.code === "conversion.confirmation-required";
      if (!needsConfirmation) {
        setProblem(result.error);
      }
      return { ok: false, needsConfirmation, message: result.error.title };
    },
    [service, refresh],
  );

  const reorder = useCallback(
    async (node: TreeNode, direction: -1 | 1) => {
      const placement = node.item.placements.find((entry) => entry.kind === "hierarchy");
      if (placement === undefined) {
        return;
      }
      const parentId = placement.parentItemId;
      const siblings = allNodes
        .filter((candidate) => {
          const candidatePlacement = candidate.item.placements.find(
            (entry) => entry.kind === "hierarchy",
          );
          return (candidatePlacement?.parentItemId ?? null) === parentId;
        })
        .sort((a, b) => (a.positionKey < b.positionKey ? -1 : 1));
      const index = siblings.findIndex((candidate) => candidate.item.id === node.item.id);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= siblings.length) {
        return;
      }
      const before = direction === -1 ? siblings[targetIndex - 1] : siblings[targetIndex];
      const after = direction === -1 ? siblings[targetIndex] : siblings[targetIndex + 1];
      const positionKey = safeKeyBetween(before?.positionKey ?? null, after?.positionKey ?? null);
      await runCommand(
        "placement.move",
        { placementId: node.placementId, parentItemId: parentId, positionKey },
        [node.item.currentRevisionId],
      );
    },
    [allNodes, runCommand],
  );

  const moveInto = useCallback(
    async (node: TreeNode, parentItemId: Uuid | null) => {
      const keys = siblingKeys(parentItemId);
      const positionKey = safeKeyBetween(keys[keys.length - 1] ?? null, null);
      await runCommand(
        "placement.move",
        { placementId: node.placementId, parentItemId, positionKey },
        [node.item.currentRevisionId],
      );
    },
    [runCommand, siblingKeys],
  );

  const handleTreeDrop = useCallback(
    (intent: Exclude<TreeDropIntent, { readonly kind: "rejected" }>) => {
      const node = allNodes.find((candidate) => candidate.item.id === intent.itemId);
      if (node === undefined) return;
      if (intent.kind === "nest") {
        void moveInto(node, intent.parentId as Uuid);
        setExpanded((current) => new Set(current).add(intent.parentId));
        return;
      }

      const siblings = allNodes
        .filter((candidate) => {
          if (candidate.item.id === node.item.id) return false;
          const placement = candidate.item.placements.find((entry) => entry.kind === "hierarchy");
          return (placement?.parentItemId ?? null) === intent.parentId;
        })
        .sort((left, right) => (left.positionKey < right.positionKey ? -1 : 1));
      const targetIndex = siblings.findIndex((candidate) => candidate.item.id === intent.targetId);
      if (targetIndex < 0) return;
      const before = intent.edge === "before" ? siblings[targetIndex - 1] : siblings[targetIndex];
      const after = intent.edge === "before" ? siblings[targetIndex] : siblings[targetIndex + 1];
      const positionKey = safeKeyBetween(before?.positionKey ?? null, after?.positionKey ?? null);
      void runCommand(
        "placement.move",
        {
          placementId: node.placementId,
          parentItemId: intent.parentId as Uuid | null,
          positionKey,
        },
        [node.item.currentRevisionId],
      );
    },
    [allNodes, moveInto, runCommand],
  );

  const keyboardNodes = useMemo(
    () =>
      visibleNodes.map((node) => ({
        id: node.item.id,
        name: node.item.name,
        level: 1,
        hasChildren: isBranch(node, projectionComplete),
        expanded: expanded.has(node.item.id),
        parentId:
          node.item.placements.find((entry) => entry.kind === "hierarchy")?.parentItemId ?? null,
      })),
    [visibleNodes, expanded, projectionComplete],
  );

  const toggleBranch = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const folderClickScheduler = useMemo(() => createFolderClickScheduler(), []);
  useEffect(() => () => folderClickScheduler.cancel(), [folderClickScheduler]);

  const onTreeKeyDown = useTreeKeyboard(keyboardNodes, selectedId, {
    select: (id: string) => {
      // Focused synchronously, on the element that is already in the document,
      // before React is told anything.
      //
      // The tree has one tab stop, so focus has to follow the selection:
      // otherwise arrowing moves the highlight and leaves focus behind, and a
      // screen reader keeps reading the row the owner moved away from.
      //
      // Three deferred variants were tried first and all failed for the same
      // underlying reason — the row an owner arrows *to* is already rendered,
      // so a ref never fires for it, and anything scheduled after the state
      // update raced the re-render that follows a projection refresh. Doing it
      // first sidesteps the timing entirely: the element exists, so focus it,
      // then let React catch up.
      const row = document.querySelector(`[data-item-id="${id}"]`);
      if (row instanceof HTMLElement) {
        // Made focusable first. The row being moved to still carries
        // tabindex="-1" at this instant — React has not re-rendered yet — and
        // WebKit declines to focus it in that state where the other engines
        // oblige. Setting it here is harmless: the next render restores whatever
        // the roving tabindex should be.
        row.tabIndex = 0;
        row.focus();
      }
      selectItemById(id as Uuid);
    },
    setExpanded: toggleBranch,
    open: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node?.item.kind === "folder") toggleBranch(id, true);
      openItem(id as Uuid);
    },
    rename: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined) {
        void renameItem(node);
      }
    },
    remove: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined) void requestTrash(node);
    },
  });

  const renderNode = (node: TreeNode, level: number): React.ReactElement => {
    const isSelected = selectedId === node.item.id;
    const branch = isBranch(node, projectionComplete);
    const branchOpen = branch && expanded.has(node.item.id);
    const parentPlacement = node.item.placements.find((entry) => entry.kind === "hierarchy");
    const parentId = parentPlacement?.parentItemId ?? null;
    const pageAttachments = attachmentsByPage.get(node.item.id);
    const childBranch = branch ? (
      <CollapsibleRegion
        open={branchOpen}
        lazy
        className="workspace-tree-children"
        data-testid={`children-${node.item.name}`}
      >
        {node.children.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: role="group" on ul is the canonical ARIA tree substructure
          <ul role="group">{node.children.map((child) => renderNode(child, level + 1))}</ul>
        ) : (
          <BranchState
            containerKind={node.item.kind === "folder" ? "folder" : "page"}
            kind={
              problem !== null
                ? "error"
                : !projectionComplete
                  ? discoveryState
                  : navigator.onLine
                    ? "empty"
                    : "offline"
            }
          />
        )}
        {!projectionComplete && node.children.length > 0 ? (
          <BranchState kind={discoveryState} />
        ) : null}
      </CollapsibleRegion>
    ) : null;
    return (
      <TreeAttachmentDisclosure
        key={node.item.id}
        activeViewId={graphMode !== null ? GRAPH_TAB_ID : selectedId}
      >
        {(attachmentsOpen, toggleAttachments) => (
          <li role="none">
            <TreeDropTarget itemId={node.item.id} canContainChildren={node.item.kind !== "file"}>
              {({
                activeZone,
                consumeDragClick,
                rowDragListeners,
                rowDragging,
                setAfterRef,
                setBeforeRef,
                setInsideRef,
              }) => (
                <div className="tree-drop-target" data-active-zone={activeZone ?? undefined}>
                  <span
                    ref={setBeforeRef}
                    className="tree-drop-zone tree-drop-zone--before"
                    data-testid={`drop-before-${node.item.name}`}
                    data-active={activeZone === "before" || undefined}
                    aria-hidden="true"
                  />
                  <div
                    ref={setInsideRef}
                    role="treeitem"
                    aria-level={level}
                    aria-selected={isSelected}
                    {...(branch ? { "aria-expanded": branchOpen } : {})}
                    tabIndex={isSelected || (selectedId === null && level === 1) ? 0 : -1}
                    className="tree-row"
                    data-testid={`tree-item-${node.item.name}`}
                    data-item-id={node.item.id}
                    data-item-kind={node.item.kind}
                    data-drop-target={activeZone === "inside" || undefined}
                    data-dragging={rowDragging || undefined}
                    data-attachments-open={attachmentsOpen || undefined}
                    {...rowDragListeners}
                    onClick={(event) => {
                      if (consumeDragClick()) return;
                      if (node.item.kind === "folder") {
                        const itemId = node.item.id;
                        const nextOpen = !branchOpen;
                        handleFolderRowPointerClick(folderClickScheduler, {
                          toggle: () => toggleBranch(itemId, nextOpen),
                          expand: () => toggleBranch(itemId, true),
                          open: () => openItem(itemId),
                        });
                        return;
                      }
                      folderClickScheduler.cancel();
                      applyTreeRowPointerAction(
                        resolveTreeRowPointerAction(node.item.kind, "click", event.detail),
                        {
                          toggle: () => toggleBranch(node.item.id, !branchOpen),
                          expand: () => toggleBranch(node.item.id, true),
                          open: () => openItem(node.item.id),
                        },
                      );
                    }}
                    onDoubleClick={() => {
                      if (consumeDragClick()) return;
                      // A folder's native dblclick is ignored: the OS window is
                      // longer than the single-click delay, so a collapse click
                      // after expanding would otherwise open the folder.
                      if (node.item.kind === "folder") return;
                      folderClickScheduler.cancel();
                      applyTreeRowPointerAction(
                        resolveTreeRowPointerAction(node.item.kind, "dblclick"),
                        {
                          toggle: () => toggleBranch(node.item.id, true),
                          expand: () => toggleBranch(node.item.id, true),
                          open: () => openItem(node.item.id),
                        },
                      );
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget
                        .querySelector<HTMLButtonElement>(".navigation-item-menu__trigger")
                        ?.click();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
                        ".navigation-item-menu__trigger",
                      );
                      // Let the shortcut's key event finish before activating the
                      // menu button. WebKit on a touch viewport otherwise restores
                      // focus to the trigger and immediately hides the menu that the
                      // synchronous click just opened.
                      requestAnimationFrame(() => {
                        if (trigger?.isConnected === true) trigger.click();
                      });
                    }}
                  >
                    <TreeItemIdentitySlot
                      item={{
                        kind: node.item.kind,
                        icon: node.item.icon,
                        name: node.item.name,
                        holdsContent: pageHoldsTreeContent(node.item),
                      }}
                      branch={branch}
                      expanded={branchOpen}
                      onToggle={() => toggleBranch(node.item.id, !branchOpen)}
                    />
                    <span className="tree-name">{node.item.name}</span>
                    {/* Marked, never as "missing" (FR-018). Content the server holds is
              not lost because this device released it or has not fetched it, and
              the two are distinguished because they mean different things to an
              owner deciding whether something is safe. */}
                    {node.item.localAvailability !== "present" ? (
                      <span
                        className="muted"
                        data-testid={`availability-${node.item.name}`}
                        data-availability={node.item.localAvailability}
                      >
                        {node.item.localAvailability === "offloaded"
                          ? "not on this device"
                          : "not fetched yet"}
                      </span>
                    ) : null}
                    {node.item.kind === "file" ? <FileNode item={node.item} /> : null}
                    <span
                      className="navigation-item-actions"
                      data-inline-open={inlineCreationItemId === node.item.id || undefined}
                    >
                      {node.item.kind === "page" ? (
                        <Button
                          size="square"
                          variant="ghost"
                          className="workspace-page-attachments-trigger"
                          aria-label={`Pièces jointes de ${node.item.name}`}
                          aria-expanded={attachmentsOpen}
                          aria-controls={`page-attachments-${node.item.id}`}
                          data-testid={`toggle-attachments-${node.item.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleAttachments();
                          }}
                        >
                          <AppIcon name="paperclip" size="small" />
                          {pageAttachments !== undefined && pageAttachments.length > 0 ? (
                            <span className="workspace-page-attachments-count" aria-hidden="true">
                              {pageAttachments.length}
                            </span>
                          ) : null}
                        </Button>
                      ) : null}
                      {node.item.kind === "file" || node.item.kind === "database_view" ? null : (
                        <NavigationInlineCreate
                          itemName={node.item.name}
                          open={inlineCreationItemId === node.item.id}
                          onOpenChange={(open) =>
                            setInlineCreationItemId(open ? node.item.id : null)
                          }
                          onCreatePage={() => void createItem("page", node.item.id)}
                          onCreateFolder={() => void createItem("folder", node.item.id)}
                          {...(node.item.kind === "page" || node.item.kind === "folder"
                            ? { onCreateDatabase: () => requestDatabasePage(node.item.id) }
                            : {})}
                        />
                      )}
                      <NavigationItemMenu
                        itemName={node.item.name}
                        canContainChildren={
                          node.item.kind !== "file" && node.item.kind !== "database_view"
                        }
                        canMoveToRoot={parentId !== null}
                        canMoveSelectedInside={selectedId !== null && selectedId !== node.item.id}
                        favourite={node.item.favourite}
                        keptOffline={node.item.offlineIntent}
                        {...(node.item.kind !== "page" && node.item.kind !== "folder"
                          ? {}
                          : {
                              conversion: (
                                returnFocus: RefObject<HTMLButtonElement | null>,
                                onActiveChange: (active: boolean) => void,
                              ) => (
                                <ConvertItemControl
                                  itemId={node.item.id}
                                  itemName={node.item.name}
                                  kind={node.item.kind as ConvertibleKind}
                                  holdsContent={pageHoldsTreeContent(node.item)}
                                  convert={convertItem}
                                  finalFocus={returnFocus}
                                  onActiveChange={onActiveChange}
                                  variant="menu"
                                />
                              ),
                            })}
                        onCreatePage={() => void createItem("page", node.item.id)}
                        onCreateFolder={() => void createItem("folder", node.item.id)}
                        onCreateDatabase={
                          node.item.kind === "page" || node.item.kind === "folder"
                            ? () => requestDatabasePage(node.item.id)
                            : undefined
                        }
                        onImportFile={(file) => void importHierarchyFile(node.item.id, file)}
                        onRename={() => void renameItem(node)}
                        onChangeIcon={
                          node.item.kind === "file"
                            ? undefined
                            : () => setIconPickerItemId(node.item.id)
                        }
                        onMoveUp={() => void reorder(node, -1)}
                        onMoveDown={() => void reorder(node, 1)}
                        onMoveToRoot={() => void moveInto(node, null)}
                        onMoveSelectedInside={() => {
                          const selected = visibleNodes.find(
                            (candidate) => candidate.item.id === selectedId,
                          );
                          if (selected !== undefined) void moveInto(selected, node.item.id);
                        }}
                        onToggleFavourite={() =>
                          void runCommand("item.favourite", {
                            itemId: node.item.id,
                            favourite: !node.item.favourite,
                          })
                        }
                        onToggleOffline={() =>
                          void runCommand("item.offline", {
                            itemId: node.item.id,
                            offline: !node.item.offlineIntent,
                          })
                        }
                        onRequestTrash={() => void requestTrash(node)}
                      />
                    </span>
                  </div>
                  <span
                    ref={setAfterRef}
                    className="tree-drop-zone tree-drop-zone--after"
                    data-testid={`drop-after-${node.item.name}`}
                    data-active={activeZone === "after" || undefined}
                    aria-hidden="true"
                  />
                </div>
              )}
            </TreeDropTarget>
            {node.item.kind === "page" ? (
              <CollapsibleRegion
                open={attachmentsOpen}
                lazy
                joinPrevious
                id={`page-attachments-${node.item.id}`}
                className="workspace-page-attachments"
                data-testid={`page-attachments-${node.item.name}`}
                role="group"
              >
                <div
                  role="treeitem"
                  aria-level={level + 1}
                  aria-label={`Pièces jointes de ${node.item.name}`}
                  tabIndex={-1}
                >
                  <AttachmentPanel
                    compact
                    pageId={node.item.id}
                    attachments={pageAttachments}
                    onChanged={() => void refresh()}
                    onOpenUsage={(itemId) => openPageLink(itemId)}
                  />
                </div>
              </CollapsibleRegion>
            ) : null}
            {childBranch}
          </li>
        )}
      </TreeAttachmentDisclosure>
    );
  };

  const navigationTree = (
    <div
      id="workspace-tree"
      className="workspace-tree"
      data-open={sidebarOpen || mobileNavigationOpen}
      data-testid="workspace-tree"
    >
      {loadState === "loading" ? (
        <BranchState kind="loading" />
      ) : loadState === "error" ? (
        <p className="muted">Stockage local indisponible.</p>
      ) : tree.length === 0 && !projectionComplete ? (
        <BranchState kind={discoveryState} />
      ) : tree.length === 0 ? (
        <p className="workspace-navigation__empty" data-testid="empty-state">
          Aucune page pour le moment.
        </p>
      ) : (
        <TreeDragDropProvider
          items={draggableTreeItems}
          onDrop={handleTreeDrop}
          onRejected={() =>
            setProblem({
              code: "containment.cycle-rejected",
              title: "Ce déplacement créerait une boucle dans l’arborescence.",
            })
          }
        >
          {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the list receives the tree role deliberately (WAI-ARIA tree over ul/li) */}
          <ul role="tree" aria-label="Arborescence" className="tree" onKeyDown={onTreeKeyDown}>
            {tree.map((node) => renderNode(node, 1))}
          </ul>
        </TreeDragDropProvider>
      )}
      {loadState === "ready" && !projectionComplete && tree.length > 0 ? (
        <BranchState kind={discoveryState} />
      ) : null}
      {loadState === "ready" && !projectionComplete && discoveryState !== "loading" ? (
        <Button
          variant="ghost"
          size="compact"
          onClick={() => void service.synchronize().catch(() => undefined)}
        >
          Réessayer le chargement
        </Button>
      ) : null}
    </div>
  );

  const creationControls = (
    <>
      <span className="workspace-navigation__heading-actions">
        <NavigationInlineCreate
          itemName="Notes"
          variant="root"
          open={rootCreationOpen}
          testIds={{
            root: "root-inline-create",
            toggle: "toggle-root-creation",
            page: "new-root-page",
            folder: "new-root-folder",
          }}
          onOpenChange={setRootCreationOpen}
          onCreatePage={() => void createItem("page", null)}
          onCreateFolder={() => void createItem("folder", null)}
          onCreateDatabase={() => requestDatabasePage(null)}
        />
      </span>
    </>
  );
  const noticeCount = (backupStale ? 1 : 0) + (problem === null ? 0 : 1);
  const graphScope = useMemo<GraphScope | null>(
    () =>
      graphMode === null
        ? null
        : graphMode.kind === "global"
          ? { kind: "workspace" }
          : { kind: "neighborhood", centerId: graphMode.centerId, depth: 2 },
    [graphMode],
  );

  return (
    <WorkspaceShell
      databaseEntryActions={{
        relationOptions: items
          .filter((item) => item.kind === "page" && item.lifecycle === "active")
          .map((item) => ({ id: item.id, label: item.name })),
        convert: convertItem,
        openFullPage: selectItemById,
        editIcon: setIconPickerItemId,
        trash: async (id) => {
          const item = await service.getItem(id);
          if (item === null) throw new Error("Cette entrée est indisponible.");
          const result = await service.mutate("item.trash", { itemId: id }, [
            item.currentRevisionId,
          ]);
          if (!result.ok) throw new Error(result.error.title);
          await refresh();
        },
        save: async (row, draft) => {
          const membership = await service.getDatabaseEntry(row.entryId as Uuid);
          const item = await service.getItem(row.entryId as Uuid);
          if (membership === null || item === null)
            throw new Error("Cette entrée est indisponible.");
          if (draft.title !== row.title && item.name !== row.title && item.name !== draft.title)
            throw new Error("Le titre a changé ailleurs. Votre saisie est conservée.");
          if (draft.changedPropertyIds.length)
            await saveEntryPropertyChanges(
              service,
              membership.databaseId,
              row.entryId as Uuid,
              draft.values,
              draft.relationTargets,
              {
                propertyIds: draft.changedPropertyIds,
                previousValues: row.values as Parameters<
                  typeof saveEntryPropertyChanges
                >[5]["previousValues"],
                previousRelations: row.relationTargets as unknown as Parameters<
                  typeof saveEntryPropertyChanges
                >[5]["previousRelations"],
              },
            );
          if (draft.title !== row.title && item.name !== draft.title) {
            const current = await service.getItem(item.id);
            if (current === null) throw new Error("Cette entrée est indisponible.");
            if (current.name !== row.title && current.name !== draft.title)
              throw new Error("Le titre a changé ailleurs. Votre saisie est conservée.");
            if (current.name === draft.title) return;
            const result = await service.mutate(
              "item.rename",
              { itemId: item.id, name: draft.title },
              [current.currentRevisionId],
            );
            if (!result.ok) throw new Error(result.error.title);
          }
        },
      }}
      onOpenDatabaseEntry={openDatabasePeek}
      entryOverlay={
        entryPeek === null ? null : (
          <DatabaseEntryPeek
            key={entryPeek.entryId}
            request={entryPeek}
            service={service}
            drafts={entryDraftSessions.current}
            relationOptions={items
              .filter((item) => item.kind === "page" && item.lifecycle === "active")
              .map((item) => ({ id: item.id, label: item.name }))}
            onClose={closeDatabasePeek}
            onFullPage={(id) => {
              setEntryPeek(null);
              selectItemById(id);
            }}
            renderHeader={(item) => (
              <PageTitleEditor
                key={`peek-title-${item.id}`}
                {...titleEditingProps(
                  item.id,
                  item.name,
                  item.kind === "folder" ? "folder" : "page",
                )}
                kind={item.kind === "folder" ? "folder" : "page"}
                icon={item.icon}
                title={item.name}
                onIconChange={(icon) => void changeItemIcon(item.id, icon)}
              />
            )}
            renderContent={(item) =>
              item.kind === "folder" ? (
                <FolderChildrenList
                  folderName={item.name}
                  items={items
                    .filter(
                      (child) =>
                        child.lifecycle === "active" &&
                        child.placements.some(
                          (placement) =>
                            placement.kind === "hierarchy" && placement.parentItemId === item.id,
                        ),
                    )
                    .map((child) => ({
                      id: child.id,
                      href: notePath(child.id),
                      name: child.name,
                      kind: child.kind,
                      icon: child.icon,
                      childCount: items.filter((descendant) =>
                        descendant.placements.some(
                          (placement) =>
                            placement.kind === "hierarchy" && placement.parentItemId === child.id,
                        ),
                      ).length,
                    }))}
                  onOpen={(id) => openItem(id as Uuid)}
                  onReorder={(request) =>
                    handleTreeDrop({
                      kind: "place",
                      itemId: request.itemId,
                      targetId: request.targetId,
                      parentId: item.id,
                      edge: request.edge,
                    })
                  }
                />
              ) : (
                <WorkspacePageEditor
                  service={service}
                  itemId={item.id}
                  items={items}
                  createPage={createSubpage}
                  createFolder={createSubfolder}
                  createDatabase={createDatabaseChild}
                  onOpenPage={openPageLink}
                />
              )
            }
          />
        )
      }
      changeStream={changeStream}
      contentMode={
        graphMode !== null
          ? "graph"
          : selectedItem?.kind === "page" ||
              selectedItem?.kind === "folder" ||
              selectedItem?.kind === "database" ||
              selectedItem?.kind === "database_view"
            ? "page"
            : "bounded"
      }
      mobileNavigationOpen={mobileNavigationOpen}
      restoreMobileFocusOnClose={titleDraftSession?.focused !== true && databaseCreate === null}
      sidebarOpen={sidebarOpen}
      sidebarWidth={sidebarWidth}
      onMobileNavigationOpenChange={setMobileNavigationOpen}
      onSidebarOpenChange={setSidebarOpen}
      onSidebarWidthChange={setSidebarWidth}
      navigation={
        <Sidebar
          items={items}
          tree={navigationTree}
          creationControls={creationControls}
          shortcutPreferences={shortcutPreferences}
          onShortcutExpandedChange={(section, expanded) => {
            setShortcutPreferences((current) => ({
              ...current,
              [section === "favourites" ? "favouritesExpanded" : "recentsExpanded"]: expanded,
            }));
          }}
          onOpen={openItem}
          onOpenGraph={() => {
            setMobileNavigationOpen(false);
            onOpenGraph(null);
          }}
          onOpenSettings={() => {
            setMobileNavigationOpen(false);
            onOpenSettings();
          }}
          onOpenSearch={openSearch}
        />
      }
      header={
        <PageHeader
          kind={graphMode !== null ? "graph" : (selectedItem?.kind ?? "workspace")}
          {...(graphMode !== null
            ? {}
            : selectedItem?.kind === "page" || selectedItem?.kind === "folder"
              ? {}
              : { title: selectedItem?.name ?? "Bienvenue" })}
          tabs={
            loadState === "ready" && openTabs.length > 0 ? (
              <OpenTabsStrip
                tabs={openTabs}
                activeId={graphMode !== null ? GRAPH_TAB_ID : selectedId}
                onActivate={(itemId) => {
                  if (isGraphTabId(itemId)) {
                    onOpenGraph(lastGraphCenter.current);
                    return;
                  }
                  openItem(itemId as Uuid);
                }}
                onClose={closeOpenTab}
                onEmptyFocus={focusWorkspaceMain}
                onReorder={(activeTabId, overTabId) => {
                  setOpenTabIds((current) => reorderTabs(current, activeTabId, overTabId));
                }}
              />
            ) : undefined
          }
        />
      }
    >
      <DatabaseCreateChoiceDialog
        open={databaseCreate !== null}
        mode={databaseCreateMode}
        sources={databaseSourceOptions}
        sourceId={databaseSourceId}
        busy={databaseCreateBusy}
        error={databaseCreateError}
        onCancel={() => {
          if (!databaseCreateBusy) {
            if (databaseCreate?.returnToMobileNavigation === true) setMobileNavigationOpen(true);
            setDatabaseCreate(null);
          }
        }}
        onCreateNewSource={() => {
          const parentItemId = databaseCreate?.parentItemId ?? null;
          setDatabaseCreate(null);
          void createDatabaseItem(parentItemId);
        }}
        onShowExisting={() => setDatabaseCreateMode("existing")}
        onSourceId={setDatabaseSourceId}
        onCreateFromSource={() => void createLinkedDatabasePage()}
        onBack={() => setDatabaseCreateMode("choose")}
      />
      <ConfirmDialog
        open={trashConfirmation !== null}
        busy={trashing}
        title={FR_COPY.navigation.trashTitle}
        description={trashConfirmation?.description ?? ""}
        confirmLabel={FR_COPY.navigation.trashConfirm}
        testId="trash-confirmation"
        confirmTestId="confirm-trash"
        cancelTestId="cancel-trash"
        onCancel={() => {
          const returnToMobileNavigation = trashConfirmation?.returnToMobileNavigation === true;
          setTrashConfirmation(null);
          if (returnToMobileNavigation) setMobileNavigationOpen(true);
        }}
        onConfirm={() => void confirmTrash()}
      />
      <ItemEmojiDialog
        open={iconPickerItem !== null}
        item={iconPickerItem}
        onClose={() => setIconPickerItemId(null)}
        onChange={(icon) => {
          if (iconPickerItem !== null) void changeItemIcon(iconPickerItem.id, icon);
        }}
      />
      {searchOpen && search !== null ? (
        <SearchDialog
          search={search}
          branches={searchBranches}
          itemIcons={searchItemIcons}
          finalFocus={searchReturnFocus}
          onOpen={(itemId) => openItem(itemId)}
          onClose={closeSearch}
        />
      ) : null}

      {backupStale || problem !== null ? (
        <details
          className="workspace-notices"
          aria-label="Informations nécessitant votre attention"
          open={noticesOpen}
          onToggle={(event) => setNoticesOpen(event.currentTarget.open)}
        >
          <summary
            className="workspace-notices__summary"
            data-testid="workspace-notices-summary"
            title="Afficher les alertes de l’espace de travail"
          >
            <AppIcon name="conflict" size="small" />
            <span>
              {noticeCount} {noticeCount > 1 ? "alertes" : "alerte"}
            </span>
          </summary>
          <div className="workspace-notices__panel">
            {backupStale ? (
              <AsyncState
                compact
                kind="error"
                testId="workspace-backup-stale"
                title="Aucune sauvegarde vérifiée depuis plus d’un jour."
                action={
                  <Button size="compact" variant="ghost" onClick={onOpenBackups}>
                    Vérifier les sauvegardes
                  </Button>
                }
              />
            ) : null}
            {problem !== null ? (
              <AsyncState
                compact
                kind="error"
                testId="problem-banner"
                title={problem.title}
                action={
                  <Button size="compact" variant="ghost" onClick={onOpenDiagnostics}>
                    Voir les détails
                  </Button>
                }
              />
            ) : null}
          </div>
        </details>
      ) : null}

      {loadState === "error" ? (
        <WorkspaceState
          kind="error"
          detail="Le stockage local est inaccessible. Vérifiez l’accès au stockage et au coffre de cet appareil, puis réessayez. Vos données locales sont conservées."
          onRetry={() => window.location.reload()}
        />
      ) : (
        <>
          {graphScope !== null ? (
            loadState === "loading" ? (
              <WorkspaceState kind="loading" phase={loadPhase} />
            ) : (
              <KnowledgeGraphView
                service={service}
                items={[...items, ...trashedItems]}
                initialScope={graphScope}
                onOpenItem={openItem}
              />
            )
          ) : null}
          <div hidden={graphScope !== null}>
            {loadState === "loading" && selectedItem === null ? (
              selectedId !== null ? (
                <article className="workspace-page-canvas" data-testid="workspace-page-opening">
                  <PageContentSkeleton variant="page" />
                </article>
              ) : (
                <WorkspaceState kind="loading" phase={loadPhase} />
              )
            ) : selectedItem === null ? (
              routedItemState === "loading" ||
              (selectedId === null && items.length === 0 && !projectionComplete) ? (
                <WorkspaceState kind={discoveryState} phase="discovering" />
              ) : routedItemState === "unavailable-local" ? (
                <WorkspaceState
                  kind="offline"
                  detail="Cette note n’est pas présente sur cet appareil. Reconnectez-vous pour la charger."
                />
              ) : routedItemState === "trashed" ? (
                <WorkspaceState
                  kind="error"
                  detail="Cette note se trouve dans la corbeille. Ouvrez la corbeille pour la restaurer."
                />
              ) : routedItemState === "not-found" ? (
                <WorkspaceState
                  kind="error"
                  detail="Cette note est introuvable ou a été supprimée."
                />
              ) : (
                <WorkspaceState
                  kind="empty"
                  detail={
                    items.length === 0
                      ? "Créez une première page depuis la barre latérale."
                      : "Choisissez une page dans la barre latérale pour reprendre votre travail."
                  }
                />
              )
            ) : null}

            {selectedItem !== null &&
            (selectedItem.kind === "page" ||
              selectedItem.kind === "database" ||
              selectedItem.kind === "database_view") ? (
              <DatabaseConflictResolution
                service={service}
                itemId={selectedItem.id}
                onResolved={() => void refresh()}
              />
            ) : null}

            {(selectedItem !== null &&
              (selectedItem.kind === "page" ||
                selectedItem.kind === "database" ||
                selectedItem.kind === "database_view") &&
              !showSelectedEntry) ||
            pageEditorSessionIds.length > 0 ? (
              <article
                className="workspace-page-canvas"
                hidden={
                  selectedItem === null ||
                  (selectedItem.kind !== "page" &&
                    selectedItem.kind !== "database" &&
                    selectedItem.kind !== "database_view") ||
                  showSelectedEntry
                }
                data-testid={
                  selectedItem !== null &&
                  (selectedItem.kind === "page" ||
                    selectedItem.kind === "database" ||
                    selectedItem.kind === "database_view") &&
                  !showSelectedEntry
                    ? holdStructuredCanvasBody
                      ? "workspace-page-opening"
                      : "workspace-page-canvas"
                    : undefined
                }
              >
                {selectedItem !== null &&
                (selectedItem.kind === "page" ||
                  selectedItem.kind === "database" ||
                  selectedItem.kind === "database_view") &&
                !showSelectedEntry ? (
                  <>
                    <PageTitleEditor
                      key={`title-${selectedItem.id}`}
                      {...titleEditingProps(selectedItem.id, selectedItem.name, selectedItem.kind)}
                      kind={selectedItem.kind}
                      holdsContent={pageHoldsTreeContent(selectedItem)}
                      discoverable={graphScope === null}
                      breadcrumbs={
                        <PathBreadcrumbs path={pathCrumbs} onOpen={(id) => openItem(id as Uuid)} />
                      }
                      pathActions={
                        <Button
                          size="compact"
                          variant="ghost"
                          className="workspace-page-title__graph"
                          data-testid="open-local-graph"
                          title="Voir les relations"
                          onClick={() => onOpenGraph(selectedItem.id)}
                        >
                          <AppIcon name="graph" size="small" />
                          <span className="workspace-page-title__graph-label">
                            Voir les relations
                          </span>
                        </Button>
                      }
                      icon={selectedItem.icon}
                      title={selectedItem.name}
                      onIconChange={(icon) => void changeItemIcon(selectedItem.id, icon)}
                      onMoveToContent={() => {
                        if (
                          selectedDatabase !== null &&
                          selectedDatabase.databaseId === selectedItem.id
                        ) {
                          document
                            .querySelector<HTMLElement>(
                              ".database-page button:not([disabled]), .database-page input:not([disabled])",
                            )
                            ?.focus();
                          return;
                        }
                        document
                          .querySelector<HTMLElement>(
                            '[data-testid="operational-editor"] .ProseMirror',
                          )
                          ?.focus();
                      }}
                    />
                    {holdStructuredCanvasBody ? (
                      <PageContentSkeleton />
                    ) : selectedDatabase !== null &&
                      showSelectedDatabase &&
                      (selectedItem.kind === "database" ||
                        selectedItem.kind === "database_view") ? (
                      <DatabaseContainerPage
                        containerItemId={selectedItem.id}
                        service={service}
                        onOpenEntry={(entryId) => {
                          databaseEntryOrigin.current = {
                            entryId,
                            containerItemId: selectedItem.id,
                          };
                          selectItemById(entryId);
                        }}
                        returnFocusEntryId={entryReturnFocusId}
                        onReturnFocusRestored={clearEntryReturnFocus}
                        linked={selectedItem.kind === "database_view"}
                      />
                    ) : selectedDatabase !== null && showSelectedDatabase ? (
                      <DatabasePage
                        database={selectedDatabase}
                        entries={databaseEntries}
                        {...(projectionComplete
                          ? {}
                          : {
                              discoveryState,
                              onRetryDiscovery: () => {
                                void service.synchronize().catch(() => undefined);
                              },
                            })}
                        onPreviewDefinitionImpact={async (definition) => {
                          if (
                            !projectionComplete &&
                            (!jsonValuesEqual(
                              definition.properties,
                              selectedDatabase.definition.properties,
                            ) ||
                              !jsonValuesEqual(
                                definition.taskRoles,
                                selectedDatabase.definition.taskRoles,
                              ))
                          ) {
                            throw new Error(
                              "Attendez la fin du chargement pour modifier la structure de cette base.",
                            );
                          }
                          const current = await service.getItem(selectedItem.id);
                          return current === null
                            ? null
                            : await service.previewDatabaseDefinitionImpact(
                                selectedItem.id,
                                current.currentRevisionId,
                                definition,
                              );
                        }}
                        onReplaceDefinition={(
                          definition: DatabaseDefinition,
                          confirmation?: DefinitionConfirmation,
                        ) => {
                          if (
                            !projectionComplete &&
                            (!jsonValuesEqual(
                              definition.properties,
                              selectedDatabase.definition.properties,
                            ) ||
                              !jsonValuesEqual(
                                definition.taskRoles,
                                selectedDatabase.definition.taskRoles,
                              ))
                          ) {
                            throw new Error(
                              "Attendez la fin du chargement pour modifier la structure de cette base.",
                            );
                          }
                          const previousDatabase = selectedDatabase;
                          optimisticDatabaseDefinition.current = {
                            databaseId: selectedItem.id,
                            definition,
                          };
                          setSelectedDatabase({
                            ...previousDatabase,
                            definition,
                          } as unknown as DatabaseDto);
                          const rollbackOptimisticDefinition = (): void => {
                            if (
                              optimisticDatabaseDefinition.current?.databaseId ===
                                selectedItem.id &&
                              jsonValuesEqual(
                                optimisticDatabaseDefinition.current.definition,
                                definition,
                              )
                            ) {
                              optimisticDatabaseDefinition.current = null;
                            }
                            setSelectedDatabase((current) =>
                              current !== null && jsonValuesEqual(current.definition, definition)
                                ? previousDatabase
                                : current,
                            );
                          };
                          const operation = async (): Promise<void> => {
                            for (let attempt = 0; attempt < 3; attempt += 1) {
                              const [currentItem, currentDatabase] = await Promise.all([
                                service.getItem(selectedItem.id),
                                service.getDatabase(selectedItem.id),
                              ]);
                              if (
                                currentItem === null ||
                                currentDatabase === null ||
                                !jsonValuesEqual(
                                  currentDatabase.definition,
                                  previousDatabase.definition,
                                )
                              ) {
                                const error: SafeError = {
                                  code: "database.definition-conflict",
                                  title: DATABASE_COPY.hierarchy.schemaChanged,
                                };
                                rollbackOptimisticDefinition();
                                setProblem(error);
                                throw new Error(error.title);
                              }
                              const body = {
                                baseRevisionId: currentItem.currentRevisionId,
                                definition,
                                ...(confirmation === undefined
                                  ? {}
                                  : { impactConfirmation: confirmation }),
                              } as unknown as ReplaceDefinitionRequestDto;
                              const result = await service.replaceDatabaseDefinition(
                                selectedItem.id,
                                body,
                              );
                              if (result.ok) {
                                let syncState = await service.synchronize();
                                for (let pass = 0; pass < 3; pass += 1) {
                                  if (
                                    syncState === "conflict" ||
                                    syncState === "offline" ||
                                    (await service.outbox.pending()).length === 0
                                  ) {
                                    break;
                                  }
                                  syncState = await service.synchronize();
                                }
                                if (syncState === "conflict") {
                                  const error: SafeError = {
                                    code: "database.definition-conflict",
                                    title: DATABASE_COPY.hierarchy.viewChanged,
                                  };
                                  rollbackOptimisticDefinition();
                                  setProblem(error);
                                  throw new Error(error.title);
                                }
                                const [updatedItem, updatedDatabase] = await Promise.all([
                                  service.getItem(selectedItem.id),
                                  service.getDatabase(selectedItem.id),
                                ]);
                                if (updatedItem !== null && updatedDatabase !== null) {
                                  const refreshed = {
                                    databaseId: selectedItem.id,
                                    definitionRevisionId: updatedItem.currentRevisionId,
                                    lifecycle: updatedItem.lifecycle,
                                    name: updatedItem.name,
                                    definition: updatedDatabase.definition,
                                  } as unknown as DatabaseDto;
                                  setSelectedDatabase((current) =>
                                    current !== null &&
                                    jsonValuesEqual(current.definition, definition)
                                      ? refreshed
                                      : current,
                                  );
                                }
                                if (
                                  optimisticDatabaseDefinition.current?.databaseId ===
                                    selectedItem.id &&
                                  jsonValuesEqual(
                                    optimisticDatabaseDefinition.current.definition,
                                    definition,
                                  )
                                ) {
                                  optimisticDatabaseDefinition.current = null;
                                }
                                return;
                              }
                              if (result.error.code !== "revision.stale-base") {
                                rollbackOptimisticDefinition();
                                setProblem(result.error);
                                throw new Error(result.error.title);
                              }
                            }
                            const error: SafeError = {
                              code: "revision.stale-base",
                              title: DATABASE_COPY.hierarchy.propertySaveChanged,
                            };
                            rollbackOptimisticDefinition();
                            setProblem(error);
                            throw new Error(error.title);
                          };
                          const queued = definitionMutationQueue.current.then(operation, operation);
                          definitionMutationQueue.current = queued.catch(() => undefined);
                          return queued;
                        }}
                        onCreateEntry={async (title, initialValues = {}, initialRelations = {}) => {
                          const id = generateUuidV7();
                          const result = await service.createDatabaseEntry(selectedItem.id, {
                            id,
                            title,
                            document: {
                              format: "myownnotion.document+json",
                              formatVersion: 1,
                              body: {},
                            },
                            values: initialValues,
                            relationTargets: Object.fromEntries(
                              Object.entries(initialRelations).map(([id, targets]) => [
                                id,
                                [...targets],
                              ]),
                            ),
                          });
                          if (!result.ok) {
                            setProblem(result.error);
                            throw new Error(result.error.title);
                          }
                          setExpanded((current) => new Set(current).add(selectedItem.id));
                          return id;
                        }}
                        onQueryView={querySelectedDatabaseView}
                        onUpdateEntry={updateSelectedDatabaseEntry}
                        relationOptions={items
                          .filter((item) => item.kind === "page" && item.lifecycle === "active")
                          .map((item) => ({ id: item.id, label: item.name }))}
                        returnFocusEntryId={entryReturnFocusId}
                        onReturnFocusRestored={clearEntryReturnFocus}
                        onOpenEntry={openSelectedDatabaseEntry}
                      />
                    ) : null}
                  </>
                ) : null}
                {pageEditorSessionIds.map((pageId) => {
                  const sessionIsActive =
                    selectedItem !== null &&
                    selectedItem.kind === "page" &&
                    !showSelectedEntry &&
                    !showSelectedDatabase &&
                    !holdStructuredCanvasBody &&
                    pageId === selectedItem.id;
                  return (
                    <div
                      key={pageId}
                      className="workspace-page-session"
                      data-testid={sessionIsActive ? "workspace-page-session-active" : undefined}
                      hidden={!sessionIsActive}
                      inert={sessionIsActive ? undefined : true}
                    >
                      <WorkspacePageEditor
                        service={service}
                        itemId={pageId as Uuid}
                        items={items}
                        createPage={createSubpage}
                        createFolder={createSubfolder}
                        createDatabase={createDatabaseChild}
                        initialScrollAnchor={
                          presentationRef.current === null
                            ? null
                            : scrollAnchorFor(presentationRef.current, pageId as Uuid)
                        }
                        onCaptureScrollAnchor={onCaptureScrollAnchor}
                        onOpenPage={openPageLink}
                        discoverable={sessionIsActive && active}
                      />
                      <PageDatabases
                        active={sessionIsActive}
                        service={service}
                        hostPageId={pageId as Uuid}
                        onOpenEntry={(entryId, embeddingId, visibleEntry, definition) => {
                          linkedEntryOrigin.current = {
                            hostPageId: pageId as Uuid,
                            embeddingId,
                            entryId,
                            returning: false,
                          };
                          structuredKindByItemId.current.set(entryId, "entry");
                          if (visibleEntry !== undefined) {
                            // Use the same already-visible canonical projection as
                            // the standalone database, while hydration continues.
                            remotelyOpenedEntry.current = { entry: visibleEntry, definition };
                            setSelectedEntry(visibleEntry);
                            setEntryDefinition(definition);
                            structuredSelectionItemId.current = entryId;
                          }
                          selectItemById(entryId);
                        }}
                        returnFocus={
                          sessionIsActive &&
                          linkedEntryOrigin.current?.returning === true &&
                          linkedEntryOrigin.current.hostPageId === pageId
                            ? linkedEntryOrigin.current
                            : null
                        }
                        onReturnFocusRestored={() => {
                          linkedEntryOrigin.current = null;
                        }}
                        relationOptions={items
                          .filter((item) => item.kind === "page" && item.lifecycle === "active")
                          .map((item) => ({ id: item.id, label: item.name }))}
                      />
                    </div>
                  );
                })}
              </article>
            ) : null}

            {selectedItem !== null &&
            selectedEntry !== null &&
            selectedEntry.entryId === selectedItem.id &&
            entryDefinition !== null ? (
              <article
                className="workspace-page-canvas workspace-entry-canvas"
                data-testid="workspace-entry-canvas"
              >
                <EntryPanel
                  key={selectedItem.id}
                  entry={selectedEntry}
                  valuesAvailable={selectedEntry.valuesAvailable ?? true}
                  definition={entryDefinition}
                  renderHeader={(onClose) => (
                    <PageTitleEditor
                      key={`title-${selectedItem.id}`}
                      {...titleEditingProps(
                        selectedItem.id,
                        selectedItem.name,
                        selectedItem.kind === "folder" ? "folder" : "page",
                      )}
                      kind={selectedItem.kind === "folder" ? "folder" : "page"}
                      holdsContent={pageHoldsTreeContent(selectedItem)}
                      discoverable={graphScope === null}
                      breadcrumbs={
                        <PathBreadcrumbs path={pathCrumbs} onOpen={(id) => openItem(id as Uuid)} />
                      }
                      pathActions={
                        <>
                          <Button
                            size="compact"
                            variant="ghost"
                            aria-label={DATABASE_COPY.entry.close}
                            title={DATABASE_COPY.entry.close}
                            onClick={onClose}
                          >
                            <AppIcon name="arrowLeft" size="small" />
                            <span className="workspace-page-title__return-label">
                              {DATABASE_COPY.entry.close}
                            </span>
                          </Button>
                          <Button
                            size="compact"
                            variant="ghost"
                            className="workspace-page-title__graph"
                            aria-label="Voir les relations"
                            title="Voir les relations"
                            onClick={() => onOpenGraph(selectedItem.id)}
                          >
                            <AppIcon name="graph" size="small" />
                            <span className="workspace-page-title__graph-label">
                              Voir les relations
                            </span>
                          </Button>
                        </>
                      }
                      icon={selectedItem.icon}
                      title={selectedItem.name}
                      onIconChange={(icon) => void changeItemIcon(selectedItem.id, icon)}
                      onMoveToContent={() =>
                        document
                          .querySelector<HTMLElement>(".workspace-entry-canvas .ProseMirror")
                          ?.focus()
                      }
                    />
                  )}
                  {...(entryDraftSessions.current.has(selectedItem.id)
                    ? {
                        initialDrafts: entryDraftSessions.current.get(
                          selectedItem.id,
                        ) as EntryDrafts,
                      }
                    : {})}
                  onDraftsChange={(drafts) => {
                    if (Object.keys(drafts).length === 0)
                      entryDraftSessions.current.delete(selectedItem.id);
                    else entryDraftSessions.current.set(selectedItem.id, drafts);
                  }}
                  relationOptions={items
                    .filter((item) => item.kind === "page" && item.lifecycle === "active")
                    .map((item) => ({ id: item.id, label: item.name }))}
                  onSaveValues={(values, relationTargets, changes) =>
                    saveEntryPropertyChanges(
                      service,
                      selectedEntry.databaseId as Uuid,
                      selectedItem.id,
                      values,
                      relationTargets,
                      changes,
                    )
                  }
                  onEditDefinition={(edit, confirmed) =>
                    editEntrySourceDefinition(
                      service,
                      (selectedEntry.sourceId ?? selectedEntry.databaseId) as Uuid,
                      edit,
                      confirmed,
                    )
                  }
                  onClose={() => {
                    // Request restoration on return, not while the source view
                    // is still mounted during the outward navigation.
                    setEntryReturnFocusId(selectedEntry.entryId as Uuid);
                    const databaseId = selectedEntry.databaseId as Uuid;
                    const visibleIds = new Set(items.map((item) => item.id));
                    const origin =
                      linkedEntryOrigin.current?.entryId === selectedEntry.entryId &&
                      visibleIds.has(linkedEntryOrigin.current.hostPageId)
                        ? linkedEntryOrigin.current
                        : null;
                    linkedEntryOrigin.current =
                      origin === null ? null : { ...origin, returning: true };
                    const hostPageId =
                      origin?.hostPageId ??
                      (databaseEntryOrigin.current?.entryId === selectedEntry.entryId &&
                      visibleIds.has(databaseEntryOrigin.current.containerItemId)
                        ? databaseEntryOrigin.current.containerItemId
                        : null) ??
                      databaseEmbeddings(entryDefinition).find(
                        (embedding) =>
                          embedding.state === "active" && visibleIds.has(embedding.hostPageId),
                      )?.hostPageId ??
                      (visibleIds.has(databaseId) ? databaseId : null);
                    databaseEntryOrigin.current = null;
                    selectItemById(hostPageId, { replace: true });
                    remotelyOpenedEntry.current = null;
                  }}
                  pageContent={
                    selectedItem.kind === "folder" ? (
                      <FolderChildrenList
                        folderName={selectedItem.name}
                        items={folderChildren}
                        onOpen={(id) => openItem(id as Uuid)}
                        onReorder={(request) =>
                          handleTreeDrop({
                            kind: "place",
                            itemId: request.itemId,
                            targetId: request.targetId,
                            parentId: selectedItem.id,
                            edge: request.edge,
                          })
                        }
                      />
                    ) : (
                      <WorkspacePageEditor
                        service={service}
                        itemId={selectedItem.id}
                        items={items}
                        createPage={createSubpage}
                        createFolder={createSubfolder}
                        createDatabase={createDatabaseChild}
                        onOpenPage={openPageLink}
                        initialScrollAnchor={
                          presentationRef.current === null
                            ? null
                            : scrollAnchorFor(presentationRef.current, selectedItem.id)
                        }
                        onCaptureScrollAnchor={onCaptureScrollAnchor}
                      />
                    )
                  }
                />
              </article>
            ) : null}

            {selectedItem !== null && selectedItem.kind === "folder" && !showSelectedEntry ? (
              <article
                className="workspace-page-canvas workspace-folder-canvas"
                data-testid="workspace-folder-canvas"
              >
                <PageTitleEditor
                  key={`title-${selectedItem.id}`}
                  {...titleEditingProps(selectedItem.id, selectedItem.name, "folder")}
                  discoverable={graphScope === null}
                  breadcrumbs={
                    <PathBreadcrumbs path={pathCrumbs} onOpen={(id) => openItem(id as Uuid)} />
                  }
                  pathActions={
                    <Button
                      size="compact"
                      variant="ghost"
                      className="workspace-page-title__graph"
                      data-testid="open-local-graph"
                      title="Voir les relations"
                      onClick={() => onOpenGraph(selectedItem.id)}
                    >
                      <AppIcon name="graph" size="small" />
                      <span className="workspace-page-title__graph-label">Voir les relations</span>
                    </Button>
                  }
                  kind="folder"
                  kindActions={
                    <FolderInlineCreate
                      folderName={selectedItem.name}
                      onCreate={(kind) => void createItem(kind, selectedItem.id)}
                    />
                  }
                  icon={selectedItem.icon}
                  title={selectedItem.name}
                  onIconChange={(icon) => void changeItemIcon(selectedItem.id, icon)}
                />
                {projectionComplete || folderChildren.length > 0 ? (
                  <FolderChildrenList
                    folderName={selectedItem.name}
                    items={folderChildren}
                    onOpen={(id) => openItem(id as Uuid)}
                    onReorder={(request) =>
                      handleTreeDrop({
                        kind: "place",
                        itemId: request.itemId,
                        targetId: request.targetId,
                        parentId: selectedItem.id,
                        edge: request.edge,
                      })
                    }
                  />
                ) : null}
                {!projectionComplete ? (
                  <BranchState kind={discoveryState} containerKind="folder" />
                ) : null}
              </article>
            ) : null}
          </div>
        </>
      )}
    </WorkspaceShell>
  );
}
