import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { stableMoveChanges, validateBlockDrop } from "../src/features/editor/block-drag-drop.ts";
import {
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  resolveContiguousBlockSelection,
} from "../src/features/editor/block-selection.ts";
import type {
  EditorBlock,
  EditorBlocksChanged,
  EditorInstance,
  EditorPartialBlock,
} from "../src/features/editor/blocknote-schema.ts";
import {
  editorShortcutAction,
  historyActionFromInputType,
  MARKDOWN_INSERTION_SHORTCUTS,
} from "../src/features/editor/editor-shortcuts.ts";

const FIRST = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;
const SECOND = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057" as Uuid;
const THIRD = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2058" as Uuid;

function paragraph(id: Uuid, text: string, children: readonly EditorBlock[] = []): EditorBlock {
  return {
    id,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: text === "" ? [] : [{ type: "text", text, styles: {} }],
    children,
  } as EditorBlock;
}

function flatten(blocks: readonly EditorBlock[]): EditorBlock[] {
  return blocks.flatMap((block) => [block, ...flatten(block.children as EditorBlock[])]);
}

function fakeEditor(initial: EditorBlock[], selectedIds: readonly string[]) {
  const state = {
    document: [...initial],
    selectedIds: [...selectedIds],
    transactions: 0,
  };
  const lookup = (id: string) => flatten(state.document).find((block) => block.id === id);
  const parentOf = (id: string): EditorBlock | undefined => {
    const visit = (
      blocks: readonly EditorBlock[],
      parent?: EditorBlock,
    ): EditorBlock | undefined => {
      for (const block of blocks) {
        if (block.id === id) return parent;
        const nested = visit(block.children as EditorBlock[], block);
        if (nested !== undefined) return nested;
      }
      return undefined;
    };
    return visit(state.document);
  };

  const editor = {
    get document() {
      return state.document;
    },
    getSelection: () => ({
      blocks: state.selectedIds.map((id) => lookup(id)).filter((block) => block !== undefined),
    }),
    getTextCursorPosition: () => ({ block: lookup(state.selectedIds[0] as string) }),
    getBlock: lookup,
    getParentBlock: parentOf,
    transact: (callback: () => unknown) => {
      state.transactions += 1;
      return callback();
    },
    insertBlocks: (blocks: EditorPartialBlock[], reference: string) => {
      const index = state.document.findIndex((block) => block.id === reference);
      const materialized = blocks.map((block) => block as EditorBlock);
      state.document.splice(index + 1, 0, ...materialized);
      return materialized;
    },
    removeBlocks: (ids: string[]) => {
      const removed = state.document.filter((block) => ids.includes(block.id));
      state.document = state.document.filter((block) => !ids.includes(block.id));
      return removed;
    },
    setSelection: (start: string, end: string) => {
      const startIndex = state.document.findIndex((block) => block.id === start);
      const endIndex = state.document.findIndex((block) => block.id === end);
      state.selectedIds = state.document
        .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
        .map((block) => block.id);
    },
    setTextCursorPosition: (id: string) => {
      state.selectedIds = [id];
    },
  };
  return { editor: editor as unknown as EditorInstance, state };
}

describe("contiguous block actions", () => {
  it("duplicates a selected group once and refreshes every nested UUID", () => {
    const child = paragraph(THIRD, "child");
    const { editor, state } = fakeEditor(
      [paragraph(FIRST, "first", [child]), paragraph(SECOND, "second")],
      [FIRST, SECOND],
    );

    const copiedIds = duplicateSelectedBlocks(editor);

    expect(state.transactions).toBe(1);
    expect(state.document).toHaveLength(4);
    expect(new Set(copiedIds).size).toBe(2);
    expect(copiedIds).not.toContain(FIRST);
    expect(copiedIds).not.toContain(SECOND);
    const nestedCopy = (state.document[2]?.children as EditorBlock[] | undefined)?.[0];
    expect(nestedCopy?.id).not.toBe(THIRD);
  });

  it("refuses a non-contiguous group", () => {
    const { editor } = fakeEditor(
      [paragraph(FIRST, "first"), paragraph(SECOND, "second"), paragraph(THIRD, "third")],
      [FIRST, THIRD],
    );

    expect(() => resolveContiguousBlockSelection(editor)).toThrow("contigus");
  });

  it("deletes the whole document in one gesture but leaves one fresh editable block", () => {
    const { editor, state } = fakeEditor(
      [paragraph(FIRST, "first"), paragraph(SECOND, "second")],
      [FIRST, SECOND],
    );

    deleteSelectedBlocks(editor);

    expect(state.transactions).toBe(1);
    expect(state.document).toHaveLength(1);
    expect(state.document[0]).toMatchObject({ type: "paragraph" });
    expect(state.document[0]?.id).not.toBe(FIRST);
  });
});

describe("stable block drag translation", () => {
  it("orders a moved group from the final tail back toward its destination", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const third = paragraph(THIRD, "third");
    const changes = [second, third].map((block) => ({
      type: "move" as const,
      block,
      prevBlock: block,
      source: { type: "drop" as const },
    })) as EditorBlocksChanged;

    expect(
      stableMoveChanges(changes, [second, third, first]).map((change) => change.block.id),
    ).toEqual([THIRD, SECOND]);
    expect(validateBlockDrop(changes, [second, third, first])).toBeNull();
  });

  it("explains an identity collision and leaves refusal handling to the caller", () => {
    const first = paragraph(FIRST, "first");
    const duplicate = paragraph(FIRST, "duplicate");
    const changes = [
      { type: "move", block: first, prevBlock: first, source: { type: "drop" } },
    ] as EditorBlocksChanged;

    expect(validateBlockDrop(changes, [first, duplicate])).toContain("même identité");
  });
});

describe("keyboard alternatives", () => {
  it("maps local history and block actions before the browser handles them", () => {
    expect(
      editorShortcutAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      editorShortcutAction({
        key: "ArrowUp",
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe("move-up");
    expect(
      editorShortcutAction({
        key: "Enter",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("insert-after");
    expect(historyActionFromInputType("historyUndo")).toBe("undo");
    expect(MARKDOWN_INSERTION_SHORTCUTS).toContain("# ");
  });

  it("does not claim an unrelated shortcut", () => {
    const preventDefault = vi.fn();
    expect(
      editorShortcutAction({
        key: "x",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
