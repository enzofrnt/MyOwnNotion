/**
 * Accessible hierarchy explorer (T033, US1).
 *
 * Semantic tree with full keyboard operation: arrow keys navigate, Enter
 * selects, and every mutation is reachable through labelled buttons.
 * Loading, empty, error, and conflict states are explicit; failed mutations
 * never pretend success.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemDto, ProblemDto } from "@myownnotion/contracts";
import { generateUuidV7, keyBetween, sortSiblings, type Uuid } from "@myownnotion/domain";
import { ContentApi } from "../../services/content-api.ts";

type LoadState = "loading" | "ready" | "error";

interface TreeNode {
  readonly item: ItemDto;
  readonly placementId: Uuid;
  readonly positionKey: string;
  readonly children: TreeNode[];
}

function buildTree(items: ItemDto[]): TreeNode[] {
  const byParent = new Map<
    string,
    Array<{ item: ItemDto; placementId: Uuid; positionKey: string }>
  >();
  for (const item of items) {
    for (const placement of item.placements) {
      if (placement.kind !== "hierarchy") {
        continue;
      }
      const key = placement.parentItemId ?? "root";
      const list = byParent.get(key) ?? [];
      list.push({
        item,
        placementId: placement.id as Uuid,
        positionKey: placement.positionKey,
      });
      byParent.set(key, list);
    }
  }
  const build = (parentKey: string, guard: Set<string>): TreeNode[] => {
    const entries = byParent.get(parentKey) ?? [];
    const sorted = sortSiblings(
      entries.map((entry) => ({
        id: entry.placementId,
        workspaceId: entry.placementId,
        itemId: entry.item.id as Uuid,
        itemKind: entry.item.kind,
        kind: "hierarchy" as const,
        parentItemId: null,
        positionKey: entry.positionKey,
        removedAt: null,
      })),
    ).map((placement) => entries.find((entry) => entry.placementId === placement.id));
    return sorted.flatMap((entry) => {
      if (entry === undefined || guard.has(entry.item.id)) {
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
  const api = useMemo(() => new ContentApi(), []);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [trashedItems, setTrashedItems] = useState<ItemDto[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [problem, setProblem] = useState<ProblemDto | null>(null);
  const [selectedId, setSelectedId] = useState<Uuid | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const treeRef = useRef<HTMLUListElement>(null);

  const refresh = useCallback(async () => {
    const [activeResult, trashedResult] = await Promise.all([
      api.listItems({ lifecycle: "active" }),
      api.listItems({ lifecycle: "trashed" }),
    ]);
    if (!activeResult.ok) {
      setLoadState("error");
      setProblem(activeResult.problem);
      return;
    }
    setItems(activeResult.value.items);
    setTrashedItems(trashedResult.ok ? trashedResult.value.items : []);
    setLoadState("ready");
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tree = useMemo(() => buildTree(items), [items]);
  const visibleNodes = useMemo(() => flatten(tree), [tree]);

  const runMutation = useCallback(
    async (work: () => Promise<{ ok: boolean; problem?: ProblemDto }>) => {
      setProblem(null);
      const result = await work();
      if (!result.ok && result.problem !== undefined) {
        setProblem(result.problem);
      }
      await refresh();
    },
    [refresh],
  );

  const siblingKeys = useCallback(
    (parentItemId: Uuid | null): string[] => {
      const siblings = visibleNodes.filter((node) => {
        const placement = node.item.placements.find((entry) => entry.kind === "hierarchy");
        return (placement?.parentItemId ?? null) === parentItemId;
      });
      return siblings.map((node) => node.positionKey).sort();
    },
    [visibleNodes],
  );

  const createItem = useCallback(
    async (kind: "page" | "folder", parentItemId: Uuid | null) => {
      const name = newItemName.trim() || (kind === "page" ? "Untitled page" : "Untitled folder");
      const keys = siblingKeys(parentItemId);
      const positionKey = keyBetween(keys[keys.length - 1] ?? null, null);
      await runMutation(async () => {
        const result = await api.createItem(generateUuidV7(), {
          id: generateUuidV7(),
          kind,
          name,
          placement: { kind: "hierarchy", parentItemId, positionKey },
          ...(kind === "page"
            ? {
                pageDocument: {
                  format: "myownnotion.document+json" as const,
                  formatVersion: 1,
                  body: {},
                },
              }
            : {}),
        });
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
      setNewItemName("");
    },
    [api, newItemName, runMutation, siblingKeys],
  );

  const renameItem = useCallback(
    async (node: TreeNode) => {
      const name = window.prompt("New name", node.item.name);
      if (name === null || name.trim().length === 0) {
        return;
      }
      await runMutation(async () => {
        const result = await api.renameItem(
          generateUuidV7(),
          node.item.id as Uuid,
          node.item.currentRevisionId as Uuid,
          name,
        );
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
    },
    [api, runMutation],
  );

  const reorder = useCallback(
    async (node: TreeNode, direction: -1 | 1) => {
      const placement = node.item.placements.find((entry) => entry.kind === "hierarchy");
      if (placement === undefined) {
        return;
      }
      const parentId = (placement.parentItemId as Uuid | null) ?? null;
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
      await runMutation(async () => {
        const result = await api.movePlacement(
          generateUuidV7(),
          node.placementId,
          parentId,
          positionKey,
        );
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
    },
    [api, runMutation, visibleNodes],
  );

  const moveInto = useCallback(
    async (node: TreeNode, parentItemId: Uuid | null) => {
      const keys = siblingKeys(parentItemId);
      const positionKey = keyBetween(keys[keys.length - 1] ?? null, null);
      await runMutation(async () => {
        const result = await api.movePlacement(
          generateUuidV7(),
          node.placementId,
          parentItemId,
          positionKey,
        );
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
    },
    [api, runMutation, siblingKeys],
  );

  const trashItem = useCallback(
    async (node: TreeNode) => {
      await runMutation(async () => {
        const result = await api.trashItem(generateUuidV7(), node.item.id as Uuid);
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
    },
    [api, runMutation],
  );

  const restoreItem = useCallback(
    async (item: ItemDto) => {
      await runMutation(async () => {
        const result = await api.restoreItem(generateUuidV7(), item.id as Uuid);
        return result.ok ? { ok: true } : { ok: false, problem: result.problem };
      });
    },
    [api, runMutation],
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
          setSelectedId(next.item.id as Uuid);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const previous = visibleNodes[Math.max(index - 1, 0)] ?? visibleNodes[0];
        if (previous !== undefined) {
          setSelectedId(previous.item.id as Uuid);
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
    const parentId = (parentPlacement?.parentItemId as Uuid | null) ?? null;
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
          onClick={() => setSelectedId(node.item.id as Uuid)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedId(node.item.id as Uuid);
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
                  onClick={() => void createItem("page", node.item.id as Uuid)}
                >
                  +page
                </button>
                <button
                  type="button"
                  aria-label={`New folder inside ${node.item.name}`}
                  onClick={() => void createItem("folder", node.item.id as Uuid)}
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
                    void moveInto(selected, node.item.id as Uuid);
                  }
                }}
              >
                ⤵selected
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`Trash ${node.item.name}`}
              onClick={() => void trashItem(node)}
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
      {problem !== null ? (
        <p className="status-banner" data-state="error" role="alert" data-testid="problem-banner">
          {problem.code}: {problem.title}
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="status-banner" data-state="offline" role="alert">
          The server is unreachable. Loaded content stays readable offline.
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
        <ul aria-label="Content tree" className="tree" ref={treeRef} onKeyDown={onTreeKeyDown}>
          {tree.map((node) => renderNode(node, 1))}
        </ul>
      )}

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
                    onClick={() => void restoreItem(item)}
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
