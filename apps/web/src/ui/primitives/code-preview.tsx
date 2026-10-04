import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../class-names.ts";

export type CodePreviewProps = HTMLAttributes<HTMLPreElement> & {
  readonly prose?: boolean;
};

/** Preserved content, with local scrolling for code or readable wrapping for prose. */
export const CodePreview = forwardRef<HTMLPreElement, CodePreviewProps>(function CodePreview(
  { className, prose = false, ...props },
  ref,
) {
  return (
    <pre
      {...props}
      ref={ref}
      className={classNames("ui-code-preview", className)}
      data-prose={prose || undefined}
      tabIndex={props.tabIndex ?? 0}
    />
  );
});
