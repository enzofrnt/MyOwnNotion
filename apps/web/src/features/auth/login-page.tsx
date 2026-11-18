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

import { useCallback, useEffect, useId, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { Button, Field, FormMessage, FR_COPY } from "../../ui/index.ts";
import { AuthShell } from "./auth-shell.tsx";
import { DesktopPasskeyGuidance, useDesktopPlatformPasskey } from "./desktop-passkey-guidance.tsx";
import {
  passkeysAvailable,
  platformAuthenticatorAvailable,
  requestOwnerPasskey,
} from "./passkey-client.ts";
import { PasswordField } from "./password-field.tsx";

export interface LoginPageProps {
  readonly api: SecurityApi;
  readonly onSignedIn: () => void;
  /** Shown only when the installation lets anyone create an account. */
  readonly onCreateAccount?: () => void;
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [openRegistration, setOpenRegistration] = useState(false);
  const emailId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const desktopPlatformPasskey = useDesktopPlatformPasskey();

  useEffect(() => {
    let cancelled = false;
    void props.api.status().then((status) => {
      if (!cancelled && status.ok) setOpenRegistration(status.value.registrationMode === "open");
    });
    return () => {
      cancelled = true;
    };
  }, [props.api]);

  const signInWithPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);
      const result = await props.api.loginWithPassword(email, password);
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
    [email, password, props.api, props.onSignedIn],
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

  const failed = message !== null && message !== FR_COPY.auth.login.waiting;

  return (
    <AuthShell
      className="login-page ui-auth-surface"
      headingId="login-heading"
      title={FR_COPY.auth.login.title}
      lead={FR_COPY.auth.login.lead}
      footer={
        openRegistration && props.onCreateAccount !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            onClick={props.onCreateAccount}
            data-testid="create-account"
          >
            {FR_COPY.accounts.login.createAccount}
          </Button>
        ) : undefined
      }
    >
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
          <section className="ui-auth-step" aria-labelledby="passkey-heading">
            <h2 id="passkey-heading">{FR_COPY.auth.login.passkeyTitle}</h2>
            <p>{FR_COPY.auth.login.passkeyDescription}</p>
            <FormMessage kind={failed ? "error" : "info"} testId="login-message">
              {message}
            </FormMessage>
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
        <section className="ui-auth-step" aria-labelledby="password-heading">
          <h2 id="password-heading">{FR_COPY.auth.login.passwordTitle}</h2>
          <form onSubmit={signInWithPassword} className="ui-auth-form">
            <Field
              id={emailId}
              label={FR_COPY.accounts.login.emailLabel}
              type="email"
              autoComplete="username"
              required
              invalid={failed}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              data-testid="email-input"
            />
            <PasswordField
              id={passwordId}
              label={FR_COPY.auth.login.passwordLabel}
              // The browser's own manager is the right place for this, and
              // `current-password` is what tells it so.
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              disabled={busy}
              invalid={failed}
              testId="password-input"
            />
            <FormMessage kind="error" testId="login-message">
              {failed ? message : null}
            </FormMessage>
            <Button type="submit" variant="primary" busy={busy} data-testid="sign-in-password">
              {FR_COPY.auth.login.passwordAction}
            </Button>
          </form>
          {passkeysAvailable() && desktopPlatformPasskey !== false ? (
            <>
              <p className="ui-auth-separator">{FR_COPY.auth.or}</p>
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
            </>
          ) : (
            <p className="login-note">{FR_COPY.auth.login.passwordOnly}</p>
          )}
        </section>
      )}
    </AuthShell>
  );
}
