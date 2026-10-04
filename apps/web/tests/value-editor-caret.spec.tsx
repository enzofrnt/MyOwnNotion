// @vitest-environment jsdom
import { asUuid, type DatabaseProperty } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValueEditor } from "../src/features/databases/value-editor.tsx";

const property: DatabaseProperty = {
  id: asUuid("018f4000-0000-7000-8000-000000000004"),
  name: "Notes",
  type: "text",
  positionKey: "a",
  state: "active",
  config: {},
};

describe("inline value editor caret ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(16);
    });
  };

  const render = (input = "previous note", chosen = property) => {
    act(() =>
      root.render(
        <ValueEditor
          property={chosen}
          input={input}
          error={null}
          presentation="inline"
          onChange={vi.fn()}
        />,
      ),
    );
    const field = container.querySelector<HTMLInputElement>("input");
    if (field === null) throw new Error("Missing inline input");
    return field;
  };

  it("starts with a focused caret at the end of the existing text", () => {
    const field = render();
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([13, 13]);
    flushFrames();
    expect([field.selectionStart, field.selectionEnd]).toEqual([13, 13]);
  });

  it("keeps a selection made to replace the old text before the next frame", () => {
    const field = render();
    field.select();
    flushFrames();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 13]);
    expect(field.value).toBe("previous note");
  });

  it("keeps a native edit and its selection before React receives the input event", () => {
    const field = render();
    field.value = "native replacement";
    field.setSelectionRange(2, 6);
    render("projected replacement");
    flushFrames();
    expect(field.value).toBe("native replacement");
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
  });

  it("does not take focus back after the owner chooses another control", () => {
    const field = render();
    const other = document.createElement("button");
    container.append(other);
    other.focus();
    flushFrames();
    expect(document.activeElement).toBe(other);
    expect(field.value).toBe("previous note");
  });

  it("focuses a native date without trying to set an unsupported text selection", () => {
    const field = render("2026-10-04", {
      ...property,
      type: "date",
      config: { mode: "date" },
    });
    flushFrames();
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("2026-10-04");
    expect(field.selectionStart).toBeNull();
  });
});
