import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.ts";

export type InputSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  readonly children: ReactNode;
  readonly density?: "comfortable" | "compact";
};

/** One input boundary for a NativeInput composed with icons or removable tokens. */
export function InputSurface({
  children,
  className,
  density = "comfortable",
  ...props
}: InputSurfaceProps) {
  return (
    <div
      {...props}
      className={classNames("ui-input-surface", className)}
      data-size={density === "compact" ? "compact" : undefined}
    >
      {children}
    </div>
  );
}
