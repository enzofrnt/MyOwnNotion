/**
 * First launch: create the administrator account (feature 058, US1).
 *
 * One form — email, pseudonym, password — creates the administrator and signs
 * them in. A passkey is then offered, and can be skipped: the account already
 * works with its password, and passkeys can be added later in settings.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SecurityApi } from "../../services/security-api.ts";
import { AsyncState, Button, Field, FormMessage, FR_COPY } from "../../ui/index.ts";
import { AuthShell } from "./auth-shell.tsx";
import { passkeysAvailable } from "./passkey-client.ts";
import { enrollAccountPasskey } from "./passkey-enrollment.ts";
import { PasswordField } from "./password-field.tsx";
import { PASSWORD_MINIMUM_LENGTH } from "./password-strength.ts";

type Stage = "loading" | "form" | "passkey" | "unavailable";

const COPY = FR_COPY.accounts.bootstrap;
const OFFER = FR_COPY.accounts.passkeyOffer;

export interface BootstrapPageProps {
  /** Injected in tests; defaults to the same-origin client. */
  readonly api?: SecurityApi;
  /** Called once the administrator exists and is signed in. */
  readonly onReady?: () => void;
}

export function BootstrapPage(props: BootstrapPageProps) {
  const apiRef = useRef<SecurityApi>(props.api ?? new SecurityApi());
  const api = apiRef.current;
  const { onReady } = props;

  const [stage, setStage] = useState<Stage>("loading");
  const [email, setEmail] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailId = useId();
  const pseudonymId = useId();
  const passwordId = useId();
  const passwordConfirmId = useId();
  const passwordConfirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const status = await api.status();
      if (!status.ok) {
        setStage("unavailable");
        return;
      }
      if (status.value.ownerCount === 1) {
        onReady?.();
        return;
      }
      setStage("form");
    })();
  }, [api, onReady]);

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
      const result = await api.bootstrap({ email, pseudonym, password });
      if (!result.ok) {
        setBusy(false);
        setMessage(
          result.problem.code === "already_initialized"
            ? COPY.alreadyInitialized
            : result.problem.code === "installation_degraded"
              ? COPY.degraded
              : result.problem.code === "validation_failed" ||
                  result.problem.code === "validation.invalid-payload"
                ? COPY.invalidPassword
                : COPY.failed,
        );
        if (result.problem.code === "already_initialized") onReady?.();
        return;
      }
      // The password leaves the page as soon as it has done its job.
      setPassword("");
      setPasswordConfirm("");
      setBusy(false);
      if (passkeysAvailable()) setStage("passkey");
      else onReady?.();
    },
    [api, email, pseudonym, password, passwordConfirm, onReady],
  );

  const addPasskey = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const outcome = await enrollAccountPasskey(api, { label: OFFER.label });
    setBusy(false);
    if (!outcome.ok) {
      setMessage(OFFER.failed);
      return;
    }
    onReady?.();
  }, [api, onReady]);

  const passwordsMatch = password.length > 0 && password === passwordConfirm;
  const formValid =
    email.includes("@") &&
    pseudonym.trim().length > 0 &&
    password.length >= PASSWORD_MINIMUM_LENGTH &&
    passwordsMatch;

  return (
    <AuthShell
      className="bootstrap-page ui-auth-surface"
      headingId="bootstrap-heading"
      title={stage === "passkey" ? OFFER.title : COPY.title}
      lead={
        stage === "form" ? COPY.description : stage === "passkey" ? OFFER.description : undefined
      }
    >
      {stage === "loading" ? (
        <AsyncState kind="loading" title={COPY.checking} testId="bootstrap-loading" />
      ) : null}

      {stage === "unavailable" ? (
        <AsyncState
          kind="error"
          title={COPY.unavailableTitle}
          description={COPY.unavailable}
          testId="bootstrap-unavailable"
        />
      ) : null}

      {stage === "form" ? (
        <section className="ui-auth-step">
          <form onSubmit={submit} className="ui-auth-form" data-testid="bootstrap-form">
            <Field
              id={emailId}
              label={COPY.emailLabel}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              data-testid="bootstrap-email"
            />
            <Field
              id={pseudonymId}
              label={COPY.pseudonymLabel}
              description={COPY.pseudonymHint}
              autoComplete="nickname"
              required
              maxLength={64}
              value={pseudonym}
              onChange={(event) => setPseudonym(event.target.value)}
              disabled={busy}
              data-testid="bootstrap-pseudonym"
            />
            <PasswordField
              id={passwordId}
              label={COPY.passwordLabel}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MINIMUM_LENGTH}
              showStrength
              value={password}
              onChange={setPassword}
              disabled={busy}
              testId="bootstrap-password"
              inputRef={passwordRef}
            />
            <PasswordField
              id={passwordConfirmId}
              label={COPY.passwordConfirmLabel}
              autoComplete="new-password"
              required
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              disabled={busy}
              testId="bootstrap-password-confirm"
              inputRef={passwordConfirmRef}
              error={
                passwordConfirm.length > 0 && password !== passwordConfirm
                  ? COPY.passwordMismatch
                  : undefined
              }
            />
            <FormMessage testId="bootstrap-message">{message}</FormMessage>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!formValid}
              data-testid="bootstrap-submit"
            >
              {COPY.action}
            </Button>
          </form>
        </section>
      ) : null}

      {stage === "passkey" ? (
        <section className="ui-auth-step">
          <FormMessage testId="bootstrap-message">{message}</FormMessage>
          <div className="ui-actions">
            <Button
              type="button"
              variant="primary"
              busy={busy}
              onClick={() => {
                void addPasskey();
              }}
              data-testid="bootstrap-add-passkey"
            >
              {OFFER.action}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onReady?.()}
              data-testid="bootstrap-skip-passkey"
            >
              {OFFER.later}
            </Button>
          </div>
        </section>
      ) : null}
    </AuthShell>
  );
}
