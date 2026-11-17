/**
 * Settings › Compte (feature 058, US2): the signed-in account's identity.
 *
 * Pseudonym and email are edited in one form. Changing the email — the
 * sign-in identifier — needs a recent sign-in; the server says so, and the
 * page explains what to do rather than failing silently.
 */

import type { MeDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useId, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { Button, Field, FormMessage, FR_COPY } from "../../ui/index.ts";
import { SettingsCard, SettingsPill, SettingsRow } from "./settings-card.tsx";

const COPY = FR_COPY.accounts.account;

export interface AccountSettingsProps {
  readonly api: SecurityApi;
  readonly account: MeDto | null;
  readonly onAccountChange: (account: MeDto) => void;
  readonly onSignedOut: () => void;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly message: string;
}

export function AccountSettings(props: AccountSettingsProps) {
  const { account } = props;
  const [pseudonym, setPseudonym] = useState(account?.pseudonym ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const pseudonymId = useId();
  const emailId = useId();

  useEffect(() => {
    setPseudonym(account?.pseudonym ?? "");
    setEmail(account?.email ?? "");
  }, [account]);

  const dirty =
    account !== null && (pseudonym.trim() !== account.pseudonym || email.trim() !== account.email);

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (account === null) return;
      setBusy(true);
      setNotice(null);
      const changes: { pseudonym?: string; email?: string } = {};
      if (pseudonym.trim() !== account.pseudonym) changes.pseudonym = pseudonym.trim();
      if (email.trim() !== account.email) changes.email = email.trim();
      const result = await props.api.updateMe(changes);
      setBusy(false);
      if (!result.ok) {
        setNotice({
          kind: "error",
          message:
            result.problem.code === "email_unavailable"
              ? COPY.emailUnavailable
              : result.problem.code === "recent_authentication_required"
                ? COPY.reauthenticate
                : COPY.failed,
        });
        return;
      }
      props.onAccountChange(result.value);
      setNotice({ kind: "success", message: COPY.saved });
    },
    [account, email, pseudonym, props.api, props.onAccountChange],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    await props.api.signOut();
    setBusy(false);
    props.onSignedOut();
  }, [props.api, props.onSignedOut]);

  return (
    <div className="account-card" data-testid="account-settings">
      <SettingsCard
        icon="user"
        title={COPY.profileTitle}
        titleId="account-heading"
        help={COPY.profileLead}
        aside={
          account === null ? null : (
            <SettingsPill tone="neutral">
              <span data-testid="account-role">{COPY.role[account.role]}</span>
            </SettingsPill>
          )
        }
      >
        <form onSubmit={save} className="account-card__form" id="account-form">
          <div className="account-card__fields">
            <Field
              id={pseudonymId}
              label={COPY.pseudonymLabel}
              autoComplete="nickname"
              required
              maxLength={64}
              value={pseudonym}
              onChange={(event) => setPseudonym(event.target.value)}
              disabled={busy || account === null}
              data-testid="account-pseudonym"
            />
            <Field
              id={emailId}
              label={COPY.emailLabel}
              type="email"
              autoComplete="username"
              required
              invalid={notice?.kind === "error"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy || account === null}
              data-testid="account-email"
            />
          </div>
        </form>
        <FormMessage kind={notice?.kind === "success" ? "info" : "error"} testId="account-message">
          {notice?.message ?? null}
        </FormMessage>
        <div className="account-card__actions">
          <Button
            type="submit"
            form="account-form"
            variant="primary"
            busy={busy}
            disabled={!dirty || pseudonym.trim().length === 0}
            data-testid="account-save"
          >
            {COPY.save}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        icon="lock"
        title={COPY.sessionTitle}
        titleId="account-session-heading"
        help={COPY.sessionLead}
      >
        <SettingsRow label={COPY.signOutLabel} help={COPY.signOutHelp}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void signOut();
            }}
            data-testid="account-sign-out"
          >
            {COPY.signOut}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
