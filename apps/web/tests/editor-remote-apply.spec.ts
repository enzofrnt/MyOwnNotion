import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type {
  EditorBlock,
  EditorInstance,
  EditorPartialBlock,
} from "../src/features/editor/blocknote-schema.ts";
import {
  applyRemoteEditorProjection,
  EditorOriginGuard,
  planRemoteEditorChanges,
  restoreStableSelection,
} from "../src/features/editor/editor-remote-apply.ts";

const FIRST = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;
const SECOND = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057" as Uuid;
const THIRD = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2058" as Uuid;

function paragraph(id: Uuid, text: string): EditorBlock {
  return {
    id,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  } as EditorBlock;
}

function fakeEditor(
  initial: readonly EditorBlock[],
  activeBlockId: Uuid,
  origin: EditorOriginGuard,
) {
  const state = {
    document: structuredClone(initial) as EditorBlock[],
    activeBlockId,
    localEchoes: 0,
  };
  const touch = (): void => {
    if (origin.acceptLocalChanges) state.localEchoes += 1;
  };
  const lookup = (id: string): EditorBlock | undefined =>
    state.document.find((block) => block.id === id);
  const editor = {
    get document() {
      return state.document;
    },
    getBlock: lookup,
    getTextCursorPosition: () => ({ block: lookup(state.activeBlockId) }),
    setTextCursorPosition: (id: string) => {
      state.activeBlockId = id as Uuid;
    },
    transact: (callback: () => unknown) => callback(),
    removeBlocks: (ids: readonly string[]) => {
      const removed = state.document.filter((block) => ids.includes(block.id));
      state.document = state.document.filter((block) => !ids.includes(block.id));
      touch();
      return removed;
    },
    insertBlocks: (
      blocks: readonly EditorPartialBlock[],
      referenceId: string,
      placement: "before" | "after",
    ) => {
      const referenceIndex = state.document.findIndex((block) => block.id === referenceId);
      if (referenceIndex < 0) throw new Error(`missing reference ${referenceId}`);
      const materialized = structuredClone(blocks) as EditorBlock[];
      const index = placement === "before" ? referenceIndex : referenceIndex + 1;
      state.document.splice(index, 0, ...materialized);
      touch();
      return materialized;
    },
    updateBlock: (id: string, update: EditorPartialBlock) => {
      const index = state.document.findIndex((block) => block.id === id);
      const current = state.document[index];
      if (index < 0 || current === undefined) throw new Error(`missing block ${id}`);
      state.document[index] = {
        ...current,
        ...structuredClone(update),
        id: current.id,
        children: current.children,
      } as EditorBlock;
      touch();
      return state.document[index];
    },
    replaceBlocks: (_removed: readonly unknown[], blocks: readonly EditorPartialBlock[]) => {
      state.document = structuredClone(blocks) as EditorBlock[];
      touch();
    },
    nestBlock: () => undefined,
  };
  return { editor: editor as unknown as EditorInstance, state };
}

describe("targeted remote application", () => {
  it("plans a move and a text update without rebuilding unrelated blocks", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const edited = paragraph(SECOND, "second, remotely edited");

    expect(planRemoteEditorChanges([first, second], [edited, first])).toEqual([
      { type: "move", blockId: SECOND, parentBlockId: null, beforeBlockId: FIRST },
      { type: "update", block: edited },
    ]);
  });

  it("suppresses local callbacks while applying a remote or recovery batch", () => {
    const guard = new EditorOriginGuard();
    const emitted: string[] = [];

    guard.run("remote", () => {
      if (guard.acceptLocalChanges) emitted.push("echo");
      expect(guard.origin).toBe("remote");
    });

    expect(emitted).toEqual([]);
    expect(guard.acceptLocalChanges).toBe(true);
    expect(guard.origin).toBe("local");
  });

  it("applies the targeted move and edit without echo and keeps the active UUID", () => {
    const origin = new EditorOriginGuard();
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const edited = paragraph(SECOND, "second, remotely edited");
    const { editor, state } = fakeEditor([first, second], SECOND, origin);

    const result = applyRemoteEditorProjection({ editor, origin, next: [edited, first] });

    expect(state.document).toEqual([edited, first]);
    expect(state.localEchoes).toBe(0);
    expect(result.repairedProjection).toBe(false);
    expect(result.targetedChanges.map((change) => change.type)).toEqual(["move", "update"]);
    expect(result.restoredSelection).toEqual({ activeBlockId: SECOND, placement: "end" });
    expect(origin.acceptLocalChanges).toBe(true);
  });

  it("keeps a selection on the same UUID and falls back to the logical neighbour", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const third = paragraph(THIRD, "third");
    const selection = { activeBlockId: SECOND, placement: "end" as const };

    expect(restoreStableSelection(selection, [third, second, first])).toEqual(selection);
    expect(restoreStableSelection(selection, [first, third], [first, second, third])).toEqual({
      activeBlockId: THIRD,
      placement: "start",
    });
  });
});
