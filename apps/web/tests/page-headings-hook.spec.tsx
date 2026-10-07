// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HeadingsEditor,
  type PageHeading,
  usePageHeadings,
} from "../src/features/editor/page-headings.ts";

function heading(id: string, text: string, level = 1): unknown {
  return { id, type: "heading", props: { level }, content: [{ text }] };
}

function testEditor(document: readonly unknown[]) {
  const listeners = new Set<() => void>();
  return {
    document,
    onChange(callback: () => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit() {
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

describe("heading projection during editor transactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function flushFrame() {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    });
  }

  function Probe({
    editor,
    onRender,
  }: {
    readonly editor: HeadingsEditor;
    readonly onRender: (headings: readonly PageHeading[]) => void;
  }) {
    const headings = usePageHeadings(editor);
    useLayoutEffect(() => onRender(headings), [headings, onRender]);
    return <output>{JSON.stringify(headings)}</output>;
  }

  function mount(editor: HeadingsEditor, onRender = vi.fn()) {
    act(() => root.render(<Probe editor={editor} onRender={onRender} />));
    onRender.mockClear();
    return onRender;
  }

  it("keeps ordinary typing out of React commits and leaves the durable listener running", () => {
    const editor = testEditor([heading("h", "Stable"), { id: "p", type: "paragraph" }]);
    const onRender = mount(editor);
    const persist = vi.fn();
    editor.onChange(persist);
    act(() => {
      for (let index = 0; index < 100; index++) {
        editor.document = [
          heading("h", "Stable"),
          { id: "p", type: "paragraph", content: [{ text: "x".repeat(index + 1) }] },
        ];
        editor.emit();
      }
    });
    expect(persist).toHaveBeenCalledTimes(100);
    expect(onRender).not.toHaveBeenCalled();
    flushFrame();
    expect(onRender).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Stable");
  });

  it("does not feed React commits back into unchanged editor notifications", () => {
    const editor = testEditor([heading("h", "Stable")]);
    // React node views can notify their editor while committing. A projection
    // which dispatches fresh arrays for an unchanged outline creates a render
    // loop and throws before later transaction listeners can persist the input.
    const onRender = vi.fn(() => editor.emit());
    expect(() => mount(editor, onRender)).not.toThrow();
    flushFrame();
    expect(onRender).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("publishes the latest titles after the transaction burst without synchronous React work", () => {
    const editor = testEditor([]);
    const onRender = mount(editor);
    act(() => {
      for (let index = 1; index <= 100; index++) {
        editor.document = [heading("h", `Title ${index}`)];
        editor.emit();
      }
    });
    expect(onRender).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrame();
    expect(onRender).toHaveBeenCalledExactlyOnceWith([{ id: "h", level: 1, text: "Title 100" }]);
  });

  it("updates identity, level, order and removal even when visible text stays equal", () => {
    const editor = testEditor([heading("a", "Same"), heading("b", "Same", 2)]);
    const onRender = mount(editor);
    for (const [document, expected] of [
      [
        [heading("a", "Same", 3), heading("b", "Same", 2)],
        ["a", "b"],
      ],
      [
        [heading("b", "Same", 2), heading("a", "Same", 3)],
        ["b", "a"],
      ],
      [
        [heading("c", "Same", 2), heading("a", "Same", 3)],
        ["c", "a"],
      ],
      [[heading("c", "Same", 2)], ["c"]],
      [[], []],
    ] as const) {
      act(() => {
        editor.document = document;
        editor.emit();
      });
      flushFrame();
      const result = JSON.parse(container.textContent ?? "[]") as PageHeading[];
      expect(result.map(({ id }) => id)).toEqual(expected);
      expect(result).toEqual(
        document.map((block) => {
          const value = block as {
            id: string;
            props: { level: number };
            content: { text: string }[];
          };
          return { id: value.id, level: value.props.level, text: value.content[0]?.text };
        }),
      );
    }
    expect(onRender).toHaveBeenCalledTimes(5);
  });

  it("discards a previous editor's queued projection and removes its subscription", () => {
    const oldEditor = testEditor([heading("old", "Old")]);
    const onRender = mount(oldEditor);
    act(() => {
      oldEditor.document = [heading("old", "Stale")];
      oldEditor.emit();
    });
    const editor = testEditor([heading("new", "Current")]);
    mount(editor, onRender);
    expect(oldEditor.listeners.size).toBe(0);
    expect(frames.size).toBe(0);
    flushFrame();
    expect(container.textContent).toContain("Current");
    expect(container.textContent).not.toContain("Stale");
  });

  it("cancels queued updates and the editor subscription when unmounted", () => {
    const editor = testEditor([]);
    mount(editor);
    act(() => {
      editor.document = [heading("h", "Pending")];
      editor.emit();
    });
    act(() => root.render(null));
    expect(editor.listeners.size).toBe(0);
    expect(frames.size).toBe(0);
  });
});
