/**
 * Self-service sign-up (feature 058, US5): open registration, or an
 * invitation link.
 *
 * An invitation's secret arrives in the URL fragment (`/join#<secret>`), which
 * browsers never send to a server. It is read once, kept in memory, removed
 * from the address bar, and posted in the request body.
 */

import { useCallback, useId, useRef, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { Button, Field, FormMessage, FR_COPY } from "../../ui/index.ts";
import { AuthShell } from "./auth-shell.tsx";
import { passkeysAvailable } from "./passkey-client.ts";
import { enrollAccountPasskey } from "./passkey-enrollment.ts";
import { PasswordField } from "./password-field.tsx";
import { PASSWORD_MINIMUM_LENGTH } from "./password-strength.ts";

const COPY = FR_COPY.accounts.signup;
const FORM = FR_COPY.accounts.bootstrap;
const OFFER = FR_COPY.accounts.passkeyOffer;

export interface SignupPageProps {
  readonly api: SecurityApi;
  /** `invitation` reads the secret from the fragment; `open` needs none. */
  readonly mode: "open" | "invitation";
  readonly onSignedIn: () => void;
  readonly onBackToLogin: () => void;
}

/** Takes the secret out of the fragment exactly once. */
function takeInvitationSecret(): string | null {
  const fragment = window.location.hash.replace(/^#/, "");
  if (fragment.length === 0) return null;
  // Out of the address bar, history and any screenshot of it.
  window.history.replaceState(null, "", window.location.pathname);
  return /^[A-Za-z0-9_-]{32,128}$/.test(fragment) ? fragment : null;
}

export function SignupPage(props: SignupPageProps) {
  const secret = useRef<string | null | undefined>(undefined);
  if (secret.current === undefined) {
    secret.current = props.mode === "invitation" ? takeInvitationSecret() : null;
  }
  const invitationMissing = props.mode === "invitation" && secret.current === null;

  const [email, setEmail] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(
    invitationMissing ? COPY.invitationMissing : null,
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"form" | "passkey">("form");
  const emailId = useId();
  const pseudonymId = useId();
  const passwordId = useId();
  const passwordConfirmId = useId();
  const passwordConfirmRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);
      if (password !== passwordConfirm) {
        setBusy(false);
        passwordConfirmRef.current?.focus();
        return;
      }
      const result = await props.api.signup({
        email,
        pseudonym,
        password,
        ...(secret.current === null || secret.current === undefined
          ? {}
          : { invitation: secret.current }),
      });
      setBusy(false);
      if (!result.ok) {
        const code = result.problem.code;
        setMessage(
          code === "registration_closed"
            ? COPY.closed
            : code === "invitation_unavailable"
              ? COPY.invitationUnavailable
              : code === "email_unavailable"
                ? COPY.emailUnavailable
                : code === "validation_failed" || code === "validation.invalid-payload"
                  ? FORM.invalidPassword
                  : COPY.failed,
        );
        return;
      }
      setPassword("");
      setPasswordConfirm("");
      if (passkeysAvailable()) setStage("passkey");
      else props.onSignedIn();
    },
    [email, pseudonym, password, passwordConfirm, props.api, props.onSignedIn],
  );

  const addPasskey = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const outcome = await enrollAccountPasskey(props.api, { label: OFFER.label });
    setBusy(false);
    if (!outcome.ok) {
      setMessage(OFFER.failed);
      return;
    }
    props.onSignedIn();
  }, [props.api, props.onSignedIn]);

  const passwordsMatch = password.length > 0 && password === passwordConfirm;
  const formValid =
    email.includes("@") &&
    pseudonym.trim().length > 0 &&
    password.length >= PASSWORD_MINIMUM_LENGTH &&
    passwordsMatch;
  const title =
    stage === "passkey" ? OFFER.title : props.mode === "invitation" ? COPY.joinTitle : COPY.title;

  return (
    <AuthShell
      className="signup-page ui-auth-surface"
      headingId="signup-heading"
      title={title}
      lead={stage === "form" ? COPY.description : OFFER.description}
    >
      {stage === "form" ? (
        <section className="ui-auth-step">
          <form onSubmit={submit} className="ui-auth-form" data-testid="signup-form">
            <Field
              id={emailId}
              label={FORM.emailLabel}
              type="email"
              autoComplete="username"
              required
              invalid={message === COPY.emailUnavailable}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy || invitationMissing}
              data-testid="signup-email"
            />
            <Field
              id={pseudonymId}
              label={FORM.pseudonymLabel}
              description={FORM.pseudonymHint}
              autoComplete="nickname"
              required
              maxLength={64}
              value={pseudonym}
              onChange={(event) => setPseudonym(event.target.value)}
              disabled={busy || invitationMissing}
              data-testid="signup-pseudonym"
            />
            <PasswordField
              id={passwordId}
              label={FORM.passwordLabel}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MINIMUM_LENGTH}
              showStrength
              value={password}
              onChange={setPassword}
              disabled={busy || invitationMissing}
              testId="signup-password"
            />
            <PasswordField
              id={passwordConfirmId}
              label={FORM.passwordConfirmLabel}
              autoComplete="new-password"
              required
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              disabled={busy || invitationMissing}
              testId="signup-password-confirm"
              inputRef={passwordConfirmRef}
              error={
                passwordConfirm.length > 0 && password !== passwordConfirm
                  ? FORM.passwordMismatch
                  : undefined
              }
            />
            <FormMessage testId="signup-message">{message}</FormMessage>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!formValid || invitationMissing}
              data-testid="signup-submit"
            >
              {COPY.action}
            </Button>
          </form>
          <div className="ui-auth-alternatives">
            <Button
              type="button"
              variant="ghost"
              onClick={props.onBackToLogin}
              data-testid="signup-back-to-login"
            >
              {COPY.backToLogin}
            </Button>
          </div>
        </section>
      ) : (
        <section className="ui-auth-step">
          <FormMessage testId="signup-message">{message}</FormMessage>
          <div className="ui-actions">
            <Button
              type="button"
              variant="primary"
              busy={busy}
              onClick={() => {
                void addPasskey();
              }}
              data-testid="signup-add-passkey"
            >
              {OFFER.action}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={props.onSignedIn}
              data-testid="signup-skip-passkey"
            >
              {OFFER.later}
            </Button>
          </div>
        </section>
      )}
    </AuthShell>
  );
}
