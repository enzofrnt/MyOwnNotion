/**
 * The one visual container for every account surface (feature 059).
 *
 * Setup, sign-in and sign-up are the first thing a person sees, and they were
 * rendering as bare text on the application canvas: nothing told the eye where
 * the form started or ended. Each surface now mounts inside this card — the
 * product wordmark, one `h1`, an optional lead, the content, and an optional
 * footer — so the boundary, spacing and states stay identical across them.
 */

import type { ReactNode } from "react";
import { classNames } from "../../ui/class-names.ts";
import { FR_COPY } from "../../ui/copy/index.ts";

export interface AuthShellProps {
  /** Id of the `h1`, referenced by the card's `aria-labelledby`. */
  readonly headingId: string;
  readonly title: ReactNode;
  readonly lead?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** Extra page class kept for routing tests and surface-specific layout. */
  readonly className?: string;
}

export function AuthShell(props: AuthShellProps) {
  return (
    <main className={classNames("ui-auth-shell", props.className)}>
      <section className="ui-auth-shell__card" aria-labelledby={props.headingId}>
        <p className="ui-auth-shell__wordmark">{FR_COPY.appName}</p>
        <h1 className="ui-auth-shell__title" id={props.headingId}>
          {props.title}
        </h1>
        {props.lead === undefined ? null : <p className="ui-auth-shell__lead">{props.lead}</p>}
        <div className="ui-auth-shell__body">{props.children}</div>
        {props.footer === undefined ? null : (
          <div className="ui-auth-shell__footer">{props.footer}</div>
        )}
      </section>
    </main>
  );
}
