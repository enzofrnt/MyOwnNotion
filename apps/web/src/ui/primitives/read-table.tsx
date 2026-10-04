import { forwardRef, type TableHTMLAttributes } from "react";
import { classNames } from "../class-names.ts";

export type ReadTableProps = TableHTMLAttributes<HTMLTableElement> & {
  readonly scrollLabel: string;
};

/** Read-only tables share scroll and chrome; specialised editable grids stay independent. */
export const ReadTable = forwardRef<HTMLTableElement, ReadTableProps>(function ReadTable(
  { className, scrollLabel, ...props },
  ref,
) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll a wide comparison table.
    <section className="ui-table-scroll" aria-label={scrollLabel} tabIndex={0}>
      <table {...props} ref={ref} className={classNames("ui-read-table", className)} />
    </section>
  );
});
