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
import { useCallback, useEffect, useId, useState } from "react";
import type { RotationStatusView, SecurityApi } from "../../services/security-api.ts";
import { DevicePanel } from "./device-panel.tsx";
import { KeyRotationPanel } from "./key-rotation-panel.tsx";
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

export function SecuritySettings(props: SecuritySettingsProps) {
  const [passkeys, setPasskeys] = useState<readonly PasskeyViewDto[]>([]);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState<RotationStatusView | null>(null);
  const passwordId = useId();

  const refresh = useCallback(async () => {
    const result = await props.api.listPasskeys();
    if (result.ok) {
      setPasskeys(result.value.passkeys);
    }
    // A separate call, and a failure here is silent. Rotation state is
    // context, not the reason the owner came to this screen; an error banner
    // over their passkeys because a status read failed would be the tail
    // wagging the dog.
    const rotationResult = await props.api.rotationStatus();
    setRotation(rotationResult.ok ? rotationResult.value : null);
  }, [props.api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);
      const result = await props.api.setPassword(password);
      setPassword("");
      if (!result.ok) {
        setMessage(
          result.problem.code === "recent_authentication_required"
            ? "Confirm your passkey or password again before changing it."
            : result.problem.code === "validation_failed"
              ? "Use at least 12 characters. A few unrelated words works well."
              : "The password could not be saved.",
        );
        setBusy(false);
        return;
      }
      setMessage("Password saved.");
      setBusy(false);
    },
    [password, props.api],
  );

  const removePasskey = useCallback(
    async (credentialId: string) => {
      setBusy(true);
      setMessage(null);
      const result = await props.api.removePasskey(credentialId);
      if (!result.ok) {
        setMessage(
          result.problem.code === "conflict"
            ? "This is your only way to sign in. Add another passkey or set a password first."
            : result.problem.code === "recent_authentication_required"
              ? "Confirm your passkey or password again before removing one."
              : "That passkey could not be removed.",
        );
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
    <main className="security-settings" aria-labelledby="security-heading">
      <h1 id="security-heading">Security</h1>

      <p
        className="security-message"
        role="status"
        aria-live="polite"
        data-testid="security-message"
      >
        {message ?? ""}
      </p>

      <section aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading">Passkeys</h2>
        <ul data-testid="passkey-list">
          {activePasskeys.map((passkey) => (
            <li key={passkey.credentialId} data-testid="passkey-row">
              <span>{passkey.label}</span>
              <button
                type="button"
                onClick={() => {
                  void removePasskey(passkey.credentialId);
                }}
                disabled={busy}
                data-testid="remove-passkey"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {activePasskeys.length === 1 ? (
          <p className="security-note" data-testid="last-passkey-note">
            This is your only passkey. Add another, or set a password, before removing it.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="password-heading">
        <h2 id="password-heading">Password</h2>
        <p>
          An alternative for when a passkey is not available. Your passkey keeps working either way.
        </p>
        <p className="security-warning" data-testid="no-reset-warning">
          There is no password reset. This installation has no way to reach you, so if you forget
          it, sign in with your passkey — or use your recovery kit if you have lost both.
        </p>
        <form onSubmit={savePassword}>
          <label htmlFor={passwordId}>New password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            data-testid="new-password-input"
          />
          <button type="submit" disabled={busy} data-testid="save-password">
            Save password
          </button>
        </form>
      </section>

      <SessionPanel
        api={props.api}
        currentSessionId={props.currentSessionId}
        onSignedOut={props.onSignedOut}
      />

      <DevicePanel api={props.api} currentDeviceId={props.currentDeviceId ?? null} />

      {rotation !== null && (
        <KeyRotationPanel
          policies={rotation.policies}
          running={rotation.running}
          writesAllowed={rotation.writesAllowed}
        />
      )}
    </main>
  );
}
