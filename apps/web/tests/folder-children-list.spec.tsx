// @vitest-environment jsdom
import type { DndContextProps, DragEndEvent } from "@dnd-kit/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FolderChild,
  FolderChildrenList,
  FolderInlineCreate,
  reorderRequestFromIndexes,
  useOptimisticOrder,
} from "../src/features/workspace/folder-children-list.tsx";

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as DndContextProps["onDragEnd"],
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dnd.onDragEnd = props.onDragEnd;
      return createElement(actual.DndContext, props);
    },
  };
});

function dropEvent(active: string, collision: string | null, cachedOver: string): DragEndEvent {
  const rect = {
    x: 0,
    y: 0,
    left: 0,
    right: 100,
    top: 0,
    bottom: 44,
    width: 100,
    height: 44,
  };
  return {
    active: {
      id: active,
      data: { current: {} },
      rect: { current: { initial: rect, translated: rect } },
    },
    over: { id: cachedOver, data: { current: {} }, rect, disabled: false },
    collisions: collision === null ? null : [{ id: collision }],
    delta: { x: 0, y: -44 },
    activatorEvent: new KeyboardEvent("keydown", { code: "Space" }),
  };
}

function OrderProbe({
  items,
  onReady,
}: {
  readonly items: readonly FolderChild[];
  readonly onReady: (reorder: (from: number, to: number) => void) => void;
}) {
  const { ordered, reorder } = useOptimisticOrder(items);
  onReady(reorder);
  return <output data-testid="order">{ordered.map((child) => child.id).join(",")}</output>;
}

const children = [
  {
    id: "a",
    href: "/notes/a",
    name: "Feuille de route",
    kind: "page" as const,
    icon: "🗺️",
    childCount: 0,
  },
  {
    id: "b",
    href: "/notes/b",
    name: "Archives",
    kind: "folder" as const,
    icon: null,
    childCount: 3,
  },
  {
    id: "c",
    href: "/notes/c",
    name: "budget.xlsx",
    kind: "file" as const,
    childCount: 0,
  },
  {
    id: "d",
    href: "/notes/d",
    name: "Suivi",
    kind: "database" as const,
    childCount: 0,
  },
];

describe("reorderRequestFromIndexes", () => {
  it("places the moved item after the target when moving down and before when moving up", () => {
    expect(reorderRequestFromIndexes(children, 0, 2)).toEqual({
      itemId: "a",
      targetId: "c",
      edge: "after",
    });
    expect(reorderRequestFromIndexes(children, 2, 0)).toEqual({
      itemId: "c",
      targetId: "a",
      edge: "before",
    });
  });

  it("ignores no-op and out-of-range moves", () => {
    expect(reorderRequestFromIndexes(children, 1, 1)).toBeNull();
    expect(reorderRequestFromIndexes(children, 0, -1)).toBeNull();
    expect(reorderRequestFromIndexes(children, 3, 4)).toBeNull();
  });
});

describe("folder children list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dnd.onDragEnd = undefined;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lists direct children as links in hierarchy order and opens them", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <FolderChildrenList
          folderName="Projets"
          items={children}
          onOpen={onOpen}
          onReorder={vi.fn()}
        />,
      );
    });
    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>('[data-testid="folder-child-link"]'),
    ];
    expect(links.map((link) => link.querySelector(".folder-children__name")?.textContent)).toEqual([
      "Feuille de route",
      "Archives",
      "budget.xlsx",
      "Suivi",
    ]);
    expect(links[1]?.textContent).toContain("3 éléments");
    expect(links[3]?.textContent).toContain("Base de données");
    expect(links[3]?.querySelector('[data-icon="layers"]')).not.toBeNull();
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/notes/a",
      "/notes/b",
      "/notes/c",
      "/notes/d",
    ]);
    expect(container.querySelector(".ProseMirror")).toBeNull();
    await act(async () => {
      links[1]?.click();
    });
    expect(onOpen).toHaveBeenCalledWith("b");
    expect(container.querySelector(".folder-children__actions")).toBeNull();
    expect(container.querySelector('[data-testid="folder-create-toggle"]')).toBeNull();
  });

  it("holds the chosen order until the projection confirms it, and yields to any other change", async () => {
    let reorder: ((from: number, to: number) => void) | null = null;
    const render = (items: readonly FolderChild[]) =>
      act(async () => {
        root.render(
          <OrderProbe
            items={items}
            onReady={(next) => {
              reorder = next;
            }}
          />,
        );
      });
    const order = () => container.querySelector('[data-testid="order"]')?.textContent;

    await render(children);
    await act(async () => reorder?.(0, 2));
    expect(order()).toBe("b,c,a,d");

    // The projection still shows the old order for a moment: keep the target.
    await render([...children]);
    expect(order()).toBe("b,c,a,d");

    // The projection catches up: the override is released.
    const confirmed = [children[1], children[2], children[0], children[3]] as FolderChild[];
    await render(confirmed);
    expect(order()).toBe("b,c,a,d");

    // Any other change (here a rejected move restoring another order) wins.
    await act(async () => reorder?.(2, 0));
    expect(order()).toBe("a,b,c,d");
    const elsewhere = [children[2], children[0], children[1], children[3]] as FolderChild[];
    await render(elsewhere);
    expect(order()).toBe("c,a,b,d");
  });

  it("drops at the current collision when the cached over item still names the dragged child", async () => {
    const onReorder = vi.fn();
    await act(async () => {
      root.render(
        <FolderChildrenList
          folderName="Projets"
          items={children}
          onOpen={vi.fn()}
          onReorder={onReorder}
        />,
      );
    });
    expect(dnd.onDragEnd).toBeTypeOf("function");
    await act(async () => dnd.onDragEnd?.(dropEvent("b", "a", "b")));
    expect(onReorder).toHaveBeenCalledExactlyOnceWith({
      itemId: "b",
      targetId: "a",
      edge: "before",
    });
    expect(
      Array.from(container.querySelectorAll('[data-testid="folder-child"]'), (row) =>
        row.getAttribute("data-item-id"),
      ),
    ).toEqual(["b", "a", "c", "d"]);
  });

  it("keeps the latest downward destination when a different over item is cached", async () => {
    const onReorder = vi.fn();
    await act(async () => {
      root.render(
        <FolderChildrenList
          folderName="Projets"
          items={children}
          onOpen={vi.fn()}
          onReorder={onReorder}
        />,
      );
    });
    await act(async () => dnd.onDragEnd?.(dropEvent("a", "c", "b")));
    expect(onReorder).toHaveBeenCalledExactlyOnceWith({
      itemId: "a",
      targetId: "c",
      edge: "after",
    });
    expect(
      Array.from(container.querySelectorAll('[data-testid="folder-child"]'), (row) =>
        row.getAttribute("data-item-id"),
      ),
    ).toEqual(["b", "c", "a", "d"]);
  });

  it("does not persist a stale, missing or unchanged collision", async () => {
    const onReorder = vi.fn();
    await act(async () => {
      root.render(
        <FolderChildrenList
          folderName="Projets"
          items={children}
          onOpen={vi.fn()}
          onReorder={onReorder}
        />,
      );
    });
    for (const collision of [null, "removed-child", "b"]) {
      await act(async () => dnd.onDragEnd?.(dropEvent("b", collision, "a")));
    }
    expect(onReorder).not.toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll('[data-testid="folder-child"]'), (row) =>
        row.getAttribute("data-item-id"),
      ),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("explains an empty folder", async () => {
    await act(async () => {
      root.render(
        <FolderChildrenList folderName="Vide" items={[]} onOpen={vi.fn()} onReorder={vi.fn()} />,
      );
    });
    expect(container.textContent).toContain("Ce dossier est vide");
    expect(container.querySelector(".folder-children__actions")).toBeNull();
    expect(container.querySelector('[data-testid="folder-create-toggle"]')).toBeNull();
  });

  it("creates a page or folder from the shared sidebar plus", async () => {
    const onCreate = vi.fn();
    await act(async () => {
      root.render(<FolderInlineCreate folderName="Vide" onCreate={onCreate} />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="folder-create-toggle"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="folder-create-folder"]')?.click();
    });
    expect(onCreate).toHaveBeenCalledWith("folder");
  });
});
