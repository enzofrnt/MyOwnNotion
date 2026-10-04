// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alignDropCursorToReadingColumn,
  beginSideMenuBlockReorder,
  blockDropTargetAtCursor,
  computeEditorDropCursor,
  endSideMenuBlockReorder,
  hideEditorDropCursors,
  isNoOpDropPosition,
  moveEditorBlock,
  snapDropCursorToBlockEdge,
} from "../src/features/editor/block-drag-reorder.ts";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";

function fixtureElement(root: Element, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Missing fixture element: ${selector}`);
  return element;
}

const originalElementsFromPoint = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");

describe("side-menu block reorder", () => {
  afterEach(() => {
    endSideMenuBlockReorder();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalElementsFromPoint)
      Object.defineProperty(document, "elementsFromPoint", originalElementsFromPoint);
    else Reflect.deleteProperty(document, "elementsFromPoint");
  });

  it("aligns the preview to the active tab even when a hidden editor comes first", () => {
    vi.stubGlobal("DragEvent", class extends Event {});
    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <section class="page-editor" hidden>
        <div class="bn-editor"><div class="bn-block-group"><div class="bn-block-outer"></div></div></div>
        <div class="prosemirror-dropcursor-block-horizontal"></div>
      </section>
      <section class="page-editor">
        <div class="bn-editor"><div class="bn-block-group">
          <div class="bn-block-outer"><div class="bn-block"><div class="node-table"></div></div></div>
          <div class="bn-block-outer" data-id="paragraph"></div>
        </div></div>
        <div class="prosemirror-dropcursor-block-horizontal"></div>
      </section>`;
    document.body.append(fixture);
    const host = fixture.children[1] as HTMLElement;
    const editorDOM = fixtureElement(host, ".bn-editor");
    const column = fixtureElement(host, '[data-id="paragraph"]');
    const cursor = fixtureElement(host, ".prosemirror-dropcursor-block-horizontal");
    const hiddenCursor = fixtureElement(
      fixture,
      "[hidden] .prosemirror-dropcursor-block-horizontal",
    );
    Object.defineProperty(editorDOM, "offsetParent", { value: host });
    Object.defineProperty(cursor, "offsetParent", { value: host });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 0, 1100, 900));
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(480, 300, 688, 40));
    const editor = { prosemirrorView: { dom: editorDOM } } as unknown as EditorInstance;

    try {
      beginSideMenuBlockReorder(editor, "source");
      alignDropCursorToReadingColumn();

      expect(cursor.style.display).toBe("");
      expect(cursor.style.left).toBe("460px");
      expect(cursor.style.width).toBe("688px");
      expect(hiddenCursor.style.display).toBe("none");
      expect(hiddenCursor.style.width).toBe("");

      endSideMenuBlockReorder();
      expect(cursor.style.display).toBe("none");
      expect(document.documentElement.hasAttribute("data-block-grabbing")).toBe(false);
    } finally {
      endSideMenuBlockReorder();
      fixture.remove();
    }
  });

  it("uses the active editor's padded column when it only contains a table", () => {
    vi.stubGlobal("DragEvent", class extends Event {});
    const host = document.createElement("section");
    host.innerHTML = `<div class="bn-editor" style="padding-inline-start: 40px; padding-inline-end: 40px">
      <div class="bn-block-group"><div class="bn-block-outer"><div class="bn-block"><div class="node-table"></div></div></div></div>
      </div><div class="prosemirror-dropcursor-block-horizontal"></div>`;
    document.body.append(host);
    const editorDOM = fixtureElement(host, ".bn-editor");
    const cursor = fixtureElement(host, ".prosemirror-dropcursor-block-horizontal");
    Object.defineProperty(editorDOM, "offsetParent", { value: host });
    Object.defineProperty(cursor, "offsetParent", { value: host });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 0, 900, 500));
    vi.spyOn(editorDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(140, 100, 768, 300));
    const editor = { prosemirrorView: { dom: editorDOM } } as unknown as EditorInstance;

    try {
      beginSideMenuBlockReorder(editor, "table");
      alignDropCursorToReadingColumn();
      expect(cursor.style.left).toBe("80px");
      expect(cursor.style.width).toBe("688px");
    } finally {
      endSideMenuBlockReorder();
      host.remove();
    }
  });

  it("moves a page-link paragraph without dropping the mention", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const target = generateUuidV7();
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        {
          id: first,
          type: "paragraph",
          content: [
            {
              type: "pageLink",
              props: { targetItemId: target },
              content: "Sous-page",
            },
          ],
        },
        { id: second, type: "paragraph", content: "Ensuite" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;

    expect(moveEditorBlock(editor, first, second, "after")).toBe(true);
    expect(editor.document.map((block) => block.id)).toEqual([second, first]);
    expect(JSON.stringify(editor.document[1])).toContain('"type":"pageLink"');
    expect(JSON.stringify(editor.document[1])).toContain(target);
    expect(JSON.stringify(editor.document[1])).toContain("Sous-page");
    expect(JSON.stringify(editor.document[0])).not.toContain("pageLink");
    expect(editor.document).toHaveLength(2);
  });

  it("snaps an in-paragraph drop to the block edge instead of the same line", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        { id: first, type: "paragraph", content: "Un" },
        { id: second, type: "paragraph", content: "Deux" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;
    const doc = editor.prosemirrorState.doc;
    let firstPos = -1;
    let firstSize = 0;
    let insideFirst = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "blockContainer" && node.attrs["id"] === first) {
        firstPos = pos;
        firstSize = node.nodeSize;
      }
      if (node.type.name === "paragraph" && insideFirst < 0) {
        insideFirst = pos + 1;
      }
      return true;
    });

    const after = snapDropCursorToBlockEdge(doc, insideFirst, 30, { top: 0, height: 40 });
    expect(after.orientation).toBe("block-horizontal");
    expect(after.pos).toBe(firstPos + firstSize);
    const before = snapDropCursorToBlockEdge(doc, insideFirst, 10, { top: 0, height: 40 });
    expect(before.pos).toBe(firstPos);
  });

  it("drops where the line is, even when the pointer sits inside a paragraph", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        { id: first, type: "paragraph", content: "Un" },
        { id: second, type: "paragraph", content: "Deux" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;
    const doc = editor.prosemirrorState.doc;
    let insideSecond = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "Deux") insideSecond = pos + 1;
      return true;
    });

    const line = snapDropCursorToBlockEdge(doc, insideSecond, 10, { top: 0, height: 40 });
    expect(blockDropTargetAtCursor(doc, line.pos)).toEqual({
      referenceId: second,
      placement: "before",
    });
  });

  it("resolves the outer block-group boundaries to the first and last block", () => {
    const first = generateUuidV7();
    const last = generateUuidV7();
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        { id: first, type: "paragraph", content: "First" },
        { id: last, type: "paragraph", content: "Last" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;
    const doc = editor.prosemirrorState.doc;
    expect(blockDropTargetAtCursor(doc, 0)).toEqual({ referenceId: first, placement: "before" });
    expect(blockDropTargetAtCursor(doc, doc.content.size)).toEqual({
      referenceId: last,
      placement: "after",
    });
  });

  it.each(["group boundary", "following block boundary", "group boundary without a hit element"])(
    "uses the hovered block edge when the browser reports a %s",
    (reported) => {
      vi.stubGlobal("DragEvent", class extends Event {});
      const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7()];
      const model = BlockNoteEditor.create({
        schema: blockNoteSchema,
        initialContent: ids.map((id, index) => ({
          id,
          type: "paragraph",
          content: `Block ${index}`,
        })) as unknown as PartialBlock[],
      }) as unknown as EditorInstance;
      const doc = model.prosemirrorState.doc;
      const positions: number[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name === "blockContainer") positions.push(pos);
        return true;
      });
      const host = document.createElement("section");
      host.innerHTML = `<div class="bn-editor"><div class="bn-block-group">${ids.map((id) => `<div class="bn-block-outer" data-id="${id}"></div>`).join("")}</div></div>`;
      document.body.append(host);
      const editorDOM = fixtureElement(host, ".bn-editor");
      Object.defineProperty(editorDOM, "offsetParent", { value: host });
      const nodes = Array.from(editorDOM.querySelectorAll<HTMLElement>(".bn-block-outer"));
      nodes.forEach((node, index) => {
        vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
          new DOMRect(80, 255 + index * 30, 220, 30),
        );
      });
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: () =>
          reported === "group boundary without a hit element" ? [] : [nodes[0], editorDOM],
      });
      const editor = {
        prosemirrorState: { doc },
        prosemirrorView: {
          dom: editorDOM,
          nodeDOM: (pos: number) => nodes[positions.indexOf(pos)] ?? editorDOM,
        },
        getBlock: (id: string) => model.getBlock(id),
        getParentBlock: (id: string) => model.getParentBlock(id),
        document: model.document,
      } as unknown as EditorInstance;
      try {
        beginSideMenuBlockReorder(editor, ids[2] as string);
        const preview = computeEditorDropCursor({
          editor,
          event: new MouseEvent("dragover", { clientX: 190, clientY: 255 }) as DragEvent,
          defaultPosition: {
            pos: reported.startsWith("group boundary") ? 0 : (positions[1] as number),
          },
        });
        expect(preview).toEqual({ pos: positions[0], orientation: "block-horizontal" });
        expect(blockDropTargetAtCursor(doc, preview?.pos ?? -1)).toEqual({
          referenceId: ids[0],
          placement: "before",
        });
      } finally {
        endSideMenuBlockReorder();
        host.remove();
      }
    },
  );

  it("treats a drop immediately before or after the dragged block as a no-op", () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        { id: first, type: "paragraph", content: "Un" },
        { id: second, type: "paragraph", content: "Deux" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;
    const doc = editor.prosemirrorState.doc;
    let firstPos = -1;
    let firstSize = 0;
    let afterSecond = -1;
    doc.descendants((node, pos) => {
      if (node.type.name !== "blockContainer") return true;
      if (node.attrs["id"] === first) {
        firstPos = pos;
        firstSize = node.nodeSize;
      }
      if (node.attrs["id"] === second) afterSecond = pos + node.nodeSize;
      return true;
    });

    expect(isNoOpDropPosition(doc, 0, first)).toBe(true);
    expect(isNoOpDropPosition(doc, doc.content.size, second)).toBe(true);
    expect(isNoOpDropPosition(doc, firstPos, first)).toBe(true);
    expect(isNoOpDropPosition(doc, firstPos + firstSize, first)).toBe(true);
    expect(isNoOpDropPosition(doc, afterSecond, first)).toBe(false);
  });

  it("hides leftover drop strokes after the drag ends", () => {
    const cursor = document.createElement("div");
    cursor.className = "prosemirror-dropcursor-block-horizontal";
    cursor.style.width = "780px";
    document.body.append(cursor);

    hideEditorDropCursors();

    expect(cursor.style.display).toBe("none");
    cursor.remove();
  });
});
