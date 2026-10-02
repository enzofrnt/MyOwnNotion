// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  blockDropTargetAtCursor,
  hideEditorDropCursors,
  isNoOpDropPosition,
  moveEditorBlock,
  snapDropCursorToBlockEdge,
} from "../src/features/editor/block-drag-reorder.ts";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";

describe("side-menu block reorder", () => {
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
