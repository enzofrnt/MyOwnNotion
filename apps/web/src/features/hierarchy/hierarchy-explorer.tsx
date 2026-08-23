/**
 * Accessible offline-first hierarchy explorer (T033 US1 + T045/T046 US6).
 *
 * Reads come from the durable local projection; every mutation is applied
 * optimistically with a durable outbox entry and then synchronized. The
 * tree is a semantic ARIA tree with complete keyboard operation, and
 * loading, empty, offline, error, and conflict states are explicit.
 */

import {
  DEFAULT_SIDEBAR_WIDTH,
  normalizeWorkspacePresentationState,
  type PageScrollAnchor,
  type ProjectedItem,
  readNavigationState,
  rememberScrollAnchor,
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
  generateUuidV7,
  isUuid,
  jsonValuesEqual,
  type SafeError,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncStatus } from "../../components/sync-status.tsx";
import { DatabaseViewService } from "../../services/databases.ts";
import { localContent } from "../../services/local-content.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { WorkspaceSearchService } from "../../services/search.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button, Field } from "../../ui/primitives/index.ts";
import { AttachmentPanel } from "../attachments/attachment-panel.tsx";
import { CreateDatabaseForm } from "../databases/create-database-form.tsx";
import { DatabaseConflictResolution } from "../databases/database-conflict-resolution.tsx";
import { DATABASE_COPY } from "../databases/database-copy.ts";
import { DatabasePage, type DefinitionConfirmation } from "../databases/database-page.tsx";
import { EntryPanel } from "../databases/entry-panel.tsx";
import type { DatabaseCellUpdate } from "../databases/table-view.tsx";
import { EditorView } from "../editor/editor-view.tsx";
import { StoragePanel } from "../files/storage-panel.tsx";
import { RevisionRestore } from "../history/revision-restore.tsx";
import { BranchState } from "../navigation/branch-state.tsx";
import { ConvertItemControl, type ConvertibleKind } from "../navigation/convert-item.tsx";
import { NavigationItemMenu } from "../navigation/navigation-item-menu.tsx";
import { Sidebar } from "../navigation/sidebar.tsx";
import {
  TreeDragDropProvider,
  TreeDragHandle,
  type TreeDragItem,
  type TreeDropIntent,
  TreeDropTarget,
} from "../navigation/tree-drag-drop.tsx";
import { useTreeKeyboard } from "../navigation/use-tree-keyboard.ts";
import { isSearchShortcut, SearchDialog } from "../search/search-dialog.tsx";
import type { SearchBranchOption } from "../search/search-filters.tsx";
import { PageHeader } from "../workspace/page-header.tsx";
import { useActiveItem } from "../workspace/use-active-item.ts";
import { WorkspaceShell } from "../workspace/workspace-shell.tsx";
import { WorkspaceState } from "../workspace/workspace-state.tsx";
import { FileNode } from "./file-node.tsx";
import { ItemDetails } from "./item-details.tsx";
import { MutationStatus } from "./mutation-status.tsx";

type LoadState = "loading" | "ready";
type LoadPhase = "initializing" | "reading-local" | "seeding" | "navigation" | "refreshing";

interface TreeNode {
  readonly item: ProjectedItem;
  readonly placementId: Uuid;
  readonly positionKey: string;
  readonly children: TreeNode[];
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
function isBranch(node: TreeNode): boolean {
  return node.item.kind === "folder" || node.children.length > 0;
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

export function HierarchyExplorer({
  backupStale,
  pageOperationCsrfToken,
  onOpenBackups,
  onOpenSettings,
}: {
  readonly backupStale: boolean;
  readonly pageOperationCsrfToken: () => string | null;
  readonly onOpenBackups: () => void;
  /** Settings live outside the workspace, so the shortcut asks rather than routes. */
  readonly onOpenSettings: () => void;
}) {
  const service = useMemo(() => {
    const content = localContent();
    content.configurePageOperationAuthorization(pageOperationCsrfToken);
    return content;
  }, [pageOperationCsrfToken]);
  const databaseViews = useMemo(() => new DatabaseViewService(service), [service]);
  const [search, setSearch] = useState<WorkspaceSearchService | null>(null);
  const [items, setItems] = useState<ProjectedItem[]>([]);
  const [trashedItems, setTrashedItems] = useState<ProjectedItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("initializing");
  const [problem, setProblem] = useState<SafeError | null>(null);
  const [selectedId, setSelectedId] = useState<Uuid | null>(null);
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
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseDto | null>(null);
  const [databaseEntries, setDatabaseEntries] = useState<readonly DatabaseEntryDto[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<DatabaseEntryDto | null>(null);
  const [entryDefinition, setEntryDefinition] = useState<DatabaseDefinition | null>(null);
  const [structuredSelectionLoading, setStructuredSelectionLoading] = useState(false);
  const structuredSelectionItemId = useRef<Uuid | null>(null);
  const definitionMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const optimisticDatabaseDefinition = useRef<{
    readonly databaseId: Uuid;
    readonly definition: DatabaseDefinition;
  } | null>(null);
  const [entryReturnFocusId, setEntryReturnFocusId] = useState<Uuid | null>(null);
  const remotelyOpenedEntry = useRef<{
    readonly entry: DatabaseEntryDto;
    readonly definition: DatabaseDefinition;
  } | null>(null);
  const [databaseFormParent, setDatabaseFormParent] = useState<Uuid | null | undefined>(undefined);
  // Which branches are open. Everything was permanently expanded before US3,
  // which is workable at ten items and unusable at a hundred.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Guards the persistence effect below. Without it that effect can fire before
  // the stored state has been read and write the empty set back, erasing every
  // open branch on the way in.
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchReturnFocus = useRef<HTMLElement | null>(null);

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
    setSearchOpen(false);
    queueMicrotask(() => {
      const previous = searchReturnFocus.current;
      // A resize can replace the desktop sidebar with the mobile trigger while
      // search is open. In that case the original control is detached, so
      // returning focus to it would silently leave focus on the document body.
      const target =
        previous?.isConnected === true && previous.getClientRects().length > 0
          ? previous
          : document.querySelector<HTMLElement>('[data-testid="toggle-tree"]');
      target?.focus();
    });
  }, []);

  const openItem = useCallback((itemId: Uuid) => {
    setSelectedId(itemId);
    setMobileNavigationOpen(false);
  }, []);

  const openDatabaseCreation = useCallback((parentItemId: Uuid | null) => {
    setDatabaseFormParent(parentItemId);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isSearchShortcut(event) && !searchOpen) {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSearch, searchOpen]);

  useEffect(() => {
    const nextSearch = new WorkspaceSearchService(service);
    setSearch(nextSearch);
    return () => {
      void nextSearch.dispose();
    };
  }, [service]);

  useEffect(() => () => databaseViews.dispose(), [databaseViews]);

  const refresh = useCallback(async (): Promise<ProjectedItem[]> => {
    const generation = ++refreshGeneration.current;
    const [activeItems, trash] = await Promise.all([
      service.listActiveItems(),
      service.listTrashedItems(),
    ]);
    // Local writes and synchronization can notify almost simultaneously. An
    // older IndexedDB read must never replace the projection produced by a
    // newer refresh: doing so can briefly remove the selected entry and
    // remount its form, discarding an unsaved property draft.
    if (generation === refreshGeneration.current) {
      setItems(activeItems);
      setTrashedItems(trash);
    }
    return activeItems;
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadPhase("initializing");
      await service.initialize();
      // First boot on this device: seed the projection when reachable.
      setLoadPhase("reading-local");
      if ((await service.listActiveItems()).length === 0) {
        setLoadPhase("seeding");
        await service.seedFromServer();
      }
      // Which branches were open is device ergonomics, not content: it lives
      // in the local projection and never syncs. Restoring it is what makes
      // returning to the workspace feel like returning (FR-014).
      setLoadPhase("navigation");
      const navigation = await readNavigationState(service.db);
      if (cancelled) {
        return;
      }
      setExpanded(new Set(navigation.expandedItemIds));
      setSidebarOpen(navigation.sidebarOpen);
      setSidebarWidth(navigation.sidebarWidth);
      presentationRef.current = navigation;
      setNavigationLoaded(true);
      setLoadPhase("refreshing");
      const activeItems = await refresh();
      if (!cancelled) {
        setSelectedId(
          navigation.lastVisitedItemId !== null &&
            activeItems.some((item) => item.id === navigation.lastVisitedItemId)
            ? (navigation.lastVisitedItemId as Uuid)
            : null,
        );
        // Subscription notifications can refresh the projection while the
        // service initializes. The workspace must not become interactive until
        // navigation hydration has also completed, or that late hydration can
        // collapse a branch the owner has just opened.
        setLoadState("ready");
      }
    })();
    const unsubscribe = service.subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service, refresh]);

  useEffect(() => {
    // Written on change rather than on unload: a tab closed abruptly never
    // reaches an unload handler, and losing the tree state that way is exactly
    // the case worth surviving.
    if (!navigationLoaded) {
      return;
    }
    void (async () => {
      await updateWorkspacePresentationState(service.db, (current) => ({
        ...current,
        sidebarOpen,
        sidebarWidth,
        expandedItemIds: [...expanded],
        lastVisitedItemId: selectedId,
      }));
    })();
  }, [service, expanded, selectedId, navigationLoaded, sidebarOpen, sidebarWidth]);

  const tree = useMemo(() => buildTree(items), [items]);
  const searchBranches = useMemo(() => searchBranchOptions(tree), [tree]);
  const visibleNodes = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const allNodes = useMemo(() => flattenAll(tree), [tree]);
  const draggableTreeItems = useMemo(() => treeDragItems(tree), [tree]);
  const { item: selectedItem, path: activePath } = useActiveItem(items, selectedId);

  useEffect(() => {
    let cancelled = false;
    const clearStructuredSelection = (): void => {
      setSelectedDatabase(null);
      setDatabaseEntries([]);
      setSelectedEntry(null);
      setEntryDefinition(null);
    };
    if (selectedItem === null || selectedItem.kind !== "page") {
      clearStructuredSelection();
      structuredSelectionItemId.current = null;
      setStructuredSelectionLoading(false);
      return;
    }

    if (structuredSelectionItemId.current !== selectedItem.id) {
      setStructuredSelectionLoading(true);
    }
    void (async () => {
      const databaseRow = await service.getDatabase(selectedItem.id);
      if (cancelled) return;
      if (databaseRow !== null) {
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
                  revisionId: item.currentRevisionId,
                  lifecycle: item.lifecycle,
                  title: item.name,
                  document: item.pageDocument,
                  values: row.values.values,
                  relationTargets,
                } as unknown as DatabaseEntryDto);
          }),
        );
        if (cancelled) return;
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
        setDatabaseEntries(entries.filter((entry): entry is DatabaseEntryDto => entry !== null));
        setSelectedEntry(null);
        setEntryDefinition(null);
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }

      const entryRow = await service.getDatabaseEntry(selectedItem.id);
      if (entryRow === null) {
        const remoteDatabase = await service.api.getDatabase(selectedItem.id);
        if (cancelled) return;
        if (remoteDatabase.ok) {
          setSelectedDatabase(remoteDatabase.value);
          setDatabaseEntries([]);
          setSelectedEntry(null);
          setEntryDefinition(null);
          structuredSelectionItemId.current = selectedItem.id;
          setStructuredSelectionLoading(false);
          return;
        }
        const remoteEntry = remotelyOpenedEntry.current;
        if (remoteEntry?.entry.entryId === selectedItem.id) {
          setSelectedDatabase(null);
          setDatabaseEntries([]);
          setSelectedEntry(remoteEntry.entry);
          setEntryDefinition(remoteEntry.definition);
          structuredSelectionItemId.current = selectedItem.id;
          setStructuredSelectionLoading(false);
          return;
        }
        clearStructuredSelection();
        structuredSelectionItemId.current = selectedItem.id;
        setStructuredSelectionLoading(false);
        return;
      }
      const [ownerDatabase, relationTargets] = await Promise.all([
        service.getDatabase(entryRow.databaseId),
        service.getDatabaseEntryRelationTargets(entryRow.databaseId, selectedItem.id),
      ]);
      if (cancelled) return;
      if (ownerDatabase === null) {
        clearStructuredSelection();
        setStructuredSelectionLoading(false);
        return;
      }
      setSelectedDatabase(null);
      setDatabaseEntries([]);
      setSelectedEntry({
        databaseId: entryRow.databaseId,
        entryId: selectedItem.id,
        revisionId: selectedItem.currentRevisionId,
        lifecycle: selectedItem.lifecycle,
        title: selectedItem.name,
        document: selectedItem.pageDocument,
        values: entryRow.values.values,
        relationTargets,
      } as unknown as DatabaseEntryDto);
      setEntryDefinition(ownerDatabase.definition);
      structuredSelectionItemId.current = selectedItem.id;
      setStructuredSelectionLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [service, selectedItem]);

  const openPageLink = useCallback(
    (rawItemId: string) => {
      setProblem(null);
      if (!isUuid(rawItemId)) {
        setProblem({
          code: "validation.invalid-identifier",
          title: "The internal page link has an invalid target identity",
        });
        return;
      }
      if (items.some((item) => item.id === rawItemId)) {
        setSelectedId(rawItemId);
        return;
      }
      if (trashedItems.some((item) => item.id === rawItemId)) {
        setProblem({
          code: "item.not-active",
          title: "This internal page link points to an item in the trash",
        });
        return;
      }
      setProblem({
        code: "item.not-found",
        title: "This internal page link target is unavailable on this device",
      });
    },
    [items, trashedItems],
  );

  const selectedDatabaseId = selectedDatabase?.databaseId as Uuid | undefined;
  const querySelectedDatabaseView = useCallback(
    async (viewId: Uuid) => {
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
        const values = { ...currentEntry.values.values };
        const relationTargets = { ...currentRelations };
        if (update.relationTargets !== undefined) {
          relationTargets[update.propertyId] = update.relationTargets;
          delete values[update.propertyId];
        } else {
          delete relationTargets[update.propertyId];
          if (update.value === undefined) delete values[update.propertyId];
          else values[update.propertyId] = update.value;
        }
        const result = await service.replaceDatabaseEntryValues(databaseId, entryId, {
          baseRevisionId: currentItem.currentRevisionId,
          values,
          relationTargets,
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
      setEntryReturnFocusId(entryId);
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
        setSelectedId(entryId);
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
        setSelectedId(entryId);
      })();
    },
    [databaseEntries, selectedDatabase, service],
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
    },
    [service, refresh],
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

  const trashItem = useCallback(
    async (node: TreeNode, confirmOrdinaryItem = false) => {
      const impact = await service.previewTrashImpact(node.item.id);
      if (impact.isDatabase) {
        const message = DATABASE_COPY.hierarchy.trashImpact(
          node.item.name,
          impact.activeEntryCount,
        );
        if (!window.confirm(message)) return;
      } else if (confirmOrdinaryItem && !window.confirm(`Move “${node.item.name}” to the trash?`)) {
        return;
      }
      await runCommand("item.trash", { itemId: node.item.id }, [node.item.currentRevisionId]);
    },
    [runCommand, service],
  );

  const createItem = useCallback(
    async (kind: "page" | "folder", parentItemId: Uuid | null) => {
      const name = newItemName.trim() || (kind === "page" ? "Untitled page" : "Untitled folder");
      // Cleared before the write, not after it. The name is already captured
      // above, and clearing afterwards means the field is emptied whenever the
      // mutation happens to finish — including after the owner has started
      // typing the next name, which then vanishes as they type it. It showed up
      // as an intermittent WebKit failure where an item arrived called
      // "Untitled page": the clear from the previous creation had landed
      // between the test filling the field and clicking the button.
      setNewItemName("");
      const keys = siblingKeys(parentItemId);
      const positionKey = safeKeyBetween(keys[keys.length - 1] ?? null, null);
      await runCommand("item.create", {
        id: generateUuidV7(),
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
      if (parentItemId !== null) {
        // Open the branch we just put something into. Creating a page inside a
        // collapsed folder and being shown nothing is indistinguishable from
        // the creation having failed.
        setExpanded((current) => new Set(current).add(parentItemId));
      }
    },
    [newItemName, runCommand, siblingKeys],
  );

  const createDatabase = useCallback(
    async (request: Parameters<typeof service.createDatabase>[0]) => {
      setProblem(null);
      const result = await service.createDatabase(request);
      if (!result.ok) {
        setProblem(result.error);
        throw new Error(result.error.title);
      }
      setDatabaseFormParent(undefined);
      setSelectedId(request.id as Uuid);
      setMobileNavigationOpen(false);
      if (request.placement.parentItemId !== null) {
        setExpanded((current) => new Set(current).add(request.placement.parentItemId as Uuid));
      }
      await refresh();
    },
    [service, refresh],
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
      await refresh();
      if (result.ok) {
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
        hasChildren: isBranch(node),
        expanded: expanded.has(node.item.id),
        parentId:
          node.item.placements.find((entry) => entry.kind === "hierarchy")?.parentItemId ?? null,
      })),
    [visibleNodes, expanded],
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
      setSelectedId(id as Uuid);
    },
    setExpanded: toggleBranch,
    open: (id: string) => openItem(id as Uuid),
    rename: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined) {
        void renameItem(node);
      }
    },
    remove: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined) void trashItem(node, true);
    },
  });

  const renderNode = (node: TreeNode, level: number): React.ReactElement => {
    const isSelected = selectedId === node.item.id;
    const parentPlacement = node.item.placements.find((entry) => entry.kind === "hierarchy");
    const parentId = parentPlacement?.parentItemId ?? null;
    return (
      <li key={node.item.id} role="none">
        <TreeDropTarget itemId={node.item.id}>
          {({ isDropTarget, setNodeRef }) => (
            /* biome-ignore lint/a11y/useKeyWithClickEvents: the ARIA tree pattern
               puts one handler on the tree, not one per row. A row-level handler
               would need every row in the tab order to receive its own key events,
               which is the arrangement the pattern exists to avoid. Keyboard
               operation is covered by useTreeKeyboard on the container and
               asserted in keyboard-navigation.spec.ts. */
            <div
              ref={setNodeRef}
              role="treeitem"
              aria-level={level}
              aria-selected={isSelected}
              {...(isBranch(node) ? { "aria-expanded": expanded.has(node.item.id) } : {})}
              tabIndex={isSelected || (selectedId === null && level === 1) ? 0 : -1}
              className="tree-row"
              data-testid={`tree-item-${node.item.name}`}
              data-item-id={node.item.id}
              data-drop-target={isDropTarget || undefined}
              onClick={() => openItem(node.item.id)}
            >
              <TreeDragHandle itemId={node.item.id} itemName={node.item.name} />
              {isBranch(node) ? (
                <button
                  type="button"
                  className="tree-twisty"
                  aria-label={
                    expanded.has(node.item.id)
                      ? `Collapse ${node.item.name}`
                      : `Expand ${node.item.name}`
                  }
                  data-testid={`toggle-${node.item.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleBranch(node.item.id, !expanded.has(node.item.id));
                  }}
                >
                  {expanded.has(node.item.id) ? "▾" : "▸"}
                </button>
              ) : (
                // Reserves the same width so names line up whether or not a row has
                // children; hidden from assistive technology because it says
                // nothing.
                <span className="tree-twisty tree-twisty--leaf" aria-hidden="true" />
              )}
              <span className="tree-kind">{node.item.kind}</span>
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
              <NavigationItemMenu
                itemName={node.item.name}
                canContainChildren={node.item.kind !== "file"}
                canMoveToRoot={parentId !== null}
                canMoveSelectedInside={selectedId !== null && selectedId !== node.item.id}
                favourite={node.item.favourite}
                keptOffline={node.item.offlineIntent}
                conversion={
                  node.item.kind === "file" ? undefined : (
                    <ConvertItemControl
                      itemId={node.item.id}
                      itemName={node.item.name}
                      kind={node.item.kind as ConvertibleKind}
                      convert={convertItem}
                    />
                  )
                }
                onCreatePage={() => void createItem("page", node.item.id)}
                onCreateFolder={() => void createItem("folder", node.item.id)}
                onCreateDatabase={() => openDatabaseCreation(node.item.id)}
                onRename={() => void renameItem(node)}
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
                onTrash={() => void trashItem(node)}
              />
            </div>
          )}
        </TreeDropTarget>
        {/* Rendered only when open. Hiding a collapsed branch with CSS would
            leave its rows in the accessibility tree and in the tab order, so a
            screen reader would announce children of a folder the owner has
            closed. */}
        {expanded.has(node.item.id) ? (
          node.children.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: role="group" on ul is the canonical ARIA tree substructure
            <ul role="group">{node.children.map((child) => renderNode(child, level + 1))}</ul>
          ) : (
            // An opened branch with nothing under it says which of the four
            // situations it is in. Blank space reads as "empty" whichever one
            // is true, and the two that are not empty are the ones where being
            // wrong costs something: an owner who reads "not on this device"
            // as "empty" concludes their notes are gone.
            <BranchState
              kind={problem !== null ? "error" : navigator.onLine ? "empty" : "offline"}
            />
          )
        ) : null}
      </li>
    );
  };

  const navigationTree = (
    <div
      id="workspace-tree"
      className="workspace-tree"
      data-open={sidebarOpen}
      data-testid="workspace-tree"
    >
      {loadState === "loading" ? (
        <BranchState kind="loading" />
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
      {databaseFormParent !== undefined ? (
        <CreateDatabaseForm
          parentItemId={databaseFormParent}
          positionKey={safeKeyBetween(siblingKeys(databaseFormParent).at(-1) ?? null, null)}
          onCreate={createDatabase}
        />
      ) : null}
    </div>
  );

  const creationControls = (
    <div className="workspace-navigation__create">
      <Field
        id="new-item-name"
        label="Nom"
        size="compact"
        value={newItemName}
        placeholder="Sans titre"
        onChange={(event) => setNewItemName(event.target.value)}
      />
      <div className="workspace-navigation__create-actions">
        <Button
          size="compact"
          variant="ghost"
          data-testid="new-root-page"
          onClick={() => void createItem("page", null)}
        >
          <AppIcon name="fileText" size="small" />
          Page
        </Button>
        <Button
          size="compact"
          variant="ghost"
          data-testid="new-root-folder"
          onClick={() => void createItem("folder", null)}
        >
          <AppIcon name="folder" size="small" />
          Dossier
        </Button>
        <Button
          size="compact"
          variant="ghost"
          data-testid="new-root-database"
          onClick={() => openDatabaseCreation(null)}
        >
          <AppIcon name="table" size="small" />
          Base
        </Button>
      </div>
    </div>
  );

  return (
    <WorkspaceShell
      mobileNavigationOpen={mobileNavigationOpen}
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
          onOpen={openItem}
          onOpenSettings={() => {
            setMobileNavigationOpen(false);
            onOpenSettings();
          }}
          onOpenBackups={() => {
            setMobileNavigationOpen(false);
            onOpenBackups();
          }}
          onOpenSearch={openSearch}
        />
      }
      header={
        <PageHeader
          title={selectedItem?.name ?? "Bienvenue"}
          kind={selectedItem?.kind ?? "workspace"}
          breadcrumbs={activePath.map((item, index) => ({
            id: item.id,
            label: item.name,
            ...(index === activePath.length - 1 ? {} : { onOpen: () => openItem(item.id) }),
          }))}
          status={<SyncStatus service={service} />}
          actions={
            <>
              <Button
                size="square"
                variant="ghost"
                aria-label="Sauvegardes"
                data-testid="open-backups"
                onClick={onOpenBackups}
              >
                <AppIcon name="archive" />
                <span className="ui-visually-hidden">Sauvegardes</span>
              </Button>
              <Button
                size="square"
                variant="ghost"
                aria-label="Réglages et sécurité"
                data-testid="toggle-security-settings"
                onClick={onOpenSettings}
              >
                <AppIcon name="settings" />
                <span className="ui-visually-hidden">Réglages et sécurité</span>
              </Button>
            </>
          }
        />
      }
    >
      {searchOpen && search !== null ? (
        <SearchDialog
          search={search}
          branches={searchBranches}
          onOpen={(itemId) => openItem(itemId)}
          onClose={closeSearch}
        />
      ) : null}

      {backupStale ? (
        <p
          className="status-banner"
          data-state="error"
          role="alert"
          data-testid="workspace-backup-stale"
        >
          <strong>Aucune sauvegarde vérifiée depuis plus d’un jour.</strong>{" "}
          <Button size="compact" variant="ghost" onClick={onOpenBackups}>
            Vérifier les sauvegardes
          </Button>
        </p>
      ) : null}

      {problem !== null ? (
        <div className="status-banner" data-state="error" role="alert" data-testid="problem-banner">
          <strong>{problem.title}</strong>
          <details>
            <summary>Détails techniques</summary>
            <code>{problem.code}</code>
          </details>
        </div>
      ) : null}

      {loadState === "loading" ? (
        <WorkspaceState kind="loading" phase={loadPhase} />
      ) : selectedItem === null ? (
        <WorkspaceState
          kind="empty"
          detail={
            items.length === 0
              ? "Créez une première page depuis la barre latérale."
              : "Choisissez une page dans la barre latérale pour reprendre votre travail."
          }
        />
      ) : null}

      {loadState === "ready" ? (
        <details className="workspace-diagnostics">
          <summary>État local et stockage</summary>
          <MutationStatus service={service} />
          <StoragePanel service={service} />
        </details>
      ) : null}
      {selectedItem !== null && selectedItem.kind === "page" ? (
        <DatabaseConflictResolution
          service={service}
          itemId={selectedItem.id}
          onResolved={() => void refresh()}
        />
      ) : null}

      {selectedItem !== null && selectedItem.kind === "page" && structuredSelectionLoading ? (
        <p className="loading-state" role="status">
          Opening structured page…
        </p>
      ) : selectedItem !== null &&
        selectedDatabase !== null &&
        selectedDatabase.databaseId === selectedItem.id ? (
        <DatabasePage
          database={selectedDatabase}
          entries={databaseEntries}
          onPreviewDefinitionImpact={async (definition) => {
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
                optimisticDatabaseDefinition.current?.databaseId === selectedItem.id &&
                jsonValuesEqual(optimisticDatabaseDefinition.current.definition, definition)
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
                  !jsonValuesEqual(currentDatabase.definition, previousDatabase.definition)
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
                  ...(confirmation === undefined ? {} : { impactConfirmation: confirmation }),
                } as unknown as ReplaceDefinitionRequestDto;
                const result = await service.replaceDatabaseDefinition(selectedItem.id, body);
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
                      current !== null && jsonValuesEqual(current.definition, definition)
                        ? refreshed
                        : current,
                    );
                  }
                  if (
                    optimisticDatabaseDefinition.current?.databaseId === selectedItem.id &&
                    jsonValuesEqual(optimisticDatabaseDefinition.current.definition, definition)
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
          onCreateEntry={async (title) => {
            const keys = siblingKeys(selectedItem.id);
            const result = await service.createDatabaseEntry(selectedItem.id, {
              id: generateUuidV7(),
              title,
              placement: {
                id: generateUuidV7(),
                parentItemId: selectedItem.id,
                positionKey: safeKeyBetween(keys.at(-1) ?? null, null),
              },
              document: {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: {},
              },
              values: {},
              relationTargets: {},
            });
            if (!result.ok) {
              setProblem(result.error);
              throw new Error(result.error.title);
            }
            setExpanded((current) => new Set(current).add(selectedItem.id));
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
      ) : selectedItem !== null &&
        selectedEntry !== null &&
        selectedEntry.entryId === selectedItem.id &&
        entryDefinition !== null ? (
        <EntryPanel
          entry={selectedEntry}
          definition={entryDefinition}
          relationOptions={items
            .filter((item) => item.kind === "page" && item.lifecycle === "active")
            .map((item) => ({ id: item.id, label: item.name }))}
          onSaveValues={async (values, relationTargets) => {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const [currentItem, currentEntry, currentRelations] = await Promise.all([
                service.getItem(selectedItem.id),
                service.getDatabaseEntry(selectedItem.id),
                service.getDatabaseEntryRelationTargets(
                  selectedEntry.databaseId as Uuid,
                  selectedItem.id,
                ),
              ]);
              if (
                currentItem === null ||
                currentEntry === null ||
                !jsonValuesEqual(currentEntry.values.values, selectedEntry.values) ||
                !jsonValuesEqual(currentRelations, selectedEntry.relationTargets)
              ) {
                const error: SafeError = {
                  code: "database.definition-conflict",
                  title: DATABASE_COPY.hierarchy.entryChanged,
                };
                setProblem(error);
                throw new Error(error.title);
              }
              const result = await service.replaceDatabaseEntryValues(
                selectedEntry.databaseId as Uuid,
                selectedItem.id,
                {
                  baseRevisionId: currentItem.currentRevisionId,
                  values,
                  relationTargets,
                } as unknown as ReplaceEntryValuesRequestDto,
              );
              if (result.ok) return;
              if (result.error.code !== "revision.stale-base") {
                setProblem(result.error);
                throw new Error(result.error.title);
              }
            }
            const error: SafeError = {
              code: "revision.stale-base",
              title: DATABASE_COPY.hierarchy.entrySaveChanged,
            };
            setProblem(error);
            throw new Error(error.title);
          }}
          onClose={() => {
            const databaseId = selectedEntry.databaseId as Uuid;
            const url = new URL(window.location.href);
            url.searchParams.delete("entry");
            window.history.replaceState(window.history.state, "", url);
            setSelectedId(databaseId);
            remotelyOpenedEntry.current = null;
          }}
          pageContent={
            <>
              <EditorView
                service={service}
                itemId={selectedItem.id}
                items={items}
                onOpenPage={openPageLink}
                initialScrollAnchor={
                  presentationRef.current === null
                    ? null
                    : scrollAnchorFor(presentationRef.current, selectedItem.id)
                }
                onCaptureScrollAnchor={onCaptureScrollAnchor}
              />
              <AttachmentPanel
                pageId={selectedItem.id}
                onChanged={() => void refresh()}
                onOpenUsage={(itemId) => openPageLink(itemId)}
              />
            </>
          }
        />
      ) : selectedItem !== null && selectedItem.kind === "page" ? (
        <>
          <EditorView
            key={`page-${selectedItem.id}`}
            service={service}
            itemId={selectedItem.id}
            items={items}
            initialScrollAnchor={
              presentationRef.current === null
                ? null
                : scrollAnchorFor(presentationRef.current, selectedItem.id)
            }
            onCaptureScrollAnchor={onCaptureScrollAnchor}
            onOpenPage={openPageLink}
          />
          <AttachmentPanel
            pageId={selectedItem.id}
            onChanged={() => void refresh()}
            // A usage is only reachable if selecting it actually goes there
            // (FR-005); a list that names pages without opening them leaves the
            // owner to find them by hand. `openPageLink` is the same journey a
            // page link takes, so both arrive the same way.
            onOpenUsage={(itemId) => openPageLink(itemId)}
          />
        </>
      ) : null}
      {selectedItem !== null ? (
        <>
          <ItemDetails item={selectedItem} />
          <RevisionRestore item={selectedItem} onRestored={() => void service.synchronize()} />
        </>
      ) : null}

      {trashedItems.length > 0 ? (
        <section className="panel" aria-label="Trash">
          <h2>Trash (30-day recovery)</h2>
          <ul className="tree">
            {trashedItems.map((item) => (
              <li key={item.id} className="tree-row" data-testid={`trash-item-${item.name}`}>
                <span className="tree-kind">{item.kind}</span>
                <span className="tree-name">{item.name}</span>
                <span className="muted">recoverable until {item.purgeAfter ?? "unknown"}</span>
                <span className="tree-actions">
                  <button
                    type="button"
                    aria-label={`Restore ${item.name}`}
                    onClick={() =>
                      void runCommand("item.restore", { itemId: item.id }, [item.currentRevisionId])
                    }
                  >
                    restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
