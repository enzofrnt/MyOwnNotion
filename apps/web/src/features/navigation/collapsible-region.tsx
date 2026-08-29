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
export const COLLAPSIBLE_JOIN_FALLBACK_PX = 6;
export const TREE_JOIN_RADIUS_DURATION_VAR = "--tree-join-radius-duration";

export interface CollapsibleRegionProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly children: ReactNode;
  readonly open: boolean;
  readonly lazy?: boolean;
  /** Keep a visual join with the previous sibling until the remaining height
   *  is two corner radii, then spend exactly the leftover close time rounding. */
  readonly joinPrevious?: boolean;
}

export function previousTreeRow(region: HTMLElement): HTMLElement | null {
  const previous = region.previousElementSibling;
  if (!(previous instanceof HTMLElement)) return null;
  if (previous.matches(".tree-row")) return previous;
  return previous.querySelector(".tree-row");
}

export function joinThresholdPx(region: HTMLElement): number {
  const row = previousTreeRow(region);
  if (row === null) return COLLAPSIBLE_JOIN_FALLBACK_PX;
  const radius = Number.parseFloat(getComputedStyle(row).borderTopLeftRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : COLLAPSIBLE_JOIN_FALLBACK_PX;
}

export function joinReleaseHeightPx(region: HTMLElement): number {
  return 2 * joinThresholdPx(region);
}

export function remainingCloseMs(startedAt: number, now: number): number {
  return Math.max(0, COLLAPSIBLE_REGION_DURATION_MS - (now - startedAt));
}

/** CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1). */
const EASE_X1 = 0.25;
const EASE_Y1 = 0.1;
const EASE_X2 = 0.25;
const EASE_Y2 = 1;

function unitBezier(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

function unitBezierDerivative(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

function solveEaseT(x: number): number {
  let t = x;
  for (let step = 0; step < 8; step += 1) {
    const delta = unitBezier(t, EASE_X1, EASE_X2) - x;
    const slope = unitBezierDerivative(t, EASE_X1, EASE_X2);
    if (Math.abs(slope) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - delta / slope));
  }
  return t;
}

export function cssEase(progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  return unitBezier(solveEaseT(x), EASE_Y1, EASE_Y2);
}

export function invertCssEase(progress: number): number {
  const y = Math.min(1, Math.max(0, progress));
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step += 1) {
    const mid = (low + high) / 2;
    if (cssEase(mid) < y) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function joinReleasePlan(
  startHeight: number,
  radius: number,
): { readonly delayMs: number; readonly radiusMs: number } {
  const releaseHeight = 2 * Math.max(radius, COLLAPSIBLE_JOIN_FALLBACK_PX);
  const remainingRatio = Math.min(1, releaseHeight / Math.max(startHeight, 1));
  const delayMs = Math.round(invertCssEase(1 - remainingRatio) * COLLAPSIBLE_REGION_DURATION_MS);
  return {
    delayMs,
    radiusMs: Math.max(16, COLLAPSIBLE_REGION_DURATION_MS - delayMs),
  };
}

function joinDurationTargets(region: HTMLElement): HTMLElement[] {
  return [previousTreeRow(region), region.parentElement].filter(
    (element): element is HTMLElement => element !== null,
  );
}

function applyJoinRadiusDuration(region: HTMLElement, durationMs: number): void {
  const value = `${Math.round(durationMs)}ms`;
  for (const target of joinDurationTargets(region)) {
    target.style.setProperty(TREE_JOIN_RADIUS_DURATION_VAR, value);
  }
}

function clearJoinRadiusDuration(region: HTMLElement): void {
  for (const target of joinDurationTargets(region)) {
    target.style.removeProperty(TREE_JOIN_RADIUS_DURATION_VAR);
  }
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** A zero-residue, lazy region with matching opening and closing motion. */
export function CollapsibleRegion({
  children,
  className,
  joinPrevious = false,
  lazy = false,
  onTransitionEnd,
  open,
  ...props
}: CollapsibleRegionProps) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [present, setPresent] = useState(open || !lazy);
  const [visible, setVisible] = useState(open);
  const [joined, setJoined] = useState(open);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingFrames = useRef<number[]>([]);
  const joinFrame = useRef(0);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelOpeningFrames = useCallback((): void => {
    for (const frame of openingFrames.current) cancelAnimationFrame(frame);
    openingFrames.current = [];
  }, []);

  const cancelJoinWatch = useCallback((): void => {
    if (joinFrame.current !== 0) {
      cancelAnimationFrame(joinFrame.current);
      joinFrame.current = 0;
    }
    if (joinTimer.current !== null) {
      clearTimeout(joinTimer.current);
      joinTimer.current = null;
    }
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

  useEffect(() => {
    if (!joinPrevious) return;
    const region = regionRef.current;
    if (open || prefersReducedMotion()) {
      cancelJoinWatch();
      if (region !== null) clearJoinRadiusDuration(region);
      setJoined(open);
      return;
    }
    if (!present) {
      cancelJoinWatch();
      setJoined(false);
      return;
    }
    if (region === null) return;

    const startedAt = performance.now();
    const startHeight = region.getBoundingClientRect().height;
    const radius = joinThresholdPx(region);
    const releaseHeight = 2 * radius;
    const plan = joinReleasePlan(startHeight, radius);
    applyJoinRadiusDuration(region, plan.radiusMs);

    const release = (durationMs: number): void => {
      cancelJoinWatch();
      applyJoinRadiusDuration(region, durationMs);
      setJoined(false);
    };

    joinTimer.current = setTimeout(() => {
      joinTimer.current = null;
      release(remainingCloseMs(startedAt, performance.now()));
    }, plan.delayMs);

    const tick = (): void => {
      const height = region.getBoundingClientRect().height;
      if (height <= 1) {
        release(40);
        return;
      }
      if (height <= releaseHeight) {
        release(remainingCloseMs(startedAt, performance.now()));
        return;
      }
      joinFrame.current = requestAnimationFrame(tick);
    };
    joinFrame.current = requestAnimationFrame(tick);
    return cancelJoinWatch;
  }, [cancelJoinWatch, joinPrevious, open, present]);

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
      cancelJoinWatch();
    },
    [cancelJoinWatch, cancelOpeningFrames],
  );

  if (!present) return null;

  return (
    <div
      {...props}
      ref={regionRef}
      className={classNames("collapsible-region", className)}
      data-open={visible}
      data-state={visible ? "open" : "closed"}
      data-joined={joinPrevious && joined ? true : undefined}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="collapsible-region__inner">{children}</div>
    </div>
  );
}
