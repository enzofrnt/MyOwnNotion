import { observeElementOffset } from "@tanstack/react-virtual";

/** Layout or a new page gesture can move the viewport before its scroll event. */
export const observeTableScrollOffset: typeof observeElementOffset<HTMLElement> = (
  instance,
  callback,
) =>
  observeElementOffset(instance, (offset, scrolling) => {
    // The library's idle debounce carries the last event's offset. Refresh it
    // before iOS flushes size corrections, so it preserves the current anchor.
    callback(scrolling ? offset : (instance.scrollElement?.scrollTop ?? offset), scrolling);
  });
