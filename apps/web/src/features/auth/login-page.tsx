/**
 * Owner sign-in (T047, feature 002).
 *
 * Passkey first, password second, and the ordering is the point: the passkey
 * is the primary credential and the password is the alternative for the
 * situations where a passkey is not usable — a borrowed machine, a lost
 * authenticator, a browser without platform support. Presenting them as equals
 * would nudge owners towards the weaker one.
 *
 * The page never says which half of a failed attempt was wrong, because the
 * server does not tell it. There is one message for every refusal, and it says
 * what to do next rather than what went wrong.
 */

import { useCallback, useId, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { AsyncState, Button, Field, FR_COPY } from "../../ui/index.ts";
import { DesktopPasskeyGuidance, useDesktopPlatformPasskey } from "./desktop-passkey-guidance.tsx";
import {
  passkeysAvailable,
  platformAuthenticatorAvailable,
  requestOwnerPasskey,
} from "./passkey-client.ts";

export interface LoginPageProps {
  readonly api: SecurityApi;
  readonly onSignedIn: () => void;
}

type Mode = "passkey" | "password";

/**
 * The one message every refusal produces.
 *
 * Written as guidance rather than diagnosis. "No account with that password"
 * would confirm whether an installation is set up; this says nothing an
 * attacker did not already know, and still tells the owner what to try.
 */
const REFUSED = FR_COPY.auth.login.refused;

export function LoginPage(props: LoginPageProps) {
  const [mode, setMode] = useState<Mode>(passkeysAvailable() ? "passkey" : "password");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const desktopPlatformPasskey = useDesktopPlatformPasskey();

  const signInWithPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);
      const result = await props.api.loginWithPassword(password);
      // Cleared whatever happened: a failed attempt must not leave the
      // password sitting in a form field for the next person at the machine.
      setPassword("");
      if (!result.ok) {
        setMessage(
          result.problem.code === "rate_limited" ? FR_COPY.auth.login.rateLimited : REFUSED,
        );
        setBusy(false);
        return;
      }
      setBusy(false);
      props.onSignedIn();
    },
    [password, props.api, props.onSignedIn],
  );

  const signInWithPasskey = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    if (window.myownnotionDesktop?.platform === "darwin") {
      const platformReady = await platformAuthenticatorAvailable();
      if (!platformReady) {
        setMessage(FR_COPY.auth.passkey.desktopUnavailable);
        setBusy(false);
        return;
      }
    }
    const options = await props.api.passkeyLoginOptions();
    if (!options.ok) {
      setMessage(REFUSED);
      setBusy(false);
      return;
    }
    // The ceremony itself lives in the browser; a failure here is
    // indistinguishable to us from a refused credential, and is reported the
    // same way.
    setMessage(FR_COPY.auth.login.waiting);
    const assertion = await requestOwnerPasskey(options.value);
    if (!assertion.ok) {
      setMessage(REFUSED);
      setBusy(false);
      return;
    }
    const result = await props.api.loginWithPasskey(assertion.credential);
    if (!result.ok) {
      setMessage(result.problem.code === "rate_limited" ? FR_COPY.auth.login.rateLimited : REFUSED);
      setBusy(false);
      return;
    }
    setBusy(false);
    props.onSignedIn();
  }, [props.api, props.onSignedIn]);

  return (
    <main className="login-page ui-auth-surface" aria-labelledby="login-heading">
      <h1 id="login-heading">{FR_COPY.auth.login.title}</h1>

      {message === null ? null : (
        <AsyncState
          compact
          kind={busy ? "loading" : "error"}
          title={message}
          testId="login-message"
        />
      )}

      {mode === "passkey" ? (
        desktopPlatformPasskey === false ? (
          <section>
            <DesktopPasskeyGuidance testId="login-desktop-passkey-guidance" />
            <Button
              type="button"
              variant="ghost"
              data-testid="use-password-instead"
              onClick={() => {
                setMode("password");
                setMessage(null);
              }}
            >
              {FR_COPY.auth.login.usePassword}
            </Button>
          </section>
        ) : (
          <section className="ui-auth-card" aria-labelledby="passkey-heading">
            <h2 id="passkey-heading">{FR_COPY.auth.login.passkeyTitle}</h2>
            <p>{FR_COPY.auth.login.passkeyDescription}</p>
            <Button
              type="button"
              variant="primary"
              busy={busy || desktopPlatformPasskey === null}
              onClick={() => {
                void signInWithPasskey();
              }}
              data-testid="sign-in-passkey"
            >
              {FR_COPY.auth.login.passkeyAction}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode("password");
                setMessage(null);
              }}
              data-testid="use-password-instead"
            >
              {FR_COPY.auth.login.usePassword}
            </Button>
          </section>
        )
      ) : (
        <section className="ui-auth-card" aria-labelledby="password-heading">
          <h2 id="password-heading">{FR_COPY.auth.login.passwordTitle}</h2>
          <form onSubmit={signInWithPassword}>
            <Field
              id={passwordId}
              label={FR_COPY.auth.login.passwordLabel}
              type="password"
              // The browser's own manager is the right place for this, and
              // `current-password` is what tells it so.
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              data-testid="password-input"
            />
            <Button type="submit" variant="primary" busy={busy} data-testid="sign-in-password">
              {FR_COPY.auth.login.passwordAction}
            </Button>
          </form>
          {passkeysAvailable() && desktopPlatformPasskey !== false ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode("passkey");
                setMessage(null);
              }}
              data-testid="use-passkey-instead"
            >
              {FR_COPY.auth.login.usePasskey}
            </Button>
          ) : (
            <p className="login-note">{FR_COPY.auth.login.passwordOnly}</p>
          )}
        </section>
      )}
    </main>
  );
}
