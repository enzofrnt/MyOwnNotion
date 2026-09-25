import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { classNames } from "../class-names.ts";
import {
  type DottedCanvasViewport,
  updateDottedCanvasBackground,
} from "./dotted-canvas-background.ts";

export interface DottedCanvasBackgroundProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** When set, syncs gap and position; omit for a static 20px grid. */
  readonly viewport?: DottedCanvasViewport;
  readonly testId?: string;
}

/**
 * Full-bleed dotted plane. Put interactive canvas content as children (or a
 * sibling with higher z-index). Safe to reuse on any pan/zoom surface.
 */
export function DottedCanvasBackground({
  children,
  className,
  style,
  testId,
  viewport,
}: DottedCanvasBackgroundProps) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (host.current === null || viewport === undefined) return;
    updateDottedCanvasBackground(host.current, viewport);
  }, [viewport]);

  return (
    <div
      ref={host}
      className={classNames("ui-dotted-canvas-background", className)}
      style={style}
      data-testid={testId}
      aria-hidden={children === undefined ? true : undefined}
    >
      {children}
    </div>
  );
}
