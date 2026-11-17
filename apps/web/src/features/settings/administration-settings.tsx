/**
 * Settings › Administration (feature 058, US5 + US6). Administrator only; the
 * server refuses every call from a member with a plain 404.
 *
 * Three panels, in the order an administrator reaches for them: who has an
 * account, who may create one, and the private links that let people in.
 * Destructive and secret-revealing steps happen in dialogs: deleting asks for
 * the account's email, and a new link is shown once, with a copy action.
 */

import type {
  AdminAccountViewDto,
  InvitationViewDto,
  RegistrationModeDto,
} from "@myownnotion/contracts";
import { useCallback, useEffect, useId, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";
import { AsyncState, Button, ConfirmDialog, Field, FR_COPY } from "../../ui/index.ts";
import { PasswordField } from "../auth/password-field.tsx";
import { assessPassword, PASSWORD_MINIMUM_LENGTH } from "../auth/password-strength.ts";

const COPY = FR_COPY.accounts.administration;
const FORM = FR_COPY.accounts.bootstrap;
const MODES: readonly RegistrationModeDto[] = ["closed", "invitation", "open"];

export interface AdministrationSettingsProps {
  readonly api: SecurityApi;
  readonly currentAccountId: string | null;
}

interface Notice {
  readonly kind: "error" | "success" | "info";
  readonly message: string;
}

type Dialog =
  | { readonly kind: "create" }
  | { readonly kind: "reset"; readonly account: AdminAccountViewDto }
  | { readonly kind: "delete"; readonly account: AdminAccountViewDto }
  | { readonly kind: "invite" }
  | { readonly kind: "link"; readonly url: string };

function NoticeLine(props: { readonly notice: Notice | null; readonly testId: string }) {
  if (props.notice === null) return null;
  return (
    <p
      className="security-settings__note"
      data-kind={props.notice.kind}
      role={props.notice.kind === "error" ? "alert" : "status"}
      data-testid={props.testId}
    >
      {props.notice.message}
    </p>
  );
}

export function AdministrationSettings(props: AdministrationSettingsProps) {
  const { api } = props;
  const [accounts, setAccounts] = useState<readonly AdminAccountViewDto[] | null>(null);
  const [invitations, setInvitations] = useState<readonly InvitationViewDto[] | null>(null);
  const [mode, setMode] = useState<RegistrationModeDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Dialog fields: reset whenever a dialog opens.
  const [email, setEmail] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const ids = {
    email: useId(),
    pseudonym: useId(),
    // One id set per dialog: both dialogs stay mounted while hidden, and two
    // fields sharing an id would also share their error's `aria-describedby`.
    createPassword: useId(),
    createPasswordConfirm: useId(),
    resetPassword: useId(),
    resetPasswordConfirm: useId(),
    confirm: useId(),
    label: useId(),
    uses: useId(),
    expires: useId(),
  };

  const newPasswordValid = assessPassword(password).meetsMinimum && password === passwordConfirm;

  const refresh = useCallback(async () => {
    const [listed, registration, links] = await Promise.all([
      api.listAccounts(),
      api.registrationSettings(),
      api.listInvitations(),
    ]);
    if (!listed.ok || !registration.ok || !links.ok) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setAccounts(listed.value.accounts);
    setMode(registration.value.mode);
    setInvitations(links.value.invitations);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = (next: Dialog) => {
    setEmail("");
    setPseudonym("");
    setPassword("");
    setPasswordConfirm("");
    setConfirmEmail("");
    setLabel("");
    setMaxUses("");
    setExpiresInDays("");
    setDialog(next);
  };

  /** Runs one administrative call; a refusal keeps the dialog open to retry. */
  const run = async (work: () => Promise<{ ok: boolean }>, success: string) => {
    setBusy(true);
    setNotice(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setNotice({ kind: "error", message: COPY.actionFailed });
      return false;
    }
    setNotice({ kind: "success", message: success });
    await refresh();
    return true;
  };

  const changeMode = async (next: RegistrationModeDto) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    const ok = await run(() => api.setRegistrationMode(next), COPY.modeSaved);
    if (!ok) setMode(previous);
  };

  if (loadFailed) {
    return (
      <AsyncState
        kind="error"
        title={COPY.loadFailed}
        testId="administration-load-failed"
        action={
          <Button size="compact" onClick={() => void refresh()}>
            {FR_COPY.actions.retry}
          </Button>
        }
      />
    );
  }

  if (accounts === null || invitations === null || mode === null) {
    return <AsyncState kind="loading" title={COPY.loading} testId="administration-loading" />;
  }

  return (
    <section
      className="security-settings"
      aria-label="Administration"
      data-testid="administration-settings"
    >
      <nav className="security-settings__toc" aria-label="Sommaire de l’administration">
        <a href="#users-heading">{COPY.usersTitle}</a>
        <a href="#registration-heading">{COPY.registrationTitle}</a>
        <a href="#invitations-heading">{COPY.invitationsTitle}</a>
      </nav>

      <NoticeLine notice={notice} testId="administration-message" />

      <div className="security-group">
        <section className="ui-settings-panel" aria-labelledby="users-heading">
          <header className="security-settings__panel-head">
            <div>
              <h2 id="users-heading">{COPY.usersTitle}</h2>
              <p className="security-settings__lead">{COPY.usersLead}</p>
            </div>
            <Button
              size="compact"
              variant="secondary"
              onClick={() => open({ kind: "create" })}
              data-testid="create-account"
            >
              {COPY.create}
            </Button>
          </header>
          <ul className="security-settings__rows" data-testid="account-list">
            {accounts.map((account) => {
              const self = account.accountId === props.currentAccountId;
              const administrator = account.role === "administrator";
              return (
                <li key={account.accountId} data-testid="account-row" data-state={account.state}>
                  <div className="security-settings__row-main">
                    <span className="security-settings__row-label">
                      {account.pseudonym}
                      {self ? ` (${COPY.you})` : ""}
                    </span>
                    <span className="security-settings__row-meta">
                      {account.email} · {FR_COPY.accounts.account.role[account.role]} ·{" "}
                      {COPY.origin[account.origin]} · {COPY.state[account.state]}
                    </span>
                  </div>
                  {administrator ? null : (
                    <div className="security-settings__row-actions">
                      <Button
                        size="compact"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api.setAccountDisabled(
                                account.accountId,
                                account.state !== "disabled",
                              ),
                            account.state === "disabled" ? COPY.enable : COPY.disable,
                          )
                        }
                        data-testid={
                          account.state === "disabled" ? "enable-account" : "disable-account"
                        }
                      >
                        {account.state === "disabled" ? COPY.enable : COPY.disable}
                      </Button>
                      <Button
                        size="compact"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => open({ kind: "reset", account })}
                        data-testid="reset-account-password"
                      >
                        {COPY.resetPassword}
                      </Button>
                      <Button
                        size="compact"
                        variant="danger"
                        disabled={busy}
                        onClick={() => open({ kind: "delete", account })}
                        data-testid="delete-account"
                      >
                        {COPY.delete}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="security-group">
        <section className="ui-settings-panel" aria-labelledby="registration-heading">
          <header className="security-settings__panel-head">
            <div>
              <h2 id="registration-heading">{COPY.registrationTitle}</h2>
              <p className="security-settings__lead">{COPY.registrationLead}</p>
            </div>
          </header>
          <fieldset
            className="administration__modes"
            aria-labelledby="registration-heading"
            data-testid="registration-modes"
          >
            {MODES.map((candidate) => (
              <label
                key={candidate}
                className="administration__mode"
                data-selected={candidate === mode}
              >
                <input
                  type="radio"
                  name="registration-mode"
                  value={candidate}
                  checked={candidate === mode}
                  disabled={busy}
                  onChange={() => void changeMode(candidate)}
                  data-testid={`registration-mode-${candidate}`}
                />
                <span>
                  <span className="security-settings__row-label">
                    {COPY.modes[candidate].label}
                  </span>
                  <span className="security-settings__row-meta">
                    {COPY.modes[candidate].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
      </div>

      <div className="security-group">
        <section className="ui-settings-panel" aria-labelledby="invitations-heading">
          <header className="security-settings__panel-head">
            <div>
              <h2 id="invitations-heading">{COPY.invitationsTitle}</h2>
              <p className="security-settings__lead">{COPY.invitationsLead}</p>
            </div>
            <Button
              size="compact"
              variant="secondary"
              disabled={busy}
              onClick={() => open({ kind: "invite" })}
              data-testid="create-invitation"
            >
              {COPY.createInvitation}
            </Button>
          </header>
          {mode === "invitation" ? null : (
            <p
              className="security-settings__note"
              data-kind="info"
              data-testid="invitations-inactive"
            >
              {COPY.invitationsInactive}
            </p>
          )}
          {invitations.length === 0 ? (
            <p className="security-settings__quiet" data-testid="invitation-empty">
              {COPY.noInvitation}
            </p>
          ) : (
            <ul className="security-settings__rows" data-testid="invitation-list">
              {invitations.map((invitation) => (
                <li
                  key={invitation.invitationId}
                  data-testid="invitation-row"
                  data-state={invitation.state}
                >
                  <div className="security-settings__row-main">
                    <span className="security-settings__row-label">
                      {invitation.label ?? COPY.invitationsTitle} ·{" "}
                      {COPY.invitationState[invitation.state]}
                    </span>
                    <span className="security-settings__row-meta" data-testid="invitation-uses">
                      {COPY.uses(invitation.useCount, invitation.maxUses)}
                      {invitation.expiresAt === null
                        ? ""
                        : ` · ${new Date(invitation.expiresAt).toLocaleDateString("fr-FR")}`}
                    </span>
                    {invitation.accounts.length === 0 ? null : (
                      <span
                        className="security-settings__row-meta"
                        data-testid="invitation-accounts"
                      >
                        {COPY.createdAccounts} :{" "}
                        {invitation.accounts.map((account) => account.pseudonym).join(", ")}
                      </span>
                    )}
                  </div>
                  {invitation.state === "active" ? (
                    <div className="security-settings__row-actions">
                      <Button
                        size="compact"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.revokeInvitation(invitation.invitationId), COPY.revoke)
                        }
                        data-testid="revoke-invitation"
                      >
                        {COPY.revoke}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={dialog?.kind === "create"}
        destructive={false}
        busy={busy}
        title={COPY.createTitle}
        description={COPY.created}
        confirmLabel={COPY.createAction}
        confirmTestId="create-account-confirm"
        confirmDisabled={!newPasswordValid}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (!newPasswordValid) return;
          void run(() => api.createAccount({ email, pseudonym, password }), COPY.created).then(
            (ok) => {
              if (ok) setDialog(null);
            },
          );
        }}
      >
        <div className="ui-auth-form">
          <Field
            id={ids.email}
            label={FORM.emailLabel}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="new-account-email"
          />
          <Field
            id={ids.pseudonym}
            label={FORM.pseudonymLabel}
            maxLength={64}
            value={pseudonym}
            onChange={(event) => setPseudonym(event.target.value)}
            data-testid="new-account-pseudonym"
          />
          <PasswordField
            id={ids.createPassword}
            label={FORM.passwordLabel}
            autoComplete="new-password"
            minLength={PASSWORD_MINIMUM_LENGTH}
            showStrength
            value={password}
            onChange={setPassword}
            testId="new-account-password"
          />
          <PasswordField
            id={ids.createPasswordConfirm}
            label={FORM.passwordConfirmLabel}
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={setPasswordConfirm}
            error={
              passwordConfirm.length > 0 && password !== passwordConfirm
                ? FORM.passwordMismatch
                : undefined
            }
            testId="new-account-password-confirm"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "reset"}
        destructive={false}
        busy={busy}
        title={COPY.resetTitle}
        description={
          dialog?.kind === "reset" ? `${dialog.account.pseudonym} · ${dialog.account.email}` : ""
        }
        confirmLabel={COPY.resetPassword}
        confirmTestId="reset-password-confirm"
        confirmDisabled={!newPasswordValid}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "reset" || !newPasswordValid) return;
          void run(
            () => api.resetAccountPassword(dialog.account.accountId, password),
            COPY.resetDone,
          ).then((ok) => {
            if (ok) setDialog(null);
          });
        }}
      >
        <PasswordField
          id={ids.resetPassword}
          label={FORM.passwordLabel}
          autoComplete="new-password"
          minLength={PASSWORD_MINIMUM_LENGTH}
          showStrength
          value={password}
          onChange={setPassword}
          testId="reset-password-input"
        />
        <PasswordField
          id={ids.resetPasswordConfirm}
          label={FORM.passwordConfirmLabel}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          error={
            passwordConfirm.length > 0 && password !== passwordConfirm
              ? FORM.passwordMismatch
              : undefined
          }
          testId="reset-password-confirm"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        busy={busy}
        title={COPY.deleteTitle}
        description={COPY.deleteDescription}
        confirmLabel={COPY.deleteAction}
        confirmTestId="delete-account-confirm"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          if (confirmEmail.trim().toLowerCase() !== dialog.account.email.toLowerCase()) return;
          void run(
            () => api.deleteAccount(dialog.account.accountId, confirmEmail),
            COPY.deleted,
          ).then((ok) => {
            if (ok) setDialog(null);
          });
        }}
      >
        <Field
          id={ids.confirm}
          label={COPY.deleteConfirmLabel}
          description={dialog?.kind === "delete" ? dialog.account.email : ""}
          type="email"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          data-testid="delete-account-email"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "invite"}
        destructive={false}
        busy={busy}
        title={COPY.createInvitation}
        description={COPY.invitationsLead}
        confirmLabel={COPY.createInvitation}
        confirmTestId="create-invitation-confirm"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          void (async () => {
            setBusy(true);
            setNotice(null);
            const result = await api.createInvitation({
              ...(label.trim() === "" ? {} : { label: label.trim() }),
              ...(maxUses === "" ? {} : { maxUses: Number(maxUses) }),
              ...(expiresInDays === "" ? {} : { expiresInDays: Number(expiresInDays) }),
            });
            setBusy(false);
            if (!result.ok) {
              setNotice({ kind: "error", message: COPY.actionFailed });
              return;
            }
            await refresh();
            setDialog({ kind: "link", url: result.value.url });
          })();
        }}
      >
        <div className="ui-auth-form">
          <Field
            id={ids.label}
            label={COPY.labelLabel}
            maxLength={120}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            data-testid="invitation-label"
          />
          <Field
            id={ids.uses}
            label={COPY.maxUsesLabel}
            description={COPY.unlimited}
            type="number"
            min={1}
            max={10000}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            data-testid="invitation-max-uses"
          />
          <Field
            id={ids.expires}
            label={COPY.expiresLabel}
            description={COPY.unlimited}
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            data-testid="invitation-expires"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "link"}
        destructive={false}
        title={COPY.newLinkTitle}
        description={COPY.newLinkNotice}
        confirmLabel={COPY.copy}
        confirmTestId="copy-invitation-link"
        cancelLabel={FR_COPY.actions.close}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "link") return;
          void navigator.clipboard?.writeText(dialog.url).then(
            () => setNotice({ kind: "success", message: COPY.copied }),
            () => undefined,
          );
        }}
      >
        <code className="administration__link" data-testid="invitation-link">
          {dialog?.kind === "link" ? dialog.url : ""}
        </code>
      </ConfirmDialog>
    </section>
  );
}
