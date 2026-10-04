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
      main.scrollTop = 501;
      main.dispatchEvent(new Event("scroll"));
      expect(instance.isScrolling).toBe(true);
      writes.length = 0;
      instance.resizeItem(0, 35);
      expect(writes).toEqual([]);
      // A new page-scroll intent arrives before its queued native scroll event.
      // The idle callback still carries 501, while the real viewport is at 1000.
      main.scrollTop = 1000;
      vi.advanceTimersByTime(instance.options.isScrollingResetDelay);
      expect(instance.isScrolling).toBe(false);
      expect(main.scrollTop).toBe(1000);
      expect(instance.scrollOffset).toBe(1000);
      expect(writes).toEqual([]);
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
