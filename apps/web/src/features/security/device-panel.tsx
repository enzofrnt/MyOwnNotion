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
import { FR_COPY, formatDateTime } from "../../ui/copy/index.ts";
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";

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
    return FR_COPY.security.devices.never;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? FR_COPY.security.devices.unknown : formatDateTime(at);
}

/**
 * What revoking does, and what it does not (FR-010).
 *
 * Revocation stops a device reaching the workspace from now on. It cannot
 * reach back and erase what the device already holds — a lost laptop that
 * never comes online again keeps whatever was on it. Saying only "revoked"
 * would let an owner believe their data was wiped, and stop looking for the
 * device.
 */
export const REVOKED_NOTICE = FR_COPY.security.devices.revokedNotice;

export function describeState(state: DeviceDto["state"]): string {
  switch (state) {
    case "revoked":
      return FR_COPY.security.devices.states.revoked;
    case "reauthorization-required":
      return FR_COPY.security.devices.states.reauthorizationRequired;
    case "pending":
      return FR_COPY.security.devices.states.pending;
    default:
      return FR_COPY.security.devices.states.active;
  }
}

interface DeviceNotice {
  readonly kind: "error" | "info" | "success";
  readonly message: string;
}

export function DevicePanel(props: DevicePanelProps) {
  const [devices, setDevices] = useState<readonly DeviceDto[]>([]);
  const [notice, setNotice] = useState<DeviceNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await props.api.listDevices();
    if (!result.ok) {
      setNotice({ kind: "error", message: FR_COPY.security.devices.loadFailed });
      setLoading(false);
      return;
    }
    setDevices(result.value.devices);
    setLoading(false);
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
      ? FR_COPY.security.recentAuthentication
      : fallback;
  }, []);

  const rename = useCallback(
    async (deviceId: string) => {
      const name = draftName.trim();
      if (name.length === 0) {
        setNotice({ kind: "error", message: FR_COPY.security.devices.nameRequired });
        return;
      }
      setBusy(true);
      const result = await props.api.renameDevice(deviceId, name);
      if (!result.ok) {
        setNotice({
          kind: "error",
          message: explain(result.problem.code, FR_COPY.security.devices.renameFailed),
        });
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
      setNotice(null);
      const result = await props.api.revokeDevice(deviceId);
      if (!result.ok) {
        setNotice({
          kind: "error",
          message: explain(result.problem.code, FR_COPY.security.devices.revokeFailed),
        });
      } else {
        await refresh();
        setNotice({ kind: "success", message: REVOKED_NOTICE });
      }
      setBusy(false);
    },
    [explain, props.api, refresh],
  );

  const reauthorize = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      setNotice(null);
      const result = await props.api.reauthorizeDevice(deviceId);
      if (!result.ok) {
        setNotice({
          kind: "error",
          message: explain(result.problem.code, FR_COPY.security.devices.reauthorizeFailed),
        });
      } else {
        await refresh();
        setNotice({ kind: "success", message: FR_COPY.security.devices.reauthorizeScheduled });
      }
      setBusy(false);
    },
    [explain, props.api, refresh],
  );

  return (
    <section className="device-panel ui-settings-panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">{FR_COPY.security.devices.title}</h2>
      {notice === null ? null : (
        <AsyncState
          compact
          className="device-message"
          kind={notice.kind}
          title={notice.message}
          testId="device-message"
        />
      )}

      {loading ? (
        <AsyncState compact kind="loading" title={FR_COPY.security.devices.loading} />
      ) : devices.length === 0 ? (
        <AsyncState compact kind="empty" title={FR_COPY.security.devices.empty} />
      ) : (
        <ul className="device-list" data-testid="device-list">
          {devices.map((device) => {
            const isCurrent = device.deviceId === props.currentDeviceId;
            const revoked = device.state === "revoked";
            return (
              <li key={device.deviceId} data-testid="device-row">
                {editing === device.deviceId ? (
                  <div>
                    <Field
                      id={`device-name-${device.deviceId}`}
                      label={FR_COPY.security.devices.name}
                      value={draftName}
                      onChange={(event) => {
                        setDraftName(event.target.value);
                      }}
                      data-testid="device-name-input"
                    />
                    <Button
                      size="compact"
                      variant="primary"
                      onClick={() => {
                        void rename(device.deviceId);
                      }}
                      busy={busy}
                      data-testid="save-device-name"
                    >
                      {FR_COPY.security.devices.saveName}
                    </Button>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                      }}
                      disabled={busy}
                    >
                      {FR_COPY.security.devices.cancelRename}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <strong>{device.name}</strong>
                    {isCurrent ? (
                      <span data-testid="current-device">
                        {" "}
                        — {FR_COPY.security.devices.current}
                      </span>
                    ) : null}
                  </div>
                )}

                <div className="device-detail">
                  {device.platform} · {describeState(device.state)} ·{" "}
                  {FR_COPY.security.devices.lastUsed}{" "}
                  <span data-testid="device-last-activity">
                    {describeLastUse(device.lastActivityAt)}
                  </span>{" "}
                  · {FR_COPY.security.devices.lastSynchronized}{" "}
                  <span data-testid="device-last-sync">{describeLastUse(device.lastSyncAt)}</span>
                </div>

                {revoked ? null : (
                  <div className="device-actions">
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => {
                        setEditing(device.deviceId);
                        setDraftName(device.name);
                      }}
                      disabled={busy}
                      data-testid="rename-device"
                    >
                      {FR_COPY.security.devices.rename}
                    </Button>
                    <Button
                      size="compact"
                      variant="secondary"
                      onClick={() => {
                        void reauthorize(device.deviceId);
                      }}
                      disabled={busy}
                      data-testid="reauthorize-device"
                    >
                      {FR_COPY.security.devices.reauthorize}
                    </Button>
                    <Button
                      size="compact"
                      variant="danger"
                      onClick={() => {
                        void revoke(device.deviceId);
                      }}
                      disabled={busy}
                      // Says what it costs before the owner commits, rather than
                      // letting them meet the requirement as an error.
                      title={FR_COPY.security.devices.revokeTitle}
                      data-testid="revoke-device"
                    >
                      {FR_COPY.security.devices.revoke}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
