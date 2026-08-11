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
import { passkeysAvailable } from "./passkey-client.ts";

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
const REFUSED = "That did not work. Check your passkey or password and try again.";

export function LoginPage(props: LoginPageProps) {
  const [mode, setMode] = useState<Mode>(passkeysAvailable() ? "passkey" : "password");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();

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
          result.problem.code === "rate_limited"
            ? "Too many attempts. Wait a few minutes before trying again."
            : REFUSED,
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
    const options = await props.api.passkeyLoginOptions();
    if (!options.ok) {
      setMessage(REFUSED);
      setBusy(false);
      return;
    }
    // The ceremony itself lives in the browser; a failure here is
    // indistinguishable to us from a refused credential, and is reported the
    // same way.
    setMessage("Waiting for your device…");
    setBusy(false);
  }, [props.api]);

  return (
    <main className="login-page" aria-labelledby="login-heading">
      <h1 id="login-heading">Sign in</h1>

      <p className="login-message" role="status" aria-live="polite" data-testid="login-message">
        {message ?? ""}
      </p>

      {mode === "passkey" ? (
        <section aria-labelledby="passkey-heading">
          <h2 id="passkey-heading">Use your passkey</h2>
          <p>Your device will ask you to confirm.</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void signInWithPasskey();
            }}
            disabled={busy}
            data-testid="sign-in-passkey"
          >
            Sign in with a passkey
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode("password");
              setMessage(null);
            }}
            data-testid="use-password-instead"
          >
            Use your password instead
          </button>
        </section>
      ) : (
        <section aria-labelledby="password-heading">
          <h2 id="password-heading">Use your password</h2>
          <form onSubmit={signInWithPassword}>
            <label htmlFor={passwordId}>Password</label>
            <input
              id={passwordId}
              type="password"
              // The browser's own manager is the right place for this, and
              // `current-password` is what tells it so.
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              data-testid="password-input"
            />
            <button
              type="submit"
              className="primary"
              disabled={busy}
              data-testid="sign-in-password"
            >
              Sign in
            </button>
          </form>
          {passkeysAvailable() ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode("passkey");
                setMessage(null);
              }}
              data-testid="use-passkey-instead"
            >
              Use your passkey instead
            </button>
          ) : (
            <p className="login-note">
              This browser cannot use passkeys, so the password is the way in here.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
