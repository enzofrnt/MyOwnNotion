import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";
import { AppIcon, type AppIconName } from "../icons.tsx";

export type StatusKind =
  | "loading"
  | "empty"
  | "unavailable"
  | "offline"
  | "error"
  | "success"
  | "conflict"
  | "pending"
  | "syncing"
  | "info";

const STATUS_ICONS: Readonly<Record<StatusKind, AppIconName>> = {
  loading: "loading",
  empty: "info",
  unavailable: "offline",
  offline: "offline",
  error: "conflict",
  success: "success",
  conflict: "conflict",
  pending: "sync",
  syncing: "loading",
  info: "info",
};

export interface StatusProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly children?: ReactNode;
  readonly kind: StatusKind;
  readonly title?: ReactNode;
}

export function Status({ children, className, kind, title, ...props }: StatusProps) {
  const urgent = kind === "error" || kind === "conflict";
  const busy = kind === "loading" || kind === "syncing";
  return (
    <div
      {...props}
      className={classNames("ui-status", className)}
      data-state={kind}
      role={urgent ? "alert" : "status"}
      aria-busy={busy || undefined}
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <AppIcon name={STATUS_ICONS[kind]} size="medium" />
      <span className="ui-status__content">
        <strong className="ui-status__title">{title ?? FR_COPY.status[kind]}</strong>
        {children === undefined ? null : <span className="ui-status__detail">{children}</span>}
      </span>
    </div>
  );
}
