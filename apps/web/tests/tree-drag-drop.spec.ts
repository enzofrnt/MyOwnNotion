import { describe, expect, it } from "vitest";
import {
  adjacentTreeKeyboardTarget,
  resolveTreeDrop,
  type TreeDragItem,
} from "../src/features/navigation/tree-drag-drop.tsx";

const items = [
  { id: "root", name: "Racine", parentId: null, siblingIndex: 0, canContainChildren: true },
  { id: "peer", name: "Voisine", parentId: null, siblingIndex: 1, canContainChildren: true },
  { id: "child", name: "Enfant", parentId: "root", siblingIndex: 0, canContainChildren: true },
  { id: "file", name: "Fichier", parentId: "root", siblingIndex: 1, canContainChildren: false },
] as const satisfies readonly TreeDragItem[];

describe("tree drag and drop intent", () => {
  it("reorders siblings on the side from which the dragged row arrives", () => {
    expect(resolveTreeDrop(items, "root", "peer")).toEqual({
      kind: "place",
      itemId: "root",
      targetId: "peer",
      parentId: null,
      edge: "after",
    });
    expect(resolveTreeDrop(items, "peer", "root")).toEqual({
      kind: "place",
      itemId: "peer",
      targetId: "root",
      parentId: null,
      edge: "before",
    });
  });

  it("nests an item dropped over a container in another branch", () => {
    expect(resolveTreeDrop(items, "peer", "child")).toEqual({
      kind: "nest",
      itemId: "peer",
      parentId: "child",
    });
  });

  it("places an item beside a leaf because a file cannot contain children", () => {
    expect(resolveTreeDrop(items, "peer", "file")).toEqual({
      kind: "place",
      itemId: "peer",
      targetId: "file",
      parentId: "root",
      edge: "after",
    });
  });

  it("refuses self drops and containment cycles before any mutation", () => {
    expect(resolveTreeDrop(items, "root", "root")).toBeNull();
    expect(resolveTreeDrop(items, "root", "child")).toEqual({
      kind: "rejected",
      itemId: "root",
      targetId: "child",
      reason: "cycle",
    });
  });
});

describe("tree keyboard drop targets", () => {
  const rows = [
    { id: "third", top: 80 },
    { id: "first", top: 0 },
    { id: "second", top: 40 },
  ] as const;

  it("moves to the visually adjacent row instead of retaining the active row", () => {
    expect(adjacentTreeKeyboardTarget(rows, "second", "up")).toBe("first");
    expect(adjacentTreeKeyboardTarget(rows, "second", "down")).toBe("third");
  });

  it("stops at the visible boundaries and rejects an unknown current row", () => {
    expect(adjacentTreeKeyboardTarget(rows, "first", "up")).toBeNull();
    expect(adjacentTreeKeyboardTarget(rows, "third", "down")).toBeNull();
    expect(adjacentTreeKeyboardTarget(rows, "missing", "down")).toBeNull();
  });
});
