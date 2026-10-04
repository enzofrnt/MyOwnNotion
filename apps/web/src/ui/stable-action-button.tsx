import { type CSSProperties, useEffect, useState } from "react";
import { Button, type ButtonProps } from "./primitives/button.tsx";

interface StableActionButtonProps extends Omit<ButtonProps, "onClick"> {
  readonly onActivate: (trigger: HTMLButtonElement) => void;
  readonly pinDuringPointer?: boolean;
}

/** Semantic activation preserves pointer cancellation and keyboard/assistive clicks. */
export function StableActionButton({
  onActivate,
  pinDuringPointer = false,
  onPointerDown,
  style,
  ...buttonProps
}: StableActionButtonProps) {
  const [pinned, setPinned] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (pinned === null) return;
    let frame: number | undefined;
    // Keep the physical target through native pointerup/click dispatch. No
    // pointer capture: releasing outside still cancels the semantic click.
    const release = (): void => {
      frame = requestAnimationFrame(() => setPinned(null));
    };
    window.addEventListener("pointerup", release, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
    window.addEventListener("blur", release, { once: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [pinned]);
  return (
    <Button
      {...buttonProps}
      style={pinned === null ? style : { ...style, ...pinned }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!pinDuringPointer || event.defaultPrevented || event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setPinned({
          position: "fixed",
          left: rect.left,
          top: rect.top,
          right: "auto",
          bottom: "auto",
          width: rect.width,
          height: rect.height,
          margin: 0,
          transform: "none",
          opacity: 1,
        });
      }}
      onClick={(event) => {
        // This adapter owns submission; do not also submit the surrounding form.
        if (event.currentTarget.type === "submit") event.preventDefault();
        onActivate(event.currentTarget);
      }}
    />
  );
}
