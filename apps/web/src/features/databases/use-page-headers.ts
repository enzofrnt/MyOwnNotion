import { type RefObject, useLayoutEffect, useRef } from "react";

type ScrollTimelineConstructor = new (options: {
  source: HTMLElement;
  axis: "x";
}) => AnimationTimeline;

/** Native sticky on Y; the body's scroll timeline owns the header's X motion. */
export function usePageHeaders(
  surface: RefObject<HTMLElement | null>,
  viewport: { readonly element: HTMLElement | null; readonly pageFlow: boolean },
  header: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
): void {
  const refresh = useRef<(() => void) | null>(null);
  useLayoutEffect(() => refresh.current?.());
  useLayoutEffect(() => {
    const element = surface.current;
    const scrollport = viewport.element;
    const headerRail = header.current;
    const bodyRail = body.current;
    if (
      element === null ||
      scrollport === null ||
      headerRail === null ||
      bodyRail === null ||
      !viewport.pageFlow
    )
      return;

    const track = headerRail.firstElementChild;
    if (!(track instanceof HTMLElement)) return;
    const Timeline = (window as Window & { ScrollTimeline?: ScrollTimelineConstructor })
      .ScrollTimeline;
    const timeline = Timeline === undefined ? null : new Timeline({ source: bodyRail, axis: "x" });
    let animation: Animation | null = null;
    let previousRange = -1;
    const syncFallback = () => {
      if (timeline === null) track.style.transform = `translateX(${-bodyRail.scrollLeft}px)`;
    };

    // This inset changes with layout, never with the page's scroll position.
    const paths = [...scrollport.querySelectorAll<HTMLElement>(".workspace-page-title__path")];
    const measureInset = () => {
      let inset = 0;
      for (const path of paths) {
        if (path.getClientRects().length === 0) continue;
        const top = Number.parseFloat(getComputedStyle(path).top) || 0;
        inset = Math.max(inset, top + path.getBoundingClientRect().height);
      }
      element.style.setProperty("--database-page-header-top", `${inset}px`);
      // The breakout margin is resolved against the reading column. Resolve
      // it here before inheriting it in rails whose own width is the page.
      const gutter = Math.max(
        0,
        -Number.parseFloat(getComputedStyle(element).marginInlineStart) || 0,
      );
      element.style.setProperty("--database-rail-gutter", `${gutter}px`);
    };
    const measure = () => {
      measureInset();
      const range = Math.max(0, bodyRail.scrollWidth - bodyRail.clientWidth);
      if (timeline !== null && range !== previousRange) {
        const frames = [{ transform: "translateX(0px)" }, { transform: `translateX(${-range}px)` }];
        if (animation === null) {
          animation = track.animate(frames, {
            timeline,
            duration: "auto",
            fill: "both",
            easing: "linear",
          });
        } else if (animation.effect instanceof KeyframeEffect) {
          animation.effect.setKeyframes(frames);
        }
      }
      previousRange = range;
      syncFallback();
    };
    const horizontalGesture = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const delta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      if (delta === 0 || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(delta))) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? bodyRail.clientWidth
            : 1;
      event.preventDefault();
      bodyRail.scrollLeft += delta * unit;
      syncFallback();
    };
    const revealHeaderControl = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const control = event.target.getBoundingClientRect();
      const bounds = headerRail.getBoundingClientRect();
      // Breakout rails can extend fractionally past the viewport in WebKit.
      // Reveal the whole control and its focus ring inside both clipping edges.
      const left = Math.max(0, bounds.left) + 4;
      const right = Math.min(window.innerWidth, bounds.right) - 4;
      if (control.left < left) bodyRail.scrollLeft += control.left - left;
      else if (control.right > right) bodyRail.scrollLeft += control.right - right;
      syncFallback();
    };
    if (timeline === null) {
      bodyRail.addEventListener("scroll", syncFallback, { passive: true });
      // On older engines the gesture moves body and header in the same turn.
      bodyRail.addEventListener("wheel", horizontalGesture, { passive: false });
    }
    headerRail.addEventListener("wheel", horizontalGesture, { passive: false });
    headerRail.addEventListener("focusin", revealHeaderControl);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    observer?.observe(scrollport);
    observer?.observe(bodyRail);
    observer?.observe(track);
    if (bodyRail.firstElementChild !== null) observer?.observe(bodyRail.firstElementChild);
    for (const path of paths) observer?.observe(path);
    refresh.current = measure;
    measure();
    return () => {
      refresh.current = null;
      observer?.disconnect();
      animation?.cancel();
      track.style.removeProperty("transform");
      bodyRail.removeEventListener("scroll", syncFallback);
      bodyRail.removeEventListener("wheel", horizontalGesture);
      headerRail.removeEventListener("wheel", horizontalGesture);
      headerRail.removeEventListener("focusin", revealHeaderControl);
      element.style.removeProperty("--database-page-header-top");
      element.style.removeProperty("--database-rail-gutter");
    };
  }, [surface, viewport.element, viewport.pageFlow, header, body]);
}
