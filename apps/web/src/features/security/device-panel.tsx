/**
 * The owner's device inventory (T071, US3, FR-008 – FR-010).
 *
 * Like the session list, this exists so an owner can answer one question:
 * *is there a device here I do not recognise?* Everything else follows.
 *
 * The presentation makes two refusals explicit, because both are places where
 * a helpful-looking default would mislead:
 *
 *   - **"Never used" is said in words, not shown as a date.** The server sends
 *     null for a device that has never been active, and a list that quietly
 *     rendered the authorization date instead would hide the one row worth
 *     noticing — a device authorized long ago and never touched since.
 *   - **Revoking says what it will cost.** It needs a fresh proof of identity,
 *     so the button announces that rather than letting the owner discover it
 *     as an error after they commit.
 */

import type { DeviceDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useState } from "react";
import type { SecurityApi } from "../../services/security-api.ts";

export interface DevicePanelProps {
  readonly api: SecurityApi;
  /** The device this browser is using, so it can be marked. */
  readonly currentDeviceId: string | null;
}

/**
 * Exported so the "never used" decision is testable without a DOM.
 *
 * It is the one piece of presentation here that changes what an owner
 * concludes: a date where the server said null would hide a device authorized
 * long ago and never touched since.
 */
export function describeLastUse(iso: string | null): string {
  if (iso === null) {
    // Deliberately words, not a date. See the module comment.
    return "never";
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "unknown" : at.toLocaleString();
}

export function describeState(state: DeviceDto["state"]): string {
  switch (state) {
    case "revoked":
      return "Revoked";
    case "reauthorization-required":
      return "Needs to sign in again";
    case "pending":
      return "Not yet confirmed";
    default:
      return "Active";
  }
}

export function DevicePanel(props: DevicePanelProps) {
  const [devices, setDevices] = useState<readonly DeviceDto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const refresh = useCallback(async () => {
    const result = await props.api.listDevices();
    if (!result.ok) {
      setMessage("The device list could not be loaded.");
      return;
    }
    setDevices(result.value.devices);
  }, [props.api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Reports a refusal in the owner's terms.
   *
   * `recent_authentication_required` is not an error the owner caused, so it
   * is phrased as the next step rather than as a failure.
   */
  const explain = useCallback((code: string, fallback: string): string => {
    return code === "recent_authentication_required"
      ? "Confirm your passkey or password again, then try that once more."
      : fallback;
  }, []);

  const rename = useCallback(
    async (deviceId: string) => {
      const name = draftName.trim();
      if (name.length === 0) {
        setMessage("A device needs a name.");
        return;
      }
      setBusy(true);
      const result = await props.api.renameDevice(deviceId, name);
      if (!result.ok) {
        setMessage(explain(result.problem.code, "That device could not be renamed."));
      } else {
        setEditing(null);
        await refresh();
      }
      setBusy(false);
    },
    [draftName, explain, props.api, refresh],
  );

  const revoke = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      setMessage(null);
      const result = await props.api.revokeDevice(deviceId);
      if (!result.ok) {
        setMessage(explain(result.problem.code, "That device could not be revoked."));
      } else {
        await refresh();
        setMessage("That device can no longer reach this workspace.");
      }
      setBusy(false);
    },
    [explain, props.api, refresh],
  );

  const reauthorize = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      setMessage(null);
      const result = await props.api.reauthorizeDevice(deviceId);
      if (!result.ok) {
        setMessage(
          explain(result.problem.code, "That device could not be asked to sign in again."),
        );
      } else {
        await refresh();
        setMessage("That device will be asked to sign in again.");
      }
      setBusy(false);
    },
    [explain, props.api, refresh],
  );

  return (
    <section className="device-panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">Your devices</h2>
      <p className="device-message" role="status" aria-live="polite" data-testid="device-message">
        {message ?? ""}
      </p>

      <ul className="device-list" data-testid="device-list">
        {devices.map((device) => {
          const isCurrent = device.deviceId === props.currentDeviceId;
          const revoked = device.state === "revoked";
          return (
            <li key={device.deviceId} data-testid="device-row">
              {editing === device.deviceId ? (
                <div>
                  <label htmlFor={`device-name-${device.deviceId}`}>Device name</label>
                  <input
                    id={`device-name-${device.deviceId}`}
                    value={draftName}
                    onChange={(event) => {
                      setDraftName(event.target.value);
                    }}
                    data-testid="device-name-input"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void rename(device.deviceId);
                    }}
                    disabled={busy}
                    data-testid="save-device-name"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div>
                  <strong>{device.name}</strong>
                  {isCurrent ? <span data-testid="current-device"> — this device</span> : null}
                </div>
              )}

              <div className="device-detail">
                {device.platform} · {describeState(device.state)} · last used{" "}
                <span data-testid="device-last-activity">
                  {describeLastUse(device.lastActivityAt)}
                </span>{" "}
                · last synchronized{" "}
                <span data-testid="device-last-sync">{describeLastUse(device.lastSyncAt)}</span>
              </div>

              {revoked ? null : (
                <div className="device-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(device.deviceId);
                      setDraftName(device.name);
                    }}
                    disabled={busy}
                    data-testid="rename-device"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void reauthorize(device.deviceId);
                    }}
                    disabled={busy}
                    data-testid="reauthorize-device"
                  >
                    Ask it to sign in again
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      void revoke(device.deviceId);
                    }}
                    disabled={busy}
                    // Says what it costs before the owner commits, rather than
                    // letting them meet the requirement as an error.
                    title="You will be asked to confirm your passkey or password"
                    data-testid="revoke-device"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
