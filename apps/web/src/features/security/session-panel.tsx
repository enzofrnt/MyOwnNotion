/**
 * The owner's session inventory (T047, feature 002).
 *
 * The list exists so an owner can answer one question: *is there a session
 * here I do not recognise?* Everything about the presentation follows from
 * that — newest activity first, the current session marked, and one control
 * that ends everything else in a single act.
 *
 * "Sign out everywhere else" spares the session doing the asking. An owner
 * reaching for it has usually just lost a device, and signing them out of the
 * browser they are using to secure the account would be an obstacle at exactly
 * the wrong moment.
 */

import type { SessionViewDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { FR_COPY, formatDateTime } from "../../ui/copy/index.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

export interface SessionPanelProps {
  readonly api: SecurityApi;
  readonly currentSessionId: string | null;
  /** Called when the panel ends the session this browser is using. */
  readonly onSignedOut: () => void;
}

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? FR_COPY.security.devices.unknown : formatDateTime(at);
}

function describeSessionState(state: SessionViewDto["state"]): string {
  return FR_COPY.security.sessions.states[state];
}

interface SessionNotice {
  readonly kind: "error" | "success";
  readonly message: string;
}

export function SessionPanel(props: SessionPanelProps) {
  const [sessions, setSessions] = useState<readonly SessionViewDto[]>([]);
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await props.api.listSessions();
    if (!result.ok) {
      setNotice({ kind: "error", message: FR_COPY.security.sessions.loadFailed });
      setLoading(false);
      return;
    }
    setSessions(result.value.sessions);
    setLoading(false);
  }, [props.api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setNotice(null);
      const result = await props.api.revokeSession(sessionId);
      if (!result.ok) {
        setNotice({ kind: "error", message: FR_COPY.security.sessions.revokeFailed });
        setBusy(false);
        return;
      }
      if (sessionId === props.currentSessionId) {
        props.onSignedOut();
        return;
      }
      await refresh();
      setBusy(false);
    },
    [props.api, props.currentSessionId, props.onSignedOut, refresh],
  );

  const revokeOthers = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const result = await props.api.revokeOtherSessions();
    if (!result.ok) {
      setNotice({
        kind: "error",
        message:
          result.problem.code === "recent_authentication_required"
            ? FR_COPY.security.sessions.revokeOthersAuthentication
            : FR_COPY.security.sessions.revokeOthersFailed,
      });
      setBusy(false);
      return;
    }
    await refresh();
    setNotice({ kind: "success", message: FR_COPY.security.sessions.revokeOthersDone });
    setBusy(false);
  }, [props.api, refresh]);

  const active = sessions.filter((session) => session.state === "active");

  return (
    <section className="session-panel ui-settings-panel" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">{FR_COPY.security.sessions.title}</h2>
      {notice === null ? null : (
        <AsyncState
          compact
          className="session-message"
          kind={notice.kind}
          title={notice.message}
          testId="session-message"
        />
      )}

      {loading ? (
        <AsyncState compact kind="loading" title={FR_COPY.security.sessions.loading} />
      ) : sessions.length === 0 ? (
        <AsyncState compact kind="empty" title={FR_COPY.security.sessions.empty} />
      ) : (
        <ul className="session-list" data-testid="session-list">
          {sessions.map((session) => {
            const isCurrent = session.sessionId === props.currentSessionId;
            return (
              <li key={session.sessionId} data-testid="session-row">
                <div>
                  <strong>
                    {session.authMethod === "passkey"
                      ? FR_COPY.security.sessions.passkey
                      : FR_COPY.security.sessions.password}
                  </strong>
                  {isCurrent ? (
                    <span data-testid="current-session">
                      {" "}
                      — {FR_COPY.security.sessions.current}
                    </span>
                  ) : null}
                </div>
                <div className="session-detail">
                  {FR_COPY.security.sessions.lastSeen} {when(session.lastSeenAt)} ·{" "}
                  {FR_COPY.security.sessions.started} {when(session.issuedAt)} ·{" "}
                  {describeSessionState(session.state)}
                </div>
                {session.state === "active" ? (
                  <Button
                    size="compact"
                    variant={isCurrent ? "danger" : "secondary"}
                    onClick={() => {
                      void revoke(session.sessionId);
                    }}
                    disabled={busy}
                    data-testid="revoke-session"
                  >
                    {isCurrent
                      ? FR_COPY.security.sessions.signOutHere
                      : FR_COPY.security.sessions.signOut}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Button
        variant="secondary"
        onClick={() => {
          void revokeOthers();
        }}
        // Nothing to do when this is the only session; a control that always
        // succeeds by doing nothing teaches the owner to distrust it.
        disabled={busy || active.length <= 1}
        data-testid="revoke-other-sessions"
      >
        {FR_COPY.security.sessions.signOutOthers}
      </Button>
    </section>
  );
}
