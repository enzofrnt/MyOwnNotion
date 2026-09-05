import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const MIN_THUMB_PX = 28;

export interface OverlayScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * Replaces the host scrollbar with a fixed-width DOM thumb. macOS overlay
 * scrollbars ignore `::-webkit-scrollbar` sizing and expand on hover; hiding
 * the native bar is the only reliable override.
 */
export function OverlayScrollArea({ children, className, style, testId }: OverlayScrollAreaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(
    null,
  );
  const [scrollable, setScrollable] = useState(false);

  const syncThumb = useCallback(() => {
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    const track = thumb?.parentElement;
    if (viewport === null || thumb === null || track == null) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const canScroll = scrollHeight > clientHeight + 1;
    setScrollable(canScroll);
    if (!canScroll) {
      return;
    }
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const scrollRange = scrollHeight - clientHeight;
    const thumbTop = scrollRange <= 0 ? 0 : (scrollTop / scrollRange) * maxThumbTop;
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    syncThumb();
    const observer = new ResizeObserver(() => {
      syncThumb();
    });
    observer.observe(viewport);
    if (viewport.firstElementChild instanceof HTMLElement) {
      observer.observe(viewport.firstElementChild);
    }
    return () => observer.disconnect();
  }, [syncThumb]);

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: viewport.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    const track = thumbRef.current?.parentElement;
    if (drag === null || viewport === null || track == null || drag.pointerId !== event.pointerId) {
      return;
    }
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.max(
      MIN_THUMB_PX,
      (viewport.clientHeight / viewport.scrollHeight) * trackHeight,
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const scrollRange = viewport.scrollHeight - viewport.clientHeight;
    if (maxThumbTop <= 0 || scrollRange <= 0) {
      return;
    }
    const deltaY = event.clientY - drag.startY;
    const scrollDelta = (deltaY / maxThumbTop) * scrollRange;
    viewport.scrollTop = drag.startScrollTop + scrollDelta;
  };

  const onThumbPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const classNames = ["ui-overlay-scroll", className].filter(Boolean).join(" ");

  return (
    <div
      ref={rootRef}
      className={classNames}
      style={style}
      data-scrollable={scrollable ? "true" : "false"}
      data-testid={testId}
    >
      <div ref={viewportRef} className="ui-overlay-scroll__viewport" onScroll={syncThumb}>
        {children}
      </div>
      <div className="ui-overlay-scroll__track" aria-hidden="true">
        <div
          ref={thumbRef}
          className="ui-overlay-scroll__thumb"
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={onThumbPointerUp}
          onPointerCancel={onThumbPointerUp}
        />
      </div>
    </div>
  );
}
