import { Button as AriakitButton, type ButtonProps as AriakitButtonProps } from "@ariakit/react";
import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from "react";
import { classNames } from "../class-names.ts";
import { AppIcon } from "../icons.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "compact" | "default" | "square";

export type ButtonProps = Omit<AriakitButtonProps, "className"> & {
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    busy = false,
    children,
    className,
    disabled = false,
    size = "default",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  return (
    <AriakitButton
      {...props}
      ref={ref}
      type={type}
      className={classNames("ui-button", className)}
      data-size={size}
      data-variant={variant}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
    >
      {busy ? <AppIcon name="loading" size="small" /> : null}
      <span className="ui-button__label">{children}</span>
    </AriakitButton>
  );
});

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly children: ReactNode;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
};

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { children, className, size = "default", variant = "secondary", ...props },
  ref,
) {
  return (
    <a
      {...props}
      ref={ref}
      className={classNames("ui-button", className)}
      data-size={size}
      data-variant={variant}
    >
      <span className="ui-button__label">{children}</span>
    </a>
  );
});
