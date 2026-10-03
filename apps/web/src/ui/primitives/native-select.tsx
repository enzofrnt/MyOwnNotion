import { forwardRef, type SelectHTMLAttributes } from "react";
import { classNames } from "../class-names.ts";

export type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  readonly density?: "comfortable" | "compact";
};

/** Retains native selection, FormData, multiple and keyboard behaviour. */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  { className, density = "comfortable", ...props },
  ref,
) {
  return (
    <select
      {...props}
      ref={ref}
      className={classNames("ui-native-select", className)}
      data-size={density === "compact" ? "compact" : undefined}
    />
  );
});
