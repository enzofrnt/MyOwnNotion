/**
 * Identity confirmation for sensitive settings actions (feature 061).
 *
 * One modal, styled like sign-in, for every action the server refuses with
 * `recent_authentication_required` (MCP tokens, passkeys…). The caller resumes
 * its action from `onConfirmed`: the person never has to click twice, and an
 * error is shown in a reserved line so nothing moves (L-066, L-068).
 */
import { useEffect, useId, useRef, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { FR_COPY } from "../../ui/copy/index.ts";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  FormMessage,
} from "../../ui/primitives/index.ts";
import { passkeysAvailable, requestOwnerPasskey } from "../auth/passkey-client.ts";
import { PasswordField } from "../auth/password-field.tsx";

export interface ReauthDialogProps {
  readonly api: SecurityApi;
  readonly open: boolean;
  readonly description: string;
  readonly onCancel: () => void;
  readonly onConfirmed: () => void;
  readonly testId?: string;
}

export function ReauthDialog({
  api,
  open,
  description,
  onCancel,
  onConfirmed,
  testId = "reauth-dialog",
}: ReauthDialogProps) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const mounted = useRef(true);
  const passwordId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setHasPasskey(null);
    setMessage(null);
    void api.listPasskeys().then(
      (result) => {
        if (current && result.ok)
          setHasPasskey(result.value.passkeys.some((entry) => entry.state === "active"));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [open, api]);

  // Offer a passkey only when this account has one (unknown: keep offering it).
  const offerPasskey = passkeysAvailable() && hasPasskey !== false;

  const confirm = async (method: "password" | "passkey") => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let success = false;
    // The person is already signed in, so the reason can be specific (unlike
    // the sign-in screen, which must not reveal which factor was wrong).
    let failure = "Mot de passe incorrect. Vérifiez-le et réessayez.";
    if (method === "password") {
      const result = await api.reauthenticateWithPassword(password);
      success = result.ok;
      if (!result.ok) {
        failure =
          result.problem.code === "rate_limited"
            ? FR_COPY.auth.login.rateLimited
            : result.problem.code === "service_unavailable"
              ? "Le serveur est inaccessible. Vérifiez la connexion puis réessayez."
              : failure;
      }
    } else {
      failure = "La passkey n’a pas pu être confirmée. Réessayez ou utilisez votre mot de passe.";
      const options = await api.passkeyLoginOptions();
      if (options.ok) {
        const assertion = await requestOwnerPasskey(options.value);
        if (assertion.ok) success = (await api.loginWithPasskey(assertion.credential)).ok;
      }
    }
    if (!mounted.current) return;
    setPassword("");
    setBusy(false);
    if (success) onConfirmed();
    else setMessage(failure);
  };

  return (
    <DialogRoot
      open={open}
      setOpen={(next) => {
        if (!next && !busy) {
          setPassword("");
          setMessage(null);
          onCancel();
        }
      }}
    >
      <DialogContent
        className="reauth-dialog"
        data-testid={testId}
        hideOnEscape={!busy}
        portal={false}
        size="small"
        unmountOnHide
      >
        <DialogHeading>Confirmer votre identité</DialogHeading>
        <DialogDescription>{description}</DialogDescription>
        <div className="reauth-dialog__body">
          {offerPasskey && (
            <>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void confirm("passkey")}
                data-testid={`${testId}-passkey`}
              >
                Confirmer avec une passkey
              </Button>
              <p className="ui-auth-separator">{FR_COPY.auth.or}</p>
            </>
          )}
          <form
            className="ui-auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm("password");
            }}
          >
            <PasswordField
              id={passwordId}
              label="Mot de passe actuel"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              disabled={busy}
              invalid={message !== null}
              testId={`${testId}-password`}
            />
            <FormMessage testId={`${testId}-message`}>{message}</FormMessage>
            <Button
              type="submit"
              variant={offerPasskey ? "secondary" : "primary"}
              busy={busy}
              data-testid={`${testId}-submit`}
            >
              Confirmer avec le mot de passe
            </Button>
          </form>
        </div>
        <DialogDismiss disabled={busy} />
      </DialogContent>
    </DialogRoot>
  );
}
