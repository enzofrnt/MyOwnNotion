// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureTableViewport,
  useTableViewport,
} from "../src/features/databases/use-table-viewport.ts";

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 44,
    left: 0,
    right: 320,
    width: 320,
    height: 44,
    x: 0,
    y: top,
    toJSON: () => ({ top }),
  };
}
function fixture(flow: string | null) {
  const main = document.createElement("main");
  main.className = "workspace-main";
  main.innerHTML = `<div class="${flow ?? "bounded-table"}"><section><table><tbody></tbody></table></section></div>`;
  document.body.append(main);
  const surface = main.querySelector("section");
  const body = main.querySelector("tbody");
  if (surface === null || body === null) throw new Error("Missing table");
  vi.spyOn(surface, "getClientRects").mockReturnValue([rect(180)] as unknown as DOMRectList);
  vi.spyOn(main, "getBoundingClientRect").mockReturnValue(rect(50));
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(rect(180));
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(224));
  main.scrollTop = 400;
  return { main, surface, body };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("table viewport in page flow", () => {
  it.each(["database-container-page", "editor-database-view-block"])(
    "observes the workspace for %s, including the tbody offset",
    (flow) => {
      const { main, surface, body } = fixture(flow);
      expect(measureTableViewport(surface)).toEqual({
        element: main,
        scrollMargin: 574,
        headerHeight: 44,
        pageFlow: true,
      });
      // A normal scroll changes both rectangles and offset, not the content origin.
      main.scrollTop = 450;
      vi.mocked(body.getBoundingClientRect).mockReturnValue(rect(174));
      expect(measureTableViewport(surface).scrollMargin).toBe(574);
    },
  );
  it("keeps the bounded table's own vertical viewport and header margin", () => {
    const { surface } = fixture(null);
    surface.scrollTop = 80;
    expect(measureTableViewport(surface)).toEqual({
      element: surface,
      scrollMargin: 124,
      headerHeight: 124,
      pageFlow: false,
    });
  });
  it("does not bind retained hidden tabs to the active workspace", () => {
    const { surface } = fixture("editor-database-view-block");
    vi.mocked(surface.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    expect(measureTableViewport(surface).element).toBeNull();
    expect(measureTableViewport(null).element).toBeNull();
  });
  it("re-measures title layout and visibility, and disconnects on unmount", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { main, surface, body } = fixture("editor-database-view-block");
    let resize: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const host = document.createElement("div");
    main.append(host);
    const root = createRoot(host);
    let latest: ReturnType<typeof useTableViewport> | undefined;
    function Probe() {
      const ref = useRef<HTMLElement | null>(surface);
      latest = useTableViewport(ref);
      return null;
    }
    act(() => root.render(createElement(Probe)));
    expect(latest?.element).toBe(main);
    expect(main.scrollTop).toBe(400);
    expect(observe).toHaveBeenCalledWith(main);
    vi.mocked(body.getBoundingClientRect).mockReturnValue(rect(264));
    act(resize);
    expect(latest?.scrollMargin).toBe(614);
    vi.mocked(surface.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    act(resize);
    expect(latest?.element).toBeNull();
    vi.mocked(surface.getClientRects).mockReturnValue([rect(180)] as unknown as DOMRectList);
    act(resize);
    expect(latest?.element).toBe(main);
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
