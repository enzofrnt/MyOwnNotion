/**
 * Accessible offline-first hierarchy explorer (T033 US1 + T045/T046 US6).
 *
 * Reads come from the durable local projection; every mutation is applied
 * optimistically with a durable outbox entry and then synchronized. The
 * tree is a semantic ARIA tree with complete keyboard operation, and
 * loading, empty, offline, error, and conflict states are explicit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, keyBetween, type SafeError, type Uuid } from "@myownnotion/domain";
import { SyncStatus } from "../../components/sync-status.tsx";
import { localContent } from "../../services/local-content.ts";
import { PageDocumentForm } from "../pages/page-document-form.tsx";

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

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export function HierarchyExplorer() {
  const service = useMemo(() => localContent(), []);
  const [items, setItems] = useState<ProjectedItem[]>([]);
  const [trashedItems, setTrashedItems] = useState<ProjectedItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [problem, setProblem] = useState<SafeError | null>(null);
  const [selectedId, setSelectedId] = useState<Uuid | null>(null);
  const [newItemName, setNewItemName] = useState("");

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

  const tree = useMemo(() => buildTree(items), [items]);
  const visibleNodes = useMemo(() => flatten(tree), [tree]);
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
      const keys = siblingKeys(parentItemId);
      const positionKey = keyBetween(keys[keys.length - 1] ?? null, null);
      await runCommand("item.create", {
        id: generateUuidV7(),
        kind,
        name,
        placement: { kind: "hierarchy", parentItemId, positionKey },
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
      setNewItemName("");
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
      const positionKey = keyBetween(before?.positionKey ?? null, after?.positionKey ?? null);
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
      const positionKey = keyBetween(keys[keys.length - 1] ?? null, null);
      await runCommand(
        "placement.move",
        { placementId: node.placementId, parentItemId, positionKey },
        [node.item.currentRevisionId],
      );
    },
    [runCommand, siblingKeys],
  );

  const onTreeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (visibleNodes.length === 0) {
        return;
      }
      const index = visibleNodes.findIndex((node) => node.item.id === selectedId);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = visibleNodes[Math.min(index + 1, visibleNodes.length - 1)] ?? visibleNodes[0];
        if (next !== undefined) {
          setSelectedId(next.item.id);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const previous = visibleNodes[Math.max(index - 1, 0)] ?? visibleNodes[0];
        if (previous !== undefined) {
          setSelectedId(previous.item.id);
        }
      }
    },
    [selectedId, visibleNodes],
  );

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
        <div
          role="treeitem"
          aria-level={level}
          aria-selected={isSelected}
          tabIndex={isSelected || (selectedId === null && level === 1) ? 0 : -1}
          className="tree-row"
          data-testid={`tree-item-${node.item.name}`}
          data-item-id={node.item.id}
          onClick={() => setSelectedId(node.item.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedId(node.item.id);
            }
          }}
        >
          <span className="tree-kind">{node.item.kind}</span>
          <span className="tree-name">{node.item.name}</span>
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
        {node.children.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: role="group" on ul is the canonical ARIA tree substructure
          <ul role="group">{node.children.map((child) => renderNode(child, level + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label="Workspace hierarchy">
      <SyncStatus service={service} />
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert" data-testid="problem-banner">
          {problem.code}: {problem.title}
        </p>
      ) : null}

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

      {tree.length === 0 ? (
        <p className="empty-state" data-testid="empty-state">
          The workspace is empty. Create a folder or a page to begin.
        </p>
      ) : (
        <ul aria-label="Content tree" className="tree" onKeyDown={onTreeKeyDown}>
          {tree.map((node) => renderNode(node, 1))}
        </ul>
      )}

      {selectedItem !== null && selectedItem.kind === "page" ? (
        <PageDocumentForm service={service} itemId={selectedItem.id} />
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
