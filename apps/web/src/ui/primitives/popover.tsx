import {
  Popover as AriakitPopover,
  PopoverDescription as AriakitPopoverDescription,
  type PopoverDescriptionProps as AriakitPopoverDescriptionProps,
  PopoverDisclosure as AriakitPopoverDisclosure,
  type PopoverDisclosureProps as AriakitPopoverDisclosureProps,
  PopoverDismiss as AriakitPopoverDismiss,
  type PopoverDismissProps as AriakitPopoverDismissProps,
  PopoverHeading as AriakitPopoverHeading,
  type PopoverHeadingProps as AriakitPopoverHeadingProps,
  type PopoverProps as AriakitPopoverProps,
  PopoverProvider as AriakitPopoverProvider,
  type PopoverProviderProps as AriakitPopoverProviderProps,
} from "@ariakit/react";
import { forwardRef } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";
import { AppIcon } from "../icons.tsx";

export type PopoverRootProps = AriakitPopoverProviderProps;

export function PopoverRoot(props: PopoverRootProps) {
  return <AriakitPopoverProvider {...props} />;
}

export type PopoverTriggerProps = Omit<AriakitPopoverDisclosureProps, "className"> & {
  readonly className?: string;
};

export const PopoverTrigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  function PopoverTrigger({ className, ...props }, ref) {
    return (
      <AriakitPopoverDisclosure
        {...props}
        ref={ref}
        className={classNames("ui-button", "ui-popover__trigger", className)}
        data-variant="secondary"
      />
    );
  },
);

export type PopoverContentProps = Omit<AriakitPopoverProps, "className"> & {
  readonly className?: string;
};

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent({ className, gutter = 8, portal = true, ...props }, ref) {
    return (
      <AriakitPopover
        {...props}
        ref={ref}
        className={classNames("ui-popover", className)}
        gutter={gutter}
        portal={portal}
      />
    );
  },
);

export type PopoverHeadingProps = Omit<AriakitPopoverHeadingProps, "className"> & {
  readonly className?: string;
};

export const PopoverHeading = forwardRef<HTMLHeadingElement, PopoverHeadingProps>(
  function PopoverHeading({ className, ...props }, ref) {
    return (
      <AriakitPopoverHeading
        {...props}
        ref={ref}
        className={classNames("ui-overlay__heading", className)}
      />
    );
  },
);

export type PopoverDescriptionProps = Omit<AriakitPopoverDescriptionProps, "className"> & {
  readonly className?: string;
};

export const PopoverDescription = forwardRef<HTMLParagraphElement, PopoverDescriptionProps>(
  function PopoverDescription({ className, ...props }, ref) {
    return (
      <AriakitPopoverDescription
        {...props}
        ref={ref}
        className={classNames("ui-overlay__description", className)}
      />
    );
  },
);

export type PopoverDismissProps = Omit<AriakitPopoverDismissProps, "className"> & {
  readonly className?: string;
};

export const PopoverDismiss = forwardRef<HTMLButtonElement, PopoverDismissProps>(
  function PopoverDismiss({ children, className, ...props }, ref) {
    return (
      <AriakitPopoverDismiss
        {...props}
        ref={ref}
        className={classNames("ui-button", "ui-overlay__dismiss", className)}
        aria-label={props["aria-label"] ?? FR_COPY.actions.close}
        data-size="square"
        data-variant="ghost"
      >
        {children ?? <AppIcon name="close" />}
      </AriakitPopoverDismiss>
    );
  },
);
