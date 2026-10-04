import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../class-names.ts";

/** Document section, without card chrome. The caller owns headings and actions. */
export const Section = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Section(
  { className, ...props },
  ref,
) {
  return <section {...props} ref={ref} className={classNames("ui-section", className)} />;
});
