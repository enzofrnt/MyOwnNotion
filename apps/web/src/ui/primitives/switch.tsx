import { type ButtonHTMLAttributes, forwardRef } from "react";
import { classNames } from "../class-names.ts";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

/** Compact boolean control with native button keyboard behaviour. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, className, disabled, onCheckedChange, onClick, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={classNames("ui-switch", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
    >
      <span className="ui-switch__thumb" aria-hidden="true" />
    </button>
  );
});
