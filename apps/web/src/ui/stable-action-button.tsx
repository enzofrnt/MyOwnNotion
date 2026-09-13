import { Button, type ButtonProps } from "./primitives/button.tsx";

interface StableActionButtonProps extends Omit<ButtonProps, "onClick"> {
  readonly onActivate: (trigger: HTMLButtonElement) => void;
}

/** Semantic activation preserves pointer cancellation and keyboard/assistive clicks. */
export function StableActionButton({ onActivate, ...buttonProps }: StableActionButtonProps) {
  return (
    <Button
      {...buttonProps}
      onClick={(event) => {
        // This adapter owns submission; do not also submit the surrounding form.
        if (event.currentTarget.type === "submit") event.preventDefault();
        onActivate(event.currentTarget);
      }}
    />
  );
}
