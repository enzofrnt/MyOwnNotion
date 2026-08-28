import { type MouseEvent, type PointerEvent, useRef } from "react";
import { Button, type ButtonProps } from "./primitives/button.tsx";

interface StableActionButtonProps extends Omit<ButtonProps, "onClick" | "onPointerDown"> {
  readonly onActivate: (trigger: HTMLButtonElement) => void;
}

/**
 * A button whose pointer action survives a React remount before `click`.
 *
 * WebKit can deliver `pointerdown`, let a concurrent local-first projection
 * replace the control, and then have no original node left on which to emit
 * `click`. Durable actions start from that first event; keyboard and assistive
 * activation keep using the semantic click. The timestamp suppresses the
 * compatibility click produced by the same physical pointer gesture.
 */
export function StableActionButton({ onActivate, ...buttonProps }: StableActionButtonProps) {
  const action = useRef(onActivate);
  action.current = onActivate;
  const lastPointerActivation = useRef(Number.NEGATIVE_INFINITY);

  const activateFromPointer = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!event.isPrimary || event.button !== 0 || event.currentTarget.disabled) return;
    lastPointerActivation.current = event.timeStamp;
    event.preventDefault();
    action.current(event.currentTarget);
  };
  const activateFromClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // When this component owns a submit action, it also owns the semantic
    // click that Enter and assistive technology produce. Preventing the native
    // form submit avoids invoking the same action once here and once through
    // the form's submit event.
    if (event.currentTarget.type === "submit") event.preventDefault();
    const followsPointer =
      event.detail > 0 && event.timeStamp - lastPointerActivation.current < 1_000;
    if (!followsPointer) action.current(event.currentTarget);
  };

  return (
    <Button {...buttonProps} onPointerDown={activateFromPointer} onClick={activateFromClick} />
  );
}
