import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.ts";

export interface LiveRegionProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly politeness?: "polite" | "assertive";
  readonly visible?: boolean;
}

export function LiveRegion({
  children,
  className,
  politeness = "polite",
  visible = false,
  ...props
}: LiveRegionProps) {
  return (
    <div
      {...props}
      className={classNames(!visible && "ui-visually-hidden", className)}
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
    >
      {children}
    </div>
  );
}
