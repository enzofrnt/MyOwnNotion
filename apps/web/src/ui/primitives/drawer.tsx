import type { DialogProps as AriakitDialogProps } from "@ariakit/react";
import { forwardRef } from "react";
import { classNames } from "../class-names.ts";
import { ModalContent } from "./modal-content.tsx";

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
  { className, side = "left", ...props },
  ref,
) {
  return (
    <ModalContent
      {...props}
      ref={ref}
      className={classNames("ui-drawer", className)}
      data-side={side}
    />
  );
});
