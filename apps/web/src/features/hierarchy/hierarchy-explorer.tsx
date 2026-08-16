/**
 * Accessible offline-first hierarchy explorer (T033 US1 + T045/T046 US6).
 *
 * Reads come from the durable local projection; every mutation is applied
 * optimistically with a durable outbox entry and then synchronized. The
 * tree is a semantic ARIA tree with complete keyboard operation, and
 * loading, empty, offline, error, and conflict states are explicit.
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import { readNavigationState, writeNavigationState } from "@myownnotion/client-core";
import { generateUuidV7, type SafeError, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SyncStatus } from "../../components/sync-status.tsx";
import { localContent } from "../../services/local-content.ts";
import { safeKeyBetween } from "../../services/ordering.ts";
import { AttachmentPanel } from "../attachments/attachment-panel.tsx";
import { EditorView } from "../editor/editor-view.tsx";
import { RevisionRestore } from "../history/revision-restore.tsx";
import { BranchState } from "../navigation/branch-state.tsx";
import { ConvertItemControl, type ConvertibleKind } from "../navigation/convert-item.tsx";
import { Sidebar } from "../navigation/sidebar.tsx";
import { useTreeKeyboard } from "../navigation/use-tree-keyboard.ts";
import { FileNode } from "./file-node.tsx";
import { ItemDetails } from "./item-details.tsx";
import { MutationStatus } from "./mutation-status.tsx";

type LoadState = "loading" | "ready";

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

export function HierarchyExplorer({
  onOpenSettings,
}: {
  /** Settings live outside the workspace, so the shortcut asks rather than routes. */
  readonly onOpenSettings: () => void;
}) {
  const service = useMemo(() => localContent(), []);
  const [items, setItems] = useState<ProjectedItem[]>([]);
  const [trashedItems, setTrashedItems] = useState<ProjectedItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [problem, setProblem] = useState<SafeError | null>(null);
  const [selectedId, setSelectedId] = useState<Uuid | null>(null);
  // Which branches are open. Everything was permanently expanded before US3,
  // which is workable at ten items and unusable at a hundred.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Guards the persistence effect below. Without it that effect can fire before
  // the stored state has been read — a subscription refresh flips `loadState`
  // to ready while `expanded` is still empty — and write the empty set back,
  // erasing every open branch on the way in.
  const [navigationLoaded, setNavigationLoaded] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  /**
   * Whether the tree is showing at narrow widths.
   *
   * Open by default: an owner who lands on the workspace should see what is in
   * it. The control only appears below the breakpoint, so on a desktop this
   * state is set and never read.
   */
  const [treeOpen, setTreeOpen] = useState(true);
  const treeToggle = useRef<HTMLButtonElement | null>(null);
  // Held in a ref so the key listener does not have to be rebound whenever the
  // callback identity changes.
  const closeTreeRef = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    setItems(await service.listActiveItems());
    setTrashedItems(await service.listTrashedItems());
    setLoadState("ready");
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await service.initialize();
      // First boot on this device: seed the projection when reachable.
      if ((await service.listActiveItems()).length === 0) {
        await service.seedFromServer();
      }
      if (!cancelled) {
        // Which branches were open is device ergonomics, not content: it lives
        // in the local projection and never syncs. Restoring it is what makes
        // returning to the workspace feel like returning (FR-014).
        const navigation = await readNavigationState(service.db);
        setExpanded(new Set(navigation.expandedItemIds));
        setNavigationLoaded(true);
        await refresh();
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
      const current = await readNavigationState(service.db);
      await writeNavigationState(service.db, {
        ...current,
        expandedItemIds: [...expanded],
        lastVisitedItemId: selectedId,
      });
    })();
  }, [service, expanded, selectedId, navigationLoaded]);

  const tree = useMemo(() => buildTree(items), [items]);
  const visibleNodes = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

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
      const siblings = visibleNodes
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
    [runCommand, visibleNodes],
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
    open: (id: string) => setSelectedId(id as Uuid),
    rename: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined) {
        void renameItem(node);
      }
    },
    remove: (id: string) => {
      const node = visibleNodes.find((entry) => entry.item.id === id);
      if (node !== undefined && window.confirm(`Move “${node.item.name}” to the trash?`)) {
        void runCommand("item.trash", { itemId: node.item.id });
      }
    },
  });

  useEffect(() => {
    // Escape is bound to the document rather than to the container, and not
    // only because a plain <div> with a key handler is a lint error: the owner
    // may have tabbed out of the tree into the editor, and the panel still
    // needs to close from wherever they are.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !treeOpen) {
        return;
      }
      // Only when the owner is *in* the tree. A document-wide Escape handler
      // competes with every dialog on the page: closing the conversion
      // confirmation also collapsed the tree and pulled focus onto its toggle,
      // which is a worse outcome than not handling the key at all.
      const active = document.activeElement;
      const inTree = active instanceof HTMLElement && active.closest("#workspace-tree") !== null;
      if (inTree) {
        closeTreeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [treeOpen]);

  const closeTree = useCallback(() => {
    setTreeOpen(false);
    // Back to the control that opened it. Leaving focus in a panel that is no
    // longer on screen is how a keyboard journey ends without anyone noticing.
    treeToggle.current?.focus();
  }, []);
  closeTreeRef.current = closeTree;

  if (loadState === "loading") {
    return (
      <p className="loading-state" role="status">
        Loading workspace…
      </p>
    );
  }

  const renderNode = (node: TreeNode, level: number): React.ReactElement => {
    const isSelected = selectedId === node.item.id;
    const parentPlacement = node.item.placements.find((entry) => entry.kind === "hierarchy");
    const parentId = parentPlacement?.parentItemId ?? null;
    return (
      <li key={node.item.id} role="none">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the ARIA tree pattern
            puts one handler on the tree, not one per row. A row-level handler
            would need every row in the tab order to receive its own key events,
            which is the arrangement the pattern exists to avoid. Keyboard
            operation is covered by useTreeKeyboard on the container and
            asserted in keyboard-navigation.spec.ts. */}
        <div
          role="treeitem"
          aria-level={level}
          aria-selected={isSelected}
          {...(isBranch(node) ? { "aria-expanded": expanded.has(node.item.id) } : {})}
          tabIndex={isSelected || (selectedId === null && level === 1) ? 0 : -1}
          className="tree-row"
          data-testid={`tree-item-${node.item.name}`}
          data-item-id={node.item.id}
          onClick={() => setSelectedId(node.item.id)}
        >
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
          {node.item.kind === "file" ? <FileNode item={node.item} /> : null}
          <span className="tree-actions">
            {node.item.kind !== "file" ? (
              <>
                <button
                  type="button"
                  aria-label={`New page inside ${node.item.name}`}
                  onClick={() => void createItem("page", node.item.id)}
                >
                  +page
                </button>
                <button
                  type="button"
                  aria-label={`New folder inside ${node.item.name}`}
                  onClick={() => void createItem("folder", node.item.id)}
                >
                  +folder
                </button>
              </>
            ) : null}
            {node.item.kind !== "file" ? (
              <ConvertItemControl
                itemId={node.item.id}
                itemName={node.item.name}
                kind={node.item.kind as ConvertibleKind}
                convert={convertItem}
              />
            ) : null}
            <button
              type="button"
              aria-label={`Rename ${node.item.name}`}
              onClick={() => void renameItem(node)}
            >
              rename
            </button>
            <button
              type="button"
              aria-label={`Move ${node.item.name} up`}
              onClick={() => void reorder(node, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${node.item.name} down`}
              onClick={() => void reorder(node, 1)}
            >
              ↓
            </button>
            {parentId !== null ? (
              <button
                type="button"
                aria-label={`Move ${node.item.name} to workspace root`}
                onClick={() => void moveInto(node, null)}
              >
                →root
              </button>
            ) : null}
            {selectedId !== null && selectedId !== node.item.id ? (
              <button
                type="button"
                aria-label={`Move selected item into ${node.item.name}`}
                onClick={() => {
                  const selected = visibleNodes.find(
                    (candidate) => candidate.item.id === selectedId,
                  );
                  if (selected !== undefined) {
                    void moveInto(selected, node.item.id);
                  }
                }}
              >
                ⤵selected
              </button>
            ) : null}
            <button
              type="button"
              // The label states the action, not the current state: "Favourite
              // X" on a row that is already one would leave a screen-reader
              // user unable to tell which of the two it is.
              aria-label={
                node.item.favourite
                  ? `Remove ${node.item.name} from favourites`
                  : `Add ${node.item.name} to favourites`
              }
              aria-pressed={node.item.favourite}
              data-testid={`favourite-${node.item.name}`}
              onClick={() =>
                // Deliberately without a causal base. The command carries the
                // state being asked for, so two devices starring the same page
                // agree rather than conflict — and asking an owner to resolve a
                // conflict between "favourite" and "favourite" would be absurd.
                void runCommand("item.favourite", {
                  itemId: node.item.id,
                  favourite: !node.item.favourite,
                })
              }
            >
              {node.item.favourite ? "★" : "☆"}
            </button>
            <button
              type="button"
              aria-label={`Trash ${node.item.name}`}
              onClick={() =>
                void runCommand("item.trash", { itemId: node.item.id }, [
                  node.item.currentRevisionId,
                ])
              }
            >
              trash
            </button>
          </span>
        </div>
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

  return (
    <section aria-label="Workspace hierarchy">
      <SyncStatus service={service} />

      {/* Only rendered as a control below the breakpoint — CSS hides it wider
          than that, where the tree is always in view and a toggle would be one
          more thing to explain. */}
      <button
        type="button"
        ref={treeToggle}
        className="tree-toggle"
        data-testid="toggle-tree"
        aria-expanded={treeOpen}
        aria-controls="workspace-tree"
        onClick={() => {
          setTreeOpen((open) => !open);
        }}
      >
        {treeOpen ? "Hide the workspace tree" : "Show the workspace tree"}
      </button>
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert" data-testid="problem-banner">
          {problem.code}: {problem.title}
        </p>
      ) : null}

      <div
        id="workspace-tree"
        className="workspace-tree"
        data-open={treeOpen}
        data-testid="workspace-tree"
      >
        <div className="toolbar">
          <label htmlFor="new-item-name" className="muted">
            Name
          </label>
          <input
            id="new-item-name"
            type="text"
            value={newItemName}
            placeholder="New item name"
            onChange={(event) => setNewItemName(event.target.value)}
          />
          <button type="button" onClick={() => void createItem("folder", null)}>
            New root folder
          </button>
          <button type="button" onClick={() => void createItem("page", null)}>
            New root page
          </button>
        </div>

        {/* Inside the collapsible region: at 320 pixels the shortcuts are part
            of navigation, and leaving them on screen while the tree is put away
            would defeat the point of putting it away. */}
        <Sidebar
          items={items}
          onOpen={(itemId) => setSelectedId(itemId)}
          onOpenSettings={onOpenSettings}
        />

        {tree.length === 0 ? (
          <p className="empty-state" data-testid="empty-state">
            The workspace is empty. Create a folder or a page to begin.
          </p>
        ) : (
          /* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the list receives the tree role deliberately (WAI-ARIA tree over ul/li) */
          <ul role="tree" aria-label="Content tree" className="tree" onKeyDown={onTreeKeyDown}>
            {tree.map((node) => renderNode(node, 1))}
          </ul>
        )}
      </div>

      <MutationStatus service={service} />

      {selectedItem !== null && selectedItem.kind === "page" ? (
        <>
          <EditorView service={service} itemId={selectedItem.id} />
          <AttachmentPanel pageId={selectedItem.id} onChanged={() => void refresh()} />
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
    </section>
  );
}
