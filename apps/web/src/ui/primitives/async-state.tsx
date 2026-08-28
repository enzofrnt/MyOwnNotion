import type { ReactNode } from "react";
import { classNames } from "../class-names.ts";
import { Status, type StatusKind } from "./status.tsx";

export interface AsyncStateProps {
  readonly action?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
  readonly description?: ReactNode;
  readonly kind: StatusKind;
  readonly state?: string;
  readonly title?: ReactNode;
  readonly testId?: string;
}

/**
 * Shared presentation for loading, empty, offline, success and recoverable
 * failure states. Feature components provide meaning and actions; this
 * primitive keeps geometry, urgency and theme treatment consistent.
 */
export function AsyncState({
  action,
  className,
  compact = false,
  description,
  kind,
  state,
  testId,
  title,
}: AsyncStateProps) {
  return (
    <Status
      className={classNames("ui-async-state", className)}
      data-compact={compact || undefined}
      data-testid={testId}
      kind={kind}
      {...(state === undefined ? {} : { state })}
      title={title}
    >
      {description === undefined ? null : (
        <div className="ui-async-state__description">{description}</div>
      )}
      {action === undefined ? null : <div className="ui-async-state__action">{action}</div>}
    </Status>
  );
}
