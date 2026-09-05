// @vitest-environment jsdom
import type { PageScrollAnchor } from "@myownnotion/client-core";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePageScrollRestoration } from "../src/features/editor/use-page-scroll-restoration.ts";

const remembered = { blockId: null, offset: 0, fallbackPixel: 640 };
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let cleanup = () => {};
afterEach(() => {
  cleanup();
  frames.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const host = document.createElement("main");
  host.className = "workspace-main";
  host.scrollTo = vi.fn((options: ScrollToOptions | number) => {
    if (typeof options === "object") host.scrollTop = options.top ?? 0;
  }) as typeof host.scrollTo;
  document.body.append(host);
  const root = createRoot(host);
  function Surface({
    active,
    anchor,
    filled,
  }: {
    active: boolean;
    anchor: PageScrollAnchor | null;
    filled: boolean;
  }) {
    const ref = useRef<HTMLDivElement | null>(null);
    usePageScrollRestoration(true, active, anchor, ref);
    return (
      <div ref={ref}>
        {filled ? <div className="bn-block-outer" data-id="visible-block" /> : null}
      </div>
    );
  }
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return {
    host,
    render: (active = true, anchor: PageScrollAnchor | null = remembered, filled = true) =>
      act(() => root.render(<Surface active={active} anchor={anchor} filled={filled} />)),
    frame: () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
      }),
  };
}

it("restores after a presentation update arrives before the first animation frame", () => {
  const view = fixture();
  view.render();
  view.render(true, { ...remembered, fallbackPixel: 0 });
  view.frame();
  expect(view.host.scrollTop).toBe(640);
  view.host.scrollTop = 320;
  view.render(true, { ...remembered, fallbackPixel: 900 });
  view.frame();
  expect(view.host.scrollTop).toBe(320);
  view.render(false);
  view.render(true, { ...remembered, fallbackPixel: 900 });
  view.frame();
  expect(view.host.scrollTop).toBe(900);
});

it("waits for page blocks and lets a new user gesture cancel hydration retries", () => {
  const view = fixture();
  view.render(true, remembered, false);
  view.frame();
  expect(view.host.scrollTo).not.toHaveBeenCalled();
  view.render(true, remembered, true);
  act(() => vi.advanceTimersByTime(120));
  expect(view.host.scrollTop).toBe(640);
  view.render(false);
  view.host.scrollTop = 0;
  view.render(true, remembered, false);
  view.frame();
  window.dispatchEvent(new Event("wheel"));
  view.render(true, remembered, true);
  act(() => vi.advanceTimersByTime(1200));
  expect(view.host.scrollTop).toBe(0);
});

it("does not restore hidden sessions or pages with no remembered position", () => {
  const view = fixture();
  view.render(false);
  view.frame();
  view.render(true, null);
  view.frame();
  expect(view.host.scrollTo).not.toHaveBeenCalled();
});
