import type { ReactNode } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";
import { Skeleton, type SkeletonProps } from "./skeleton.tsx";
import { Status, type StatusKind } from "./status.tsx";

export interface AsyncStateProps {
  readonly action?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
  readonly description?: ReactNode;
  readonly kind: StatusKind;
  readonly loadingLayout?: SkeletonProps["layout"];
  readonly loadingRows?: number;
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
  loadingLayout = "lines",
  loadingRows,
  state,
  testId,
  title,
}: AsyncStateProps) {
  return (
    <Status
      className={classNames(
        "ui-async-state",
        kind === "loading" && "ui-async-state--loading",
        className,
      )}
      data-compact={compact || undefined}
      data-testid={testId}
      kind={kind}
      data-loading-layout={kind === "loading" ? loadingLayout : undefined}
      {...(state === undefined ? {} : { state })}
      title={
        kind === "loading" ? (
          <span className="ui-visually-hidden">{title ?? FR_COPY.status.loading}</span>
        ) : (
          title
        )
      }
    >
      {kind === "loading" ? (
        <Skeleton layout={loadingLayout} rows={loadingRows ?? (compact ? 1 : 3)} />
      ) : null}
      {description === undefined ? null : (
        <div
          className={classNames(
            "ui-async-state__description",
            kind === "loading" && "ui-visually-hidden",
          )}
        >
          {description}
        </div>
      )}
      {action === undefined ? null : <div className="ui-async-state__action">{action}</div>}
    </Status>
  );
}
