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
  RecoveryStatusView,
  RotationStatusView,
  SecurityApi,
} from "../../services/security-api.ts";
import { FR_COPY } from "../../ui/copy/index.ts";
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";
import { DevicePanel } from "./device-panel.tsx";
import { KeyRotationPanel } from "./key-rotation-panel.tsx";
import { RecoveryReadinessPanel } from "./recovery-readiness-panel.tsx";
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
}

interface SecurityNotice {
  readonly kind: "error" | "info" | "success";
  readonly message: string;
}

export function SecuritySettings(props: SecuritySettingsProps) {
  const [passkeys, setPasskeys] = useState<readonly PasskeyViewDto[]>([]);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<SecurityNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState<RotationStatusView | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatusView | null>(null);

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
    const rotationResult = await props.api.rotationStatus();
    setRotation(rotationResult.ok ? rotationResult.value : null);
    // Left null on failure rather than defaulted. The panel reads null as
    // "cannot tell you either way", which is the honest answer and is not the
    // same as "you have no kit".
    const recoveryResult = await props.api.recoveryStatus();
    setRecovery(recoveryResult.ok ? recoveryResult.value : null);
    setLoading(false);
  }, [props.api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setNotice(null);
      const result = await props.api.setPassword(password);
      setPassword("");
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
    [password, props.api],
  );

  const removePasskey = useCallback(
    async (credentialId: string) => {
      setBusy(true);
      setNotice(null);
      const result = await props.api.removePasskey(credentialId);
      if (!result.ok) {
        setNotice({
          kind: "error",
          message:
            result.problem.code === "conflict"
              ? FR_COPY.security.passkeys.removeOnly
              : result.problem.code === "recent_authentication_required"
                ? FR_COPY.security.recentAuthentication
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

  return (
    <section
      className="security-settings"
      aria-labelledby="security-heading"
      data-testid="security-settings"
    >
      <h2 id="security-heading">{FR_COPY.security.title}</h2>

      {notice === null ? null : (
        <AsyncState compact kind={notice.kind} title={notice.message} testId="security-message" />
      )}

      <section className="ui-settings-panel" aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading">{FR_COPY.security.passkeys.title}</h2>
        {loading ? (
          <AsyncState compact kind="loading" title={FR_COPY.security.passkeys.loading} />
        ) : (
          <ul data-testid="passkey-list">
            {activePasskeys.map((passkey) => (
              <li key={passkey.credentialId} data-testid="passkey-row">
                <span>{passkey.label}</span>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    void removePasskey(passkey.credentialId);
                  }}
                  disabled={busy}
                  data-testid="remove-passkey"
                >
                  {FR_COPY.security.passkeys.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {activePasskeys.length === 1 ? (
          <p className="security-note" data-testid="last-passkey-note">
            {FR_COPY.security.passkeys.onlyOne}
          </p>
        ) : null}
      </section>

      <section className="ui-settings-panel" aria-labelledby="password-heading">
        <h2 id="password-heading">{FR_COPY.security.password.title}</h2>
        <p>{FR_COPY.security.password.description}</p>
        <p className="security-warning" data-testid="no-reset-warning">
          {FR_COPY.security.password.warning}
        </p>
        <form onSubmit={savePassword}>
          <Field
            type="password"
            autoComplete="new-password"
            minLength={12}
            label={FR_COPY.security.password.label}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            data-testid="new-password-input"
          />
          <Button type="submit" variant="primary" busy={busy} data-testid="save-password">
            {FR_COPY.security.password.save}
          </Button>
        </form>
      </section>

      <SessionPanel
        api={props.api}
        currentSessionId={props.currentSessionId}
        onSignedOut={props.onSignedOut}
      />

      <DevicePanel api={props.api} currentDeviceId={props.currentDeviceId ?? null} />

      <RecoveryReadinessPanel
        status={recovery}
        busy={busy}
        onPrepareReplacement={async () => {
          setBusy(true);
          const result = await props.api.prepareRecoveryReplacement();
          setNotice({
            kind: result.ok ? "success" : "error",
            message: result.ok
              ? FR_COPY.security.recovery.prepared
              : FR_COPY.security.recovery.prepareFailed,
          });
          await refresh();
          setBusy(false);
        }}
      />

      {rotation !== null && (
        <KeyRotationPanel
          policies={rotation.policies}
          running={rotation.running}
          writesAllowed={rotation.writesAllowed}
        />
      )}
    </section>
  );
}
