// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setDocumentTreeGrabbing,
  TREE_GRABBING_ATTRIBUTE,
  TreeDragDropProvider,
  type TreeDragItem,
  TreeDropTarget,
} from "../src/features/navigation/tree-drag-drop.tsx";

const items = [
  {
    id: "alpha",
    name: "Alpha",
    parentId: null,
    siblingIndex: 0,
    canContainChildren: true,
    kind: "page",
    icon: null,
  },
  {
    id: "beta",
    name: "Beta",
    parentId: null,
    siblingIndex: 1,
    canContainChildren: true,
    kind: "page",
    icon: "📌",
  },
] as const satisfies readonly TreeDragItem[];

function Harness() {
  return (
    <TreeDragDropProvider items={items} onDrop={() => undefined}>
      {items.map((item) => (
        <TreeDropTarget key={item.id} itemId={item.id} canContainChildren={item.canContainChildren}>
          {({ rowDragListeners, setInsideRef }) => (
            <div ref={setInsideRef} data-testid={`row-${item.name}`} {...rowDragListeners}>
              <span>{item.name}</span>
              <button type="button" data-testid={`btn-${item.name}`}>
                Menu
              </button>
            </div>
          )}
        </TreeDropTarget>
      ))}
    </TreeDragDropProvider>
  );
}

describe("tree drag preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    setDocumentTreeGrabbing(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setDocumentTreeGrabbing(false);
  });

  it("toggles the document grabbing marker used by the tree cursor", () => {
    setDocumentTreeGrabbing(true);
    expect(document.documentElement.getAttribute(TREE_GRABBING_ATTRIBUTE)).toBe("true");
    setDocumentTreeGrabbing(false);
    expect(document.documentElement.hasAttribute(TREE_GRABBING_ATTRIBUTE)).toBe(false);
  });

  it("marks the document as grabbing from the row, not from nested commands", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    const row = container.querySelector('[data-testid="row-Alpha"]');
    const button = container.querySelector('[data-testid="btn-Alpha"]');
    expect(row).toBeInstanceOf(HTMLElement);
    expect(button).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      button?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    });
    expect(document.documentElement.hasAttribute(TREE_GRABBING_ATTRIBUTE)).toBe(false);

    await act(async () => {
      row?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 12,
          clientY: 12,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    });
    expect(document.documentElement.getAttribute(TREE_GRABBING_ATTRIBUTE)).toBe("true");
  });
});
