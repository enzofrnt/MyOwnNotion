// @vitest-environment jsdom
import { Virtualizer } from "@tanstack/react-virtual";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeTableScrollOffset } from "../src/features/databases/table-scroll-observer.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("table scroll measurements", () => {
  it("preserves the new bottom when iOS flushes an older deferred measurement", () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 });
    const main = document.createElement("main");
    document.body.append(main);
    Object.defineProperties(main, { clientHeight: { value: 100 }, scrollHeight: { value: 1100 } });
    const writes: number[] = [];
    const instance = new Virtualizer<HTMLElement, HTMLElement>({
      count: 20,
      initialOffset: 500,
      initialRect: { width: 300, height: 100 },
      getScrollElement: () => main,
      estimateSize: () => 44,
      observeElementRect: (_instance, callback) => {
        callback({ width: 300, height: 100 });
        return () => {};
      },
      observeElementOffset: observeTableScrollOffset,
      scrollToFn: (offset, { adjustments }) => {
        main.scrollTop = offset + (adjustments ?? 0);
        writes.push(main.scrollTop);
      },
    });
    const unmount = instance._didMount();
    try {
      instance._willUpdate();
      instance.getVirtualItems();
      // The virtualizer (3.14.26) defers a correction on iOS only while a
      // touch gesture owns the scroll; a scroll event alone no longer does.
      main.dispatchEvent(new Event("touchstart"));
      main.scrollTop = 501;
      main.dispatchEvent(new Event("scroll"));
      main.dispatchEvent(new Event("touchend"));
      expect(instance.isScrolling).toBe(true);
      writes.length = 0;
      instance.resizeItem(0, 35);
      expect(writes).toEqual([]);
      // A new page-scroll intent arrives before its queued native scroll event.
      // The idle callback still carries 501, while the real viewport is at 1000.
      main.scrollTop = 1000;
      vi.advanceTimersByTime(instance.options.isScrollingResetDelay);
      expect(instance.isScrolling).toBe(false);
      // The held correction (the row above shrank by 9 px) is applied to the
      // viewport's *current* position. Had the stale 501 been used, the write
      // would have rewound the page to 492 and thrown away the owner's scroll.
      expect(writes).toEqual([991]);
      expect(main.scrollTop).toBe(991);
      expect(instance.scrollOffset).toBe(991);
    } finally {
      unmount();
    }
  });

  it("observes native movement, refreshes idle geometry and disconnects", () => {
    vi.useFakeTimers();
    const main = document.createElement("main");
    const callback = vi.fn();
    const instance = new Virtualizer<HTMLElement, HTMLElement>({
      count: 0,
      getScrollElement: () => main,
      estimateSize: () => 44,
      observeElementRect: () => undefined,
      observeElementOffset: observeTableScrollOffset,
      scrollToFn: () => {},
    });
    // The observation API is shared by page-flow and bounded table scrollports.
    instance.scrollElement = main;
    instance.targetWindow = window;
    const disconnect = observeTableScrollOffset(instance, callback);
    main.scrollTop = 240;
    main.dispatchEvent(new Event("scroll"));
    expect(callback).toHaveBeenLastCalledWith(240, true);
    main.scrollTop = 260;
    vi.advanceTimersByTime(instance.options.isScrollingResetDelay);
    expect(callback).toHaveBeenLastCalledWith(260, false);
    main.scrollTop = 280;
    main.dispatchEvent(new Event("scroll"));
    disconnect?.();
    callback.mockClear();
    vi.runOnlyPendingTimers();
    main.dispatchEvent(new Event("scroll"));
    expect(callback).not.toHaveBeenCalled();
  });
});
