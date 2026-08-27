import { describe, expect, it } from "vitest";
import {
  findByPrefix,
  resolveTreeKeyboardIntent,
  type TreeKeyboardNode,
} from "../src/features/navigation/use-tree-keyboard.ts";

const nodes: readonly TreeKeyboardNode[] = [
  {
    id: "parent",
    name: "Parent",
    level: 1,
    hasChildren: true,
    expanded: true,
    parentId: null,
  },
  {
    id: "child",
    name: "Child",
    level: 2,
    hasChildren: true,
    expanded: false,
    parentId: "parent",
  },
  {
    id: "sibling",
    name: "Sibling",
    level: 1,
    hasChildren: false,
    expanded: false,
    parentId: null,
  },
];

describe("ARIA tree keyboard intent", () => {
  it("moves a closed child branch to its parent on ArrowLeft", () => {
    expect(
      resolveTreeKeyboardIntent(nodes, "child", {
        key: "ArrowLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "select", id: "parent" });
  });

  it("collapses an open branch before moving to its parent", () => {
    expect(
      resolveTreeKeyboardIntent(nodes, "parent", {
        key: "ArrowLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "set-expanded", id: "parent", expanded: false });
  });

  it("leaves browser shortcuts and root ArrowLeft untouched", () => {
    expect(
      resolveTreeKeyboardIntent(nodes, "sibling", {
        key: "ArrowLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBeNull();
    expect(
      resolveTreeKeyboardIntent(nodes, "sibling", {
        key: "s",
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBeNull();
  });

  it("wraps type-ahead after the current row", () => {
    expect(findByPrefix(nodes, "p", 2)?.id).toBe("parent");
  });
});
