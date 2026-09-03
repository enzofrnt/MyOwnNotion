// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FolderChild,
  FolderChildrenList,
  FolderInlineCreate,
  reorderRequestFromIndexes,
  useOptimisticOrder,
} from "../src/features/workspace/folder-children-list.tsx";

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
  { id: "a", name: "Feuille de route", kind: "page" as const, icon: "🗺️", childCount: 0 },
  { id: "b", name: "Archives", kind: "folder" as const, icon: null, childCount: 3 },
  { id: "c", name: "budget.xlsx", kind: "file" as const, childCount: 0 },
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
    expect(reorderRequestFromIndexes(children, 2, 3)).toBeNull();
  });
});

describe("folder children list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="folder-child-link"]'),
    ];
    expect(links.map((link) => link.querySelector(".folder-children__name")?.textContent)).toEqual([
      "Feuille de route",
      "Archives",
      "budget.xlsx",
    ]);
    expect(links[1]?.textContent).toContain("3 éléments");
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
    expect(order()).toBe("b,c,a");

    // The projection still shows the old order for a moment: keep the target.
    await render([...children]);
    expect(order()).toBe("b,c,a");

    // The projection catches up: the override is released.
    const confirmed = [children[1], children[2], children[0]] as FolderChild[];
    await render(confirmed);
    expect(order()).toBe("b,c,a");

    // Any other change (here a rejected move restoring another order) wins.
    await act(async () => reorder?.(2, 0));
    expect(order()).toBe("a,b,c");
    const elsewhere = [children[2], children[0], children[1]] as FolderChild[];
    await render(elsewhere);
    expect(order()).toBe("c,a,b");
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
