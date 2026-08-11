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

export interface SessionPanelProps {
  readonly api: SecurityApi;
  readonly currentSessionId: string | null;
  /** Called when the panel ends the session this browser is using. */
  readonly onSignedOut: () => void;
}

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "unknown" : at.toLocaleString();
}

export function SessionPanel(props: SessionPanelProps) {
  const [sessions, setSessions] = useState<readonly SessionViewDto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await props.api.listSessions();
    if (!result.ok) {
      setMessage("The session list could not be loaded.");
      return;
    }
    setSessions(result.value.sessions);
  }, [props.api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = useCallback(
    async (sessionId: string) => {
      setBusy(true);
      setMessage(null);
      const result = await props.api.revokeSession(sessionId);
      if (!result.ok) {
        setMessage("That session could not be signed out.");
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
    setMessage(null);
    const result = await props.api.revokeOtherSessions();
    if (!result.ok) {
      setMessage(
        result.problem.code === "recent_authentication_required"
          ? "Confirm your passkey or password again before signing out everywhere else."
          : "Those sessions could not be signed out.",
      );
      setBusy(false);
      return;
    }
    await refresh();
    setMessage("Every other session has been signed out.");
    setBusy(false);
  }, [props.api, refresh]);

  const active = sessions.filter((session) => session.state === "active");

  return (
    <section className="session-panel" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">Where you are signed in</h2>
      <p className="session-message" role="status" aria-live="polite" data-testid="session-message">
        {message ?? ""}
      </p>

      <ul className="session-list" data-testid="session-list">
        {sessions.map((session) => {
          const isCurrent = session.sessionId === props.currentSessionId;
          return (
            <li key={session.sessionId} data-testid="session-row">
              <div>
                <strong>{session.authMethod === "passkey" ? "Passkey" : "Password"}</strong>
                {isCurrent ? <span data-testid="current-session"> — this browser</span> : null}
              </div>
              <div className="session-detail">
                Last seen {when(session.lastSeenAt)} · started {when(session.issuedAt)} ·{" "}
                {session.state}
              </div>
              {session.state === "active" ? (
                <button
                  type="button"
                  onClick={() => {
                    void revoke(session.sessionId);
                  }}
                  disabled={busy}
                  data-testid="revoke-session"
                >
                  {isCurrent ? "Sign out here" : "Sign out"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="secondary"
        onClick={() => {
          void revokeOthers();
        }}
        // Nothing to do when this is the only session; a control that always
        // succeeds by doing nothing teaches the owner to distrust it.
        disabled={busy || active.length <= 1}
        data-testid="revoke-other-sessions"
      >
        Sign out everywhere else
      </button>
    </section>
  );
}
