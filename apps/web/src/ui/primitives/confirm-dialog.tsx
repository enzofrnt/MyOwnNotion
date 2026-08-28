import type { ReactNode } from "react";
import { FR_COPY } from "../copy/index.ts";
import { Button } from "./button.tsx";
import {
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
} from "./dialog.tsx";

export interface ConfirmDialogProps {
  readonly busy?: boolean;
  readonly cancelLabel?: ReactNode;
  readonly cancelTestId?: string;
  readonly children?: ReactNode;
  readonly confirmLabel?: ReactNode;
  readonly confirmTestId?: string;
  readonly description: ReactNode;
  readonly destructive?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
  readonly portal?: boolean;
  readonly testId?: string;
  readonly title: ReactNode;
}

/** A single, themed replacement for native and feature-specific confirms. */
export function ConfirmDialog({
  busy = false,
  cancelLabel = FR_COPY.actions.cancel,
  cancelTestId,
  children,
  confirmLabel = FR_COPY.actions.confirm,
  confirmTestId,
  description,
  destructive = true,
  onCancel,
  onConfirm,
  open,
  portal = true,
  testId,
  title,
}: ConfirmDialogProps) {
  return (
    <DialogRoot
      open={open}
      setOpen={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <DialogContent
        className="ui-confirm-dialog"
        data-testid={testId}
        hideOnEscape={!busy}
        portal={portal}
        role="alertdialog"
        size="small"
      >
        <DialogHeading>{title}</DialogHeading>
        <DialogDescription>{description}</DialogDescription>
        {children === undefined ? null : (
          <div className="ui-confirm-dialog__content">{children}</div>
        )}
        <div className="ui-confirm-dialog__actions">
          <Button data-testid={cancelTestId} disabled={busy} onClick={onCancel} variant="ghost">
            {cancelLabel}
          </Button>
          <Button
            busy={busy}
            data-testid={confirmTestId}
            onClick={onConfirm}
            variant={destructive ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </div>
        <DialogDismiss disabled={busy} />
      </DialogContent>
    </DialogRoot>
  );
}
