import {
  Dialog as AriakitDialog,
  DialogDescription as AriakitDialogDescription,
  type DialogDescriptionProps as AriakitDialogDescriptionProps,
  DialogDisclosure as AriakitDialogDisclosure,
  type DialogDisclosureProps as AriakitDialogDisclosureProps,
  DialogDismiss as AriakitDialogDismiss,
  type DialogDismissProps as AriakitDialogDismissProps,
  DialogHeading as AriakitDialogHeading,
  type DialogHeadingProps as AriakitDialogHeadingProps,
  type DialogProps as AriakitDialogProps,
  DialogProvider as AriakitDialogProvider,
  type DialogProviderProps as AriakitDialogProviderProps,
} from "@ariakit/react";
import { forwardRef } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";
import { AppIcon } from "../icons.tsx";

export type DialogRootProps = AriakitDialogProviderProps;

export function DialogRoot(props: DialogRootProps) {
  return <AriakitDialogProvider {...props} />;
}

export type DialogTriggerProps = Omit<AriakitDialogDisclosureProps, "className"> & {
  readonly className?: string;
};

export const DialogTrigger = forwardRef<HTMLButtonElement, DialogTriggerProps>(
  function DialogTrigger({ className, ...props }, ref) {
    return (
      <AriakitDialogDisclosure
        {...props}
        ref={ref}
        className={classNames("ui-button", "ui-dialog__trigger", className)}
        data-variant="secondary"
      />
    );
  },
);

export type DialogContentProps = Omit<AriakitDialogProps, "className"> & {
  readonly className?: string;
  readonly size?: "small" | "medium" | "large";
};

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  {
    autoFocusOnHide = true,
    autoFocusOnShow = true,
    backdrop,
    className,
    hideOnEscape = true,
    modal = true,
    portal = true,
    size = "medium",
    ...props
  },
  ref,
) {
  return (
    <AriakitDialog
      {...props}
      ref={ref}
      autoFocusOnHide={autoFocusOnHide}
      autoFocusOnShow={autoFocusOnShow}
      className={classNames("ui-dialog", className)}
      data-size={size}
      backdrop={backdrop ?? <div className="ui-dialog__backdrop" />}
      hideOnEscape={hideOnEscape}
      modal={modal}
      portal={portal}
      aria-modal={modal || undefined}
    />
  );
});

export type DialogHeadingProps = Omit<AriakitDialogHeadingProps, "className"> & {
  readonly className?: string;
};

export const DialogHeading = forwardRef<HTMLHeadingElement, DialogHeadingProps>(
  function DialogHeading({ className, ...props }, ref) {
    return (
      <AriakitDialogHeading
        {...props}
        ref={ref}
        className={classNames("ui-overlay__heading", className)}
      />
    );
  },
);

export type DialogDescriptionProps = Omit<AriakitDialogDescriptionProps, "className"> & {
  readonly className?: string;
};

export const DialogDescription = forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  function DialogDescription({ className, ...props }, ref) {
    return (
      <AriakitDialogDescription
        {...props}
        ref={ref}
        className={classNames("ui-overlay__description", className)}
      />
    );
  },
);

export type DialogDismissProps = Omit<AriakitDialogDismissProps, "className"> & {
  readonly className?: string;
};

export const DialogDismiss = forwardRef<HTMLButtonElement, DialogDismissProps>(
  function DialogDismiss({ children, className, ...props }, ref) {
    return (
      <AriakitDialogDismiss
        {...props}
        ref={ref}
        className={classNames("ui-button", "ui-overlay__dismiss", className)}
        aria-label={props["aria-label"] ?? FR_COPY.actions.close}
        data-size="square"
        data-variant="ghost"
      >
        {children ?? <AppIcon name="close" />}
      </AriakitDialogDismiss>
    );
  },
);
