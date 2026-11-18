import type { ReactNode } from "react";
import { AppIcon } from "../icons.tsx";

export interface FormMessageProps {
  readonly children?: ReactNode | null;
  readonly kind?: "error" | "info";
  readonly testId?: string;
}

/**
 * One line of feedback that never moves the layout.
 *
 * The slot is always laid out (one line high), so an error appearing or
 * disappearing cannot push the fields or the action around; the message itself
 * is only mounted when there is something to say. Pair it with `invalid` fields
 * so the error is also carried by the red field, not by this text alone.
 */
export function FormMessage({ children, kind = "error", testId }: FormMessageProps) {
  const has = children !== null && children !== undefined && children !== false;
  return (
    <div className="ui-form-message-slot">
      {has ? (
        <p
          className="ui-form-message"
          data-kind={kind}
          role={kind === "error" ? "alert" : "status"}
          data-testid={testId}
        >
          <AppIcon name={kind === "error" ? "conflict" : "info"} size="small" />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}
