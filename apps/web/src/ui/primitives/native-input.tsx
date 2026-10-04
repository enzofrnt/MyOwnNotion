import { forwardRef, type InputHTMLAttributes } from "react";
import { classNames } from "../class-names.ts";

export type NativeInputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly density?: "comfortable" | "compact";
};

/** Native form control for compositions that cannot use the complete Field wrapper. */
export const NativeInput = forwardRef<HTMLInputElement, NativeInputProps>(function NativeInput(
  { className, density = "comfortable", ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      className={classNames("ui-native-input", className)}
      data-size={density === "compact" ? "compact" : undefined}
    />
  );
});
