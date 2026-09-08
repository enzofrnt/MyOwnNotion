import type { PageScrollAnchor } from "@myownnotion/client-core";
import { type RefObject, useEffect, useRef } from "react";
import { editorScrollContainer, restoreScrollAnchor } from "./editor-view-state.ts";

/** A presentation refresh must not cancel the first restoration frame. */
export function usePageScrollRestoration(
  ready: boolean,
  active: boolean,
  remembered: PageScrollAnchor | null,
  rootRef: RefObject<HTMLElement | null>,
): void {
  const latest = useRef(remembered);
  latest.current = remembered;
  useEffect(() => {
    if (!ready || !active || latest.current === null) return;
    // Snapshot once per activation. Scroll persistence can publish new objects
    // while this frame is queued; those are observations, not a new navigation.
    const anchor = latest.current;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const attempt = (): void => {
      if (stopped) return;
      const root = rootRef.current;
      const scroller = root === null ? null : editorScrollContainer(root);
      if (root !== null && root.querySelector(".bn-block-outer[data-id]") !== null) {
        restoreScrollAnchor(anchor, root);
        if (
          scroller === null
            ? window.scrollY > 0 || document.documentElement.scrollHeight <= window.innerHeight
            : scroller.scrollTop > 0 || scroller.scrollHeight <= scroller.clientHeight
        )
          return;
      }
      attempts += 1;
      if (attempts < 10) timer = setTimeout(attempt, 120);
    };
    const stop = (): void => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // A user's new gesture takes priority over delayed hydration retries.
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    const frame = requestAnimationFrame(attempt);
    return () => {
      stop();
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [ready, active, rootRef]);
}
