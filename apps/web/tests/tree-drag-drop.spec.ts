import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { retainExpandableItemIds } from "../src/features/hierarchy/hierarchy-explorer.tsx";
import { BranchState } from "../src/features/navigation/branch-state.tsx";
import {
  adjacentTreeKeyboardDropTarget,
  adjacentTreeKeyboardTarget,
  parseTreeDropTargetId,
  prioritizeTreeDropCollisions,
  resolveTreeDrop,
  TREE_GRABBING_ATTRIBUTE,
  type TreeDragItem,
  treeDropTargetId,
} from "../src/features/navigation/tree-drag-drop.tsx";

const items = [
  { id: "root", name: "Racine", parentId: null, siblingIndex: 0, canContainChildren: true },
  { id: "peer", name: "Voisine", parentId: null, siblingIndex: 1, canContainChildren: true },
  { id: "child", name: "Enfant", parentId: "root", siblingIndex: 0, canContainChildren: true },
  { id: "file", name: "Fichier", parentId: "root", siblingIndex: 1, canContainChildren: false },
] as const satisfies readonly TreeDragItem[];

describe("tree drag and drop intent", () => {
  it("uses the explicit edge selected by the pointer instead of the old order", () => {
    expect(resolveTreeDrop(items, "root", treeDropTargetId("peer", "before"))).toEqual({
      kind: "place",
      itemId: "root",
      targetId: "peer",
      parentId: null,
      edge: "before",
    });
    expect(resolveTreeDrop(items, "peer", treeDropTargetId("root", "after"))).toEqual({
      kind: "place",
      itemId: "peer",
      targetId: "root",
      parentId: null,
      edge: "after",
    });
  });

  it("nests only through the explicit inside zone", () => {
    expect(resolveTreeDrop(items, "peer", treeDropTargetId("child", "inside"))).toEqual({
      kind: "nest",
      itemId: "peer",
      parentId: "child",
    });
    expect(resolveTreeDrop(items, "peer", treeDropTargetId("child", "before"))).toEqual({
      kind: "place",
      itemId: "peer",
      targetId: "child",
      parentId: "root",
      edge: "before",
    });
  });

  it("draws one insertion line for a first-child drop: the child's, never the parent's gap", () => {
    const source = readFileSync(
      new URL("../src/features/navigation/tree-drag-drop.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/redirectsAfter && after\.isOver/u);
    expect(source).toMatch(/leadsThisRow\s*\?\s*"before"/u);
    const css = readFileSync(
      new URL("../src/features/navigation/navigation.css", import.meta.url),
      "utf8",
    );
    // The first child's line lives inside the children box, which clips at its padding edge.
    expect(css).toMatch(/\.collapsible-region__inner\s*\{[^}]*padding-top:\s*0\.125rem/u);
  });

  it("treats the gap under an open parent as its first child, not as leaving the parent", () => {
    const open = items.map((item) => (item.id === "root" ? { ...item, expanded: true } : item));
    // A second child dropped right under its open parent stays inside, in first place.
    expect(resolveTreeDrop(open, "file", treeDropTargetId("root", "after"))).toEqual({
      kind: "place",
      itemId: "file",
      targetId: "child",
      parentId: "root",
      edge: "before",
    });
    // The first child dropped there is already in place.
    expect(resolveTreeDrop(open, "child", treeDropTargetId("root", "after"))).toBeNull();
    // An outside item lands inside too.
    expect(resolveTreeDrop(open, "peer", treeDropTargetId("root", "after"))).toMatchObject({
      parentId: "root",
      targetId: "child",
      edge: "before",
    });
    // A closed parent keeps the sibling meaning.
    expect(resolveTreeDrop(items, "file", treeDropTargetId("root", "after"))).toMatchObject({
      parentId: null,
      targetId: "root",
      edge: "after",
    });
  });

  it("refuses an inside zone for a leaf instead of silently choosing another intent", () => {
    expect(resolveTreeDrop(items, "peer", treeDropTargetId("file", "inside"))).toBeNull();
    expect(resolveTreeDrop(items, "peer", treeDropTargetId("file", "after"))).toEqual({
      kind: "place",
      itemId: "peer",
      targetId: "file",
      parentId: "root",
      edge: "after",
    });
  });

  it("refuses self drops and containment cycles before any mutation", () => {
    expect(resolveTreeDrop(items, "root", treeDropTargetId("root", "inside"))).toBeNull();
    expect(resolveTreeDrop(items, "root", treeDropTargetId("child", "inside"))).toEqual({
      kind: "rejected",
      itemId: "root",
      targetId: "child",
      reason: "cycle",
    });
  });

  it("round-trips target identities without confusing item ids and zones", () => {
    for (const zone of ["before", "inside", "after"] as const) {
      expect(parseTreeDropTargetId(treeDropTargetId("item:with:separator", zone))).toEqual({
        itemId: "item:with:separator",
        zone,
      });
    }
    expect(parseTreeDropTargetId("plain-item-id")).toBeNull();
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
    expect(adjacentTreeKeyboardDropTarget(rows, "second", "up")).toBe(
      treeDropTargetId("first", "before"),
    );
    expect(adjacentTreeKeyboardDropTarget(rows, "second", "down")).toBe(
      treeDropTargetId("third", "after"),
    );
  });

  it("stops at the visible boundaries and rejects an unknown current row", () => {
    expect(adjacentTreeKeyboardTarget(rows, "first", "up")).toBeNull();
    expect(adjacentTreeKeyboardTarget(rows, "third", "down")).toBeNull();
    expect(adjacentTreeKeyboardTarget(rows, "missing", "down")).toBeNull();
  });
});

describe("tree pointer drop targets", () => {
  it("prefers an explicit edge over the overlapping inside row", () => {
    expect(
      prioritizeTreeDropCollisions([
        { id: treeDropTargetId("peer", "inside") },
        { id: treeDropTargetId("peer", "after") },
      ]).map((collision) => collision.id),
    ).toEqual([treeDropTargetId("peer", "after"), treeDropTargetId("peer", "inside")]);
  });

  it("keeps the middle zone when no insertion edge contains the pointer", () => {
    expect(prioritizeTreeDropCollisions([{ id: treeDropTargetId("peer", "inside") }])).toEqual([
      { id: treeDropTargetId("peer", "inside") },
    ]);
  });
});

describe("expanded tree state", () => {
  it("turns a page whose last child moved away back into a normal leaf", () => {
    expect([
      ...retainExpandableItemIds(new Set(["page", "folder"]), [
        { id: "page", kind: "page", childCount: 0 },
        { id: "folder", kind: "folder", childCount: 0 },
      ]),
    ]).toEqual(["folder"]);
  });

  it("keeps an absent branch open so trash restoration and partial refreshes do not collapse it", () => {
    expect([...retainExpandableItemIds(new Set(["temporarily-absent"]), [])]).toEqual([
      "temporarily-absent",
    ]);
  });
});

describe("tree drag overlay source", () => {
  it("renders a named phantom overlay and a document grabbing marker", () => {
    const source = readFileSync(
      new URL("../src/features/navigation/tree-drag-drop.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("DragOverlay");
    expect(source).toContain('data-testid="tree-drag-phantom"');
    expect(source).toContain("setDocumentTreeGrabbing(true)");
    expect(source).toContain(TREE_GRABBING_ATTRIBUTE);
  });
});

describe("empty branch presentation", () => {
  it("keeps concise French copy only for an explicitly empty folder", () => {
    const folder = renderToStaticMarkup(
      createElement(BranchState, { kind: "empty", containerKind: "folder" }),
    );
    expect(folder).toContain("Ce dossier est vide.");
    expect(folder).toContain('data-state="empty"');
    expect(folder).not.toContain("Nothing in here yet");
  });
});
