import {
  type HTMLAttributes,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { classNames } from "../../ui/class-names.ts";

export const COLLAPSIBLE_REGION_DURATION_MS = 210;
export const COLLAPSIBLE_REGION_CLEANUP_FALLBACK_MS = 2_000;

export interface CollapsibleRegionProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly children: ReactNode;
  readonly open: boolean;
  readonly lazy?: boolean;
}

/** A zero-residue, lazy region with matching opening and closing motion. */
export function CollapsibleRegion({
  children,
  className,
  lazy = false,
  onTransitionEnd,
  open,
  ...props
}: CollapsibleRegionProps) {
  const [present, setPresent] = useState(open || !lazy);
  const [visible, setVisible] = useState(open);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingFrames = useRef<number[]>([]);

  const cancelOpeningFrames = useCallback((): void => {
    for (const frame of openingFrames.current) cancelAnimationFrame(frame);
    openingFrames.current = [];
  }, []);

  useEffect(() => {
    if (closingTimer.current !== null) {
      clearTimeout(closingTimer.current);
      closingTimer.current = null;
    }
    cancelOpeningFrames();

    if (open) {
      if (!present) {
        setPresent(true);
        return;
      }
      // Keep one painted collapsed frame after a lazy mount. A single RAF can
      // run before the browser has committed the 0fr style and would make the
      // first opening jump straight to its final height.
      const first = requestAnimationFrame(() => {
        const second = requestAnimationFrame(() => {
          openingFrames.current = [];
          setVisible(true);
        });
        openingFrames.current = [second];
      });
      openingFrames.current = [first];
      return;
    }

    setVisible(false);
    if (lazy && present) {
      // The element leaves the tree when its real grid transition completes.
      // A timer equal to the CSS duration races the final painted frame and,
      // under a busy event loop, can remove the content while the browser still
      // reports an active transition. Keep only a generous fallback for reduced
      // motion or engines that omit transitionend entirely; the closed region is
      // already zero-height, hidden and inert while that fallback is pending.
      closingTimer.current = setTimeout(() => {
        closingTimer.current = null;
        setPresent(false);
      }, COLLAPSIBLE_REGION_CLEANUP_FALLBACK_MS);
    }
  }, [cancelOpeningFrames, lazy, open, present]);

  const handleTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>): void => {
      onTransitionEnd?.(event);
      if (
        event.target !== event.currentTarget ||
        event.propertyName !== "grid-template-rows" ||
        open ||
        !lazy
      ) {
        return;
      }
      if (closingTimer.current !== null) {
        clearTimeout(closingTimer.current);
        closingTimer.current = null;
      }
      setPresent(false);
    },
    [lazy, onTransitionEnd, open],
  );

  useEffect(
    () => () => {
      if (closingTimer.current !== null) clearTimeout(closingTimer.current);
      cancelOpeningFrames();
    },
    [cancelOpeningFrames],
  );

  if (!present) return null;

  return (
    <div
      {...props}
      className={classNames("collapsible-region", className)}
      data-open={visible}
      data-state={visible ? "open" : "closed"}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="collapsible-region__inner">{children}</div>
    </div>
  );
}
