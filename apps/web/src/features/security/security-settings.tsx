/**
 * Owner security settings (T047, feature 002).
 *
 * Credentials and sessions on one screen, because the question an owner brings
 * here is a single one: *who can get in, and from where?* Splitting them
 * across two pages makes that question take two visits.
 *
 * The password section says plainly that there is no reset. An owner deciding
 * whether to set one deserves to know that before they choose it, not after
 * they forget it.
 */

import type { PasskeyViewDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useState } from "react";
import type {
  PreparedRecoveryKit,
  RecoveryStatusView,
  RotationStatusView,
  SecurityApi,
} from "../../services/security-api.ts";
import { FR_COPY } from "../../ui/copy/index.ts";
import { Button, FormMessage } from "../../ui/primitives/index.ts";
import { enrollAccountPasskey } from "../auth/passkey-enrollment.ts";
import { PasswordField } from "../auth/password-field.tsx";
import { assessPassword, PASSWORD_MINIMUM_LENGTH } from "../auth/password-strength.ts";
import { DevicePanel } from "./device-panel.tsx";
import { KeyRotationPanel } from "./key-rotation-panel.tsx";
import { McpAccessPanel } from "./mcp-access-panel.tsx";
import { ReauthDialog } from "./reauth-dialog.tsx";
import { saveKitBlob } from "./recovery-kit-panel.tsx";
import { RecoveryReadinessPanel } from "./recovery-readiness-panel.tsx";
import {
  type RecoveryReplacementDelivery,
  RecoveryReplacementPanel,
} from "./recovery-replacement-panel.tsx";
import { SessionPanel } from "./session-panel.tsx";

export interface SecuritySettingsProps {
  readonly api: SecurityApi;
  readonly currentSessionId: string | null;
  /**
   * The device this browser is using, when the caller knows it.
   *
   * Optional because not every entry point has loaded the session yet. When it
   * is absent the inventory simply does not mark a row as "this device" —
   * better than guessing, which would point an owner at the wrong device to
   * revoke.
   */
  readonly currentDeviceId?: string | null;
  readonly onSignedOut: () => void;
  readonly onReauthenticated?: () => void;
  /**
   * Recovery kits and key rotation belong to the installation, so only its
   * administrator sees them (feature 058). Members keep their own sign-in,
   * sessions, devices and assistants.
   */
  readonly administrator?: boolean;
}

interface SecurityNotice {
  readonly kind: "error" | "info" | "success";
  readonly message: string;
}

export function SecuritySettings(props: SecuritySettingsProps) {
  const [passkeys, setPasskeys] = useState<readonly PasskeyViewDto[]>([]);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [notice, setNotice] = useState<SecurityNotice | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState<RotationStatusView | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatusView | null>(null);
  const [replacement, setReplacement] = useState<Pick<
    PreparedRecoveryKit,
    "kitId" | "downloadExpiresAt" | "notice"
  > | null>(null);
  const [replacementConsumedKitId, setReplacementConsumedKitId] = useState<string | null>(null);
  const [replacementSavedKitId, setReplacementSavedKitId] = useState<string | null>(null);
  const [replacementNotice, setReplacementNotice] = useState<SecurityNotice | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await props.api.listPasskeys();
    if (result.ok) {
      setPasskeys(result.value.passkeys);
    } else {
      setNotice({ kind: "error", message: FR_COPY.security.passkeys.loadFailed });
    }
    // A separate call, and a failure here is silent. Rotation state is
    // context, not the reason the owner came to this screen; an error banner
    // over their passkeys because a status read failed would be the tail
    // wagging the dog.
    if (props.administrator !== true) {
      setRotation(null);
      setRecovery(null);
      setLoading(false);
      return;
    }
    const rotationResult = await props.api.rotationStatus();
    setRotation(rotationResult.ok ? rotationResult.value : null);
    // Left null on failure rather than defaulted. The panel reads null as
    // "cannot tell you either way", which is the honest answer and is not the
    // same as "you have no kit".
    const recoveryResult = await props.api.recoveryStatus();
    if (recoveryResult.ok) {
      setRecovery(recoveryResult.value);
      const pending = recoveryResult.value.pending;
      if (pending === null) {
        setReplacement(null);
        setReplacementConsumedKitId(null);
        setReplacementSavedKitId(null);
      } else {
        const resumedConsumedKit = pending.deliveryState === "download-consumed";
        const alreadyKnownConsumed = replacementConsumedKitId === pending.kitId;
        if (resumedConsumedKit) {
          setReplacementConsumedKitId(pending.kitId);
          // After a reload, the server is the only durable evidence that the
          // one-time response was delivered. Let the owner acknowledge it;
          // preserve a known in-session save failure instead of overriding it.
          if (!alreadyKnownConsumed) {
            setReplacementSavedKitId(pending.kitId);
            setReplacementNotice({
              kind: "info",
              message: FR_COPY.security.recovery.replacement.resumed,
            });
          }
        }
        setReplacement((current) =>
          current?.kitId === pending.kitId
            ? {
                ...current,
                downloadExpiresAt: pending.downloadExpiresAt ?? current.downloadExpiresAt,
                notice: recoveryResult.value.notice,
              }
            : {
                kitId: pending.kitId,
                downloadExpiresAt: pending.downloadExpiresAt ?? "",
                notice: recoveryResult.value.notice,
              },
        );
      }
    } else {
      setRecovery(null);
    }
    setLoading(false);
  }, [props.api, props.administrator, replacementConsumedKitId]);

  // An action interrupted by `recent_authentication_required`, resumed after the modal.
  const [pendingIdentity, setPendingIdentity] = useState<
    | { readonly kind: "add-passkey" }
    | { readonly kind: "remove-passkey"; readonly credentialId: string }
    | null
  >(null);

  const addPasskey = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await enrollAccountPasskey(props.api, {
      label: FR_COPY.accounts.passkeyOffer.label,
    });
    setBusy(false);
    if (!outcome.ok) {
      if (outcome.reason === "reauthenticate") {
        // Ask for the password right here, then resume the enrollment.
        setPendingIdentity({ kind: "add-passkey" });
        return;
      }
      setNotice({ kind: "error", message: FR_COPY.accounts.passkeyOffer.failed });
      return;
    }
    setNotice({ kind: "success", message: FR_COPY.accounts.passkeyOffer.added });
    await refresh();
  }, [props.api, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A success toast leaves on its own; an error stays until the next action.
  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const savePassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setNotice(null);
      if (password !== passwordConfirm) {
        setBusy(false);
        return;
      }
      setCurrentPasswordError(null);
      // The current password comes first: it proves the change is wanted by the
      // account holder and refreshes the session, so no "sign in again" detour.
      const proof = await props.api.reauthenticateWithPassword(currentPassword);
      if (!proof.ok) {
        setCurrentPasswordError(
          proof.problem.code === "rate_limited"
            ? FR_COPY.auth.login.rateLimited
            : proof.problem.code === "service_unavailable"
              ? "Le serveur est inaccessible. Vérifiez la connexion puis réessayez."
              : "Mot de passe actuel incorrect.",
        );
        setBusy(false);
        return;
      }
      setCurrentPassword("");
      const result = await props.api.setPassword(password);
      setPassword("");
      setPasswordConfirm("");
      if (!result.ok) {
        setNotice({
          kind: "error",
          message:
            result.problem.code === "recent_authentication_required"
              ? FR_COPY.security.recentAuthentication
              : result.problem.code === "validation_failed"
                ? FR_COPY.security.password.validation
                : FR_COPY.security.password.failed,
        });
        setBusy(false);
        return;
      }
      setNotice({ kind: "success", message: FR_COPY.security.password.saved });
      setBusy(false);
    },
    [currentPassword, password, passwordConfirm, props.api],
  );

  const removePasskey = useCallback(
    async (credentialId: string) => {
      setBusy(true);
      setNotice(null);
      const result = await props.api.removePasskey(credentialId);
      if (!result.ok && result.problem.code === "recent_authentication_required") {
        setBusy(false);
        setPendingIdentity({ kind: "remove-passkey", credentialId });
        return;
      }
      if (!result.ok) {
        setNotice({
          kind: "error",
          message:
            result.problem.code === "conflict"
              ? FR_COPY.security.passkeys.removeOnly
              : FR_COPY.security.passkeys.removeFailed,
        });
        setBusy(false);
        return;
      }
      await refresh();
      setBusy(false);
    },
    [props.api, refresh],
  );

  const activePasskeys = passkeys.filter((passkey) => passkey.state === "active");

  const prepareReplacement = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setReplacementNotice(null);
    const result = await props.api.prepareRecoveryReplacement();
    if (!result.ok) {
      setNotice({ kind: "error", message: FR_COPY.security.recovery.prepareFailed });
      setBusy(false);
      return;
    }
    setReplacement(result.value);
    setReplacementConsumedKitId(null);
    setReplacementSavedKitId(null);
    setNotice({ kind: "success", message: FR_COPY.security.recovery.prepared });
    await refresh();
    setBusy(false);
  }, [props.api, refresh]);

  const downloadReplacement = useCallback(async () => {
    if (replacement === null) return;
    setBusy(true);
    setNotice(null);
    setReplacementNotice(null);
    const result = await props.api.downloadRecoveryKit(replacement.kitId);
    if (!result.ok) {
      setReplacementNotice({
        kind: "error",
        message: result.consumed
          ? result.problem.status === 409
            ? FR_COPY.security.recovery.replacement.downloadAlreadyConsumed
            : FR_COPY.security.recovery.replacement.downloadConsumedUnreadable
          : FR_COPY.security.recovery.replacement.downloadFailed,
      });
      setReplacementSavedKitId(null);
      if (result.consumed) {
        setReplacementConsumedKitId(replacement.kitId);
      }
      setBusy(false);
      return;
    }
    let saved = false;
    try {
      saved = await saveKitBlob(result.value, "myownnotion-recovery.json");
      if (!saved) {
        setReplacementNotice({
          kind: "error",
          message: FR_COPY.security.recovery.replacement.saveFailed,
        });
      }
    } catch {
      setReplacementNotice({
        kind: "error",
        message: FR_COPY.security.recovery.replacement.saveFailed,
      });
    }
    setReplacementConsumedKitId(replacement.kitId);
    setReplacementSavedKitId(saved ? replacement.kitId : null);
    setBusy(false);
  }, [props.api, replacement]);

  const confirmReplacement = useCallback(async () => {
    if (
      replacement === null ||
      replacementConsumedKitId !== replacement.kitId ||
      replacementSavedKitId !== replacement.kitId
    )
      return;
    setBusy(true);
    setNotice(null);
    setReplacementNotice(null);
    const result = await props.api.confirmRecoveryKit(replacement.kitId);
    if (!result.ok) {
      setReplacementNotice({
        kind: "error",
        message: FR_COPY.security.recovery.replacement.confirmFailed,
      });
      setBusy(false);
      return;
    }
    setReplacement(null);
    setReplacementConsumedKitId(null);
    setReplacementSavedKitId(null);
    setNotice({ kind: "success", message: FR_COPY.security.recovery.replacement.confirmed });
    await refresh();
    setBusy(false);
  }, [props.api, refresh, replacement, replacementConsumedKitId, replacementSavedKitId]);

  const revokeRecovery = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setReplacementNotice(null);
    const result = await props.api.revokeRecoveryKit();
    if (!result.ok) {
      setNotice({ kind: "error", message: FR_COPY.security.recovery.replacement.revokeFailed });
      setReplacementNotice({
        kind: "error",
        message: FR_COPY.security.recovery.replacement.revokeFailed,
      });
      setBusy(false);
      return;
    }
    setNotice({
      kind: "success",
      message: FR_COPY.security.recovery.replacement.revokedWithCode(result.value.revocationCode),
    });
    await refresh();
    setBusy(false);
  }, [props.api, refresh]);

  return (
    <section
      className="security-settings"
      aria-labelledby="security-heading"
      data-testid="security-settings"
    >
      <h2 id="security-heading" className="ui-visually-hidden">
        {FR_COPY.security.title}
      </h2>

      <nav className="security-settings__toc" aria-label="Sommaire de la sécurité">
        <a href="#passkeys-heading">Connexion</a>
        <a href="#sessions-heading">Sessions</a>
        <a href="#devices-heading">Appareils</a>
        <a href="#mcp-heading">MCP</a>
        {props.administrator === true ? (
          <a href="#recovery-readiness-heading">Récupération</a>
        ) : null}
      </nav>

      {notice === null ? null : (
        <p
          className="security-settings__note"
          data-kind={notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
          data-testid="security-message"
        >
          {notice.message}
        </p>
      )}

      <div className="security-group">
        <p className="security-group__eyebrow">Connexion</p>

        <section className="ui-settings-panel" aria-labelledby="passkeys-heading">
          <header className="security-settings__panel-head">
            <div>
              <h2 id="passkeys-heading">{FR_COPY.security.passkeys.title}</h2>
              <p className="security-settings__lead">
                Les clés enregistrées sur vos appareils pour ouvrir cet espace.
              </p>
            </div>
            <Button
              size="compact"
              variant="secondary"
              busy={busy}
              onClick={() => {
                void addPasskey();
              }}
              data-testid="add-passkey"
            >
              {FR_COPY.accounts.passkeyOffer.action}
            </Button>
          </header>
          {loading ? (
            <p className="security-settings__quiet" role="status">
              {FR_COPY.security.passkeys.loading}
            </p>
          ) : activePasskeys.length === 0 ? (
            <p className="security-settings__quiet" data-testid="passkey-empty">
              Aucune passkey active.
            </p>
          ) : (
            <ul className="security-settings__rows" data-testid="passkey-list">
              {activePasskeys.map((passkey) => (
                <li key={passkey.credentialId} data-testid="passkey-row">
                  <div className="security-settings__row-main">
                    <span className="security-settings__row-label">{passkey.label}</span>
                  </div>
                  <div className="security-settings__row-actions">
                    <Button
                      size="compact"
                      variant="secondary"
                      data-tone="destructive"
                      onClick={() => {
                        void removePasskey(passkey.credentialId);
                      }}
                      disabled={busy}
                      data-testid="remove-passkey"
                    >
                      {FR_COPY.security.passkeys.remove}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activePasskeys.length === 1 ? (
            <p className="security-settings__note" data-testid="last-passkey-note">
              {FR_COPY.security.passkeys.onlyOne}
            </p>
          ) : null}
        </section>

        <section className="ui-settings-panel" aria-labelledby="password-heading">
          <header className="security-settings__panel-head">
            <div>
              <h2 id="password-heading">{FR_COPY.security.password.title}</h2>
              <p className="security-settings__lead">{FR_COPY.security.password.description}</p>
            </div>
          </header>
          <form
            onSubmit={savePassword}
            className="security-settings__inline-form security-settings__password-form"
          >
            <PasswordField
              id="security-current-password"
              autoComplete="current-password"
              label="Mot de passe actuel"
              value={currentPassword}
              onChange={(value) => {
                setCurrentPassword(value);
                setCurrentPasswordError(null);
              }}
              disabled={busy}
              invalid={currentPasswordError !== null}
              testId="current-password-input"
            />
            <FormMessage testId="current-password-message">{currentPasswordError}</FormMessage>
            <PasswordField
              id="security-new-password"
              autoComplete="new-password"
              minLength={PASSWORD_MINIMUM_LENGTH}
              showStrength
              label={FR_COPY.security.password.label}
              value={password}
              onChange={setPassword}
              disabled={busy || currentPassword.length === 0}
              testId="new-password-input"
            />
            <PasswordField
              id="security-new-password-confirm"
              autoComplete="new-password"
              label={FR_COPY.accounts.bootstrap.passwordConfirmLabel}
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              disabled={busy || currentPassword.length === 0}
              testId="new-password-confirm"
              error={
                passwordConfirm.length > 0 && password !== passwordConfirm
                  ? FR_COPY.accounts.bootstrap.passwordMismatch
                  : undefined
              }
            />
            <Button
              type="submit"
              size="compact"
              variant="secondary"
              busy={busy}
              disabled={
                busy ||
                currentPassword.length === 0 ||
                !assessPassword(password).meetsMinimum ||
                password !== passwordConfirm
              }
              data-testid="save-password"
            >
              {FR_COPY.security.password.save}
            </Button>
          </form>
          <p className="security-settings__note" data-testid="no-reset-warning">
            {FR_COPY.security.password.warning}
          </p>
        </section>
      </div>

      <div className="security-group">
        <p className="security-group__eyebrow">Sessions et appareils</p>

        <SessionPanel
          api={props.api}
          currentSessionId={props.currentSessionId}
          onSignedOut={props.onSignedOut}
        />

        <DevicePanel api={props.api} currentDeviceId={props.currentDeviceId ?? null} />
      </div>

      <div className="security-group">
        <p className="security-group__eyebrow">MCP</p>

        <McpAccessPanel api={props.api} onReauthenticated={props.onReauthenticated} />
      </div>

      {props.administrator !== true ? null : (
        <div className="security-group">
          <p className="security-group__eyebrow">Récupération</p>

          <RecoveryReadinessPanel
            status={recovery}
            busy={busy}
            loading={loading}
            onPrepareReplacement={prepareReplacement}
            onRevoke={revokeRecovery}
          />

          {replacement === null ? null : (
            <RecoveryReplacementPanel
              key={replacement.kitId}
              kit={replacement}
              delivery={
                replacementConsumedKitId === replacement.kitId
                  ? ("download-consumed" satisfies RecoveryReplacementDelivery)
                  : "downloadable"
              }
              downloadSaved={replacementSavedKitId === replacement.kitId}
              busy={busy}
              {...(replacementNotice === null
                ? {}
                : { message: { kind: replacementNotice.kind, text: replacementNotice.message } })}
              onDownload={downloadReplacement}
              onConfirm={confirmReplacement}
            />
          )}

          {rotation !== null && (
            <KeyRotationPanel
              policies={rotation.policies}
              running={rotation.running}
              writesAllowed={rotation.writesAllowed}
            />
          )}
        </div>
      )}
      <ReauthDialog
        api={props.api}
        open={pendingIdentity !== null}
        testId="security-reauth"
        description={
          pendingIdentity?.kind === "remove-passkey"
            ? "Retirer une passkey demande une confirmation récente. Le retrait reprend dès que vous êtes confirmé."
            : "Ajouter une passkey demande une confirmation récente. L’ajout reprend dès que vous êtes confirmé."
        }
        onCancel={() => setPendingIdentity(null)}
        onConfirmed={() => {
          const pending = pendingIdentity;
          setPendingIdentity(null);
          props.onReauthenticated?.();
          if (pending?.kind === "add-passkey") void addPasskey();
          else if (pending?.kind === "remove-passkey") void removePasskey(pending.credentialId);
        }}
      />
    </section>
  );
}
