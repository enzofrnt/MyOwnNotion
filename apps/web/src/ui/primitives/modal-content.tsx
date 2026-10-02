import { Dialog as AriakitDialog, type DialogProps } from "@ariakit/react";
import { forwardRef } from "react";
import { useModalAriaRef } from "./modal-aria.ts";
/** Internal modal mechanics shared by dialog and drawer; wrappers own presentation. */
export const ModalContent = forwardRef<HTMLDivElement, DialogProps>(function ModalContent(
  {
    autoFocusOnHide = true,
    autoFocusOnShow = true,
    backdrop,
    className,
    hideOnEscape = true,
    modal = true,
    portal = true,
    ...props
  },
  ref,
) {
  const modalRef = useModalAriaRef(ref, modal);
  return (
    <AriakitDialog
      {...props}
      ref={modalRef}
      autoFocusOnHide={autoFocusOnHide}
      autoFocusOnShow={autoFocusOnShow}
      className={className}
      backdrop={backdrop ?? <div className="ui-dialog__backdrop" />}
      hideOnEscape={hideOnEscape}
      modal={modal}
      portal={portal}
      aria-modal={modal || undefined}
    />
  );
});
