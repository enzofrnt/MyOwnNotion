import { Dialog as AriakitDialog, type DialogProps as AriakitDialogProps } from "@ariakit/react";
import { forwardRef } from "react";
import { classNames } from "../class-names.ts";

export {
  DialogDescription as DrawerDescription,
  DialogDismiss as DrawerDismiss,
  DialogHeading as DrawerHeading,
  DialogRoot as DrawerRoot,
  DialogTrigger as DrawerTrigger,
} from "./dialog.tsx";

export type DrawerSide = "left" | "right" | "bottom";

export type DrawerContentProps = Omit<AriakitDialogProps, "className"> & {
  readonly className?: string;
  readonly side?: DrawerSide;
};

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(function DrawerContent(
  {
    autoFocusOnHide = true,
    autoFocusOnShow = true,
    backdrop,
    className,
    hideOnEscape = true,
    modal = true,
    portal = true,
    side = "left",
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
      className={classNames("ui-drawer", className)}
      data-side={side}
      backdrop={backdrop ?? <div className="ui-dialog__backdrop" />}
      hideOnEscape={hideOnEscape}
      modal={modal}
      portal={portal}
      aria-modal={modal || undefined}
    />
  );
});
