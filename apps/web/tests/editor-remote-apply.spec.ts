// @vitest-environment jsdom
import type { Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EditorBlock,
  EditorInstance,
  EditorPartialBlock,
} from "../src/features/editor/blocknote-schema.ts";
import {
  applyRemoteEditorProjection,
  applyRemoteProjectionIfEditorIdle,
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
  options: { readonly root?: HTMLDivElement; readonly focused?: boolean } = {},
) {
  const state = {
    document: structuredClone(initial) as EditorBlock[],
    activeBlockId,
    localEchoes: 0,
    cursorMoves: 0,
    focusCalls: 0,
    focused: options.focused ?? false,
  };
  const touch = (): void => {
    if (origin.acceptLocalChanges) state.localEchoes += 1;
  };
  const lookup = (id: string): EditorBlock | undefined =>
    state.document.find((block) => block.id === id);
  const editor = {
    domElement: options.root,
    isFocused: () => state.focused,
    focus: () => {
      state.focused = true;
      state.focusCalls += 1;
    },
    get document() {
      return state.document;
    },
    getBlock: lookup,
    getTextCursorPosition: () => ({ block: lookup(state.activeBlockId) }),
    setTextCursorPosition: (id: string) => {
      state.activeBlockId = id as Uuid;
      state.cursorMoves += 1;
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
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("treats omitted leaf children as an empty collection", () => {
    const { children: _currentChildren, ...currentLeaf } = paragraph(FIRST, "before");
    const { children: _nextChildren, ...nextLeaf } = paragraph(FIRST, "after");

    expect(
      planRemoteEditorChanges([currentLeaf as EditorBlock], [nextLeaf as EditorBlock]),
    ).toEqual([{ type: "update", block: nextLeaf }]);
  });

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

  it("projects an adopted remote frontier synchronously before the next idle gesture", () => {
    const apply = vi.fn();

    expect(
      applyRemoteProjectionIfEditorIdle({
        localInputActive: false,
        localCommitsInFlight: 0,
        apply,
      }),
    ).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("keeps a remote projection pending while local offsets or commits are active", () => {
    const apply = vi.fn();

    expect(
      applyRemoteProjectionIfEditorIdle({
        localInputActive: true,
        localCommitsInFlight: 0,
        apply,
      }),
    ).toBe(false);
    expect(
      applyRemoteProjectionIfEditorIdle({
        localInputActive: false,
        localCommitsInFlight: 1,
        apply,
      }),
    ).toBe(false);
    expect(apply).not.toHaveBeenCalled();
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

  it("keeps the exact mapped caret when another block is updated", () => {
    const origin = new EditorOriginGuard();
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const edited = paragraph(FIRST, "first, remotely edited");
    const { editor, state } = fakeEditor([first, second], SECOND, origin);

    const result = applyRemoteEditorProjection({ editor, origin, next: [edited, second] });

    expect(result.restoredSelection).toBeNull();
    expect(state.cursorMoves).toBe(0);
    expect(state.activeBlockId).toBe(SECOND);
  });

  it("does not steal focus from controls outside the editor", () => {
    const root = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(root, outside);
    outside.focus();
    const origin = new EditorOriginGuard();
    const first = paragraph(FIRST, "first");
    const edited = paragraph(FIRST, "remotely edited");
    const { editor, state } = fakeEditor([first], FIRST, origin, { root, focused: false });

    applyRemoteEditorProjection({ editor, origin, next: [edited] });

    expect(document.activeElement).toBe(outside);
    expect(state.cursorMoves).toBe(0);
    expect(state.focusCalls).toBe(0);
  });

  it("restores the visible block anchor after a remote reorder", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="bn-block-outer" data-id="${FIRST}">first</div>
      <div class="bn-block-outer" data-id="${SECOND}">second</div>`;
    document.body.append(root);
    const origin = new EditorOriginGuard();
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const { editor, state } = fakeEditor([first, second], FIRST, origin, {
      root,
      focused: true,
    });
    let scrollY = 200;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    window.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object") scrollY = Number(options.top ?? scrollY);
    }) as typeof window.scrollTo;
    for (const element of root.querySelectorAll<HTMLElement>("[data-id]")) {
      element.getBoundingClientRect = () => {
        if (element.dataset["id"] === FIRST) {
          return { top: -1_000, bottom: -100 } as DOMRect;
        }
        const top = state.document[0]?.id === SECOND ? 200 : -100;
        return { top, bottom: top + 900 } as DOMRect;
      };
    }

    applyRemoteEditorProjection({ editor, origin, next: [second, first] });

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 500 });
    expect(state.focusCalls).toBe(0);
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

  it("leaves an identical projection — and the caret within it — completely untouched", () => {
    const origin = new EditorOriginGuard();
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const { editor, state } = fakeEditor([first, second], SECOND, origin);

    // A handover or echoed merge replays exactly what is visible. Reasserting
    // even the cursor would collapse an open range selection and dismiss
    // selection-driven UI mid-gesture.
    const result = applyRemoteEditorProjection({ editor, origin, next: [first, second] });

    expect(result.targetedChanges).toEqual([]);
    expect(result.repairedProjection).toBe(false);
    expect(result.restoredSelection).toBeNull();
    expect(state.cursorMoves).toBe(0);
    expect(state.localEchoes).toBe(0);
    expect(state.activeBlockId).toBe(SECOND);
  });

  it("ignores editor-only representation differences when canonical content is unchanged", () => {
    const origin = new EditorOriginGuard();
    const durable = paragraph(FIRST, "typing stays focused");
    const visible = {
      ...durable,
      props: { ...durable.props, transientEditorDecoration: "active" },
    } as EditorBlock;
    const { editor, state } = fakeEditor([visible], FIRST, origin);

    // Raw BlockNote props differ, so the targeted planner would propose an
    // update. The canonical projection deliberately ignores that editor-only
    // decoration; an acknowledgement/handover must therefore be a DOM no-op.
    expect(planRemoteEditorChanges([visible], [durable])).toHaveLength(1);
    const result = applyRemoteEditorProjection({ editor, origin, next: [durable] });

    expect(result.targetedChanges).toEqual([]);
    expect(result.repairedProjection).toBe(false);
    expect(state.cursorMoves).toBe(0);
    expect(state.document).toEqual([visible]);
  });
});
