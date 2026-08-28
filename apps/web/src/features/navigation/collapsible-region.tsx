import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { classNames } from "../../ui/class-names.ts";

export const COLLAPSIBLE_REGION_DURATION_MS = 180;

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
  open,
  ...props
}: CollapsibleRegionProps) {
  const [present, setPresent] = useState(open || !lazy);
  const [visible, setVisible] = useState(open);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingFrame = useRef<number | null>(null);

  useEffect(() => {
    if (closingTimer.current !== null) {
      clearTimeout(closingTimer.current);
      closingTimer.current = null;
    }
    if (openingFrame.current !== null) {
      cancelAnimationFrame(openingFrame.current);
      openingFrame.current = null;
    }

    if (open) {
      setPresent(true);
      openingFrame.current = requestAnimationFrame(() => {
        openingFrame.current = null;
        setVisible(true);
      });
      return;
    }

    setVisible(false);
    if (lazy && present) {
      closingTimer.current = setTimeout(() => {
        closingTimer.current = null;
        setPresent(false);
      }, COLLAPSIBLE_REGION_DURATION_MS);
    }
  }, [lazy, open, present]);

  useEffect(
    () => () => {
      if (closingTimer.current !== null) clearTimeout(closingTimer.current);
      if (openingFrame.current !== null) cancelAnimationFrame(openingFrame.current);
    },
    [],
  );

  if (!present) return null;

  return (
    <div
      {...props}
      className={classNames("collapsible-region", className)}
      data-open={visible || undefined}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
    >
      <div className="collapsible-region__inner">{children}</div>
    </div>
  );
}
