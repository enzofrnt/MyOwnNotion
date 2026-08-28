/**
 * Recovery kit download and offline confirmation (T033, feature 002).
 *
 * The panel's whole job is to make one thing hard to do by accident: claim to
 * have stored a kit that was never downloaded. The confirmation control stays
 * disabled until the download has actually been consumed, and the checkbox is
 * a separate deliberate act from the button.
 *
 * The kit itself never becomes React state. It arrives as a `Blob`, goes
 * straight to an object URL, and the URL is revoked as soon as the click is
 * dispatched — so the recovery material is not sitting in the component tree
 * where a state snapshot or an error reporter would pick it up.
 */

import { useCallback, useId, useState } from "react";
import { FR_COPY, formatDateTime } from "../../ui/copy/index.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

export type KitDelivery = "downloadable" | "download-consumed";

/**
 * The thing an owner must be told and would never guess.
 *
 * This installation seals its recovery kit under the deployment key file on
 * the host. That removes the passphrase an owner would otherwise have to
 * transcribe and never lose — and it means **the kit alone restores nothing**.
 *
 * An owner who is not told this stores the kit carefully, decommissions the
 * old machine with its key, and discovers the gap at the only moment it cannot
 * be fixed. So it is not a footnote and not a tooltip: it sits next to the
 * download button, in the same weight as the instruction to store the file.
 */
export const DEPLOYMENT_KEY_REQUIREMENT = FR_COPY.security.recoveryKit.deploymentKeyRequirement;

export interface RecoveryKitPanelProps {
  readonly kitId: string;
  readonly delivery: KitDelivery;
  readonly downloadExpiresAt: string;
  readonly busy: boolean;
  readonly onDownload: () => Promise<void>;
  readonly onRegenerate: () => Promise<void>;
  readonly onConfirm: () => Promise<void>;
}

function expiryLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return FR_COPY.security.recoveryKit.soon;
  }
  return formatDateTime(at, { hour: "2-digit", minute: "2-digit" });
}

export function RecoveryKitPanel(props: RecoveryKitPanelProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgeId = useId();
  const consumed = props.delivery === "download-consumed";

  const download = useCallback(() => {
    void props.onDownload();
  }, [props.onDownload]);

  return (
    <section
      className="recovery-kit-panel ui-settings-panel"
      aria-labelledby="recovery-kit-heading"
    >
      <h2 id="recovery-kit-heading">{FR_COPY.security.recoveryKit.title}</h2>
      <p>{FR_COPY.security.recoveryKit.introduction}</p>
      <p className="recovery-kit-panel__deployment-key" data-testid="deployment-key-requirement">
        {/* Beside the download, not below the fold: this is the half of the
            answer that an owner cannot infer from the file they are given. */}
        <strong>{DEPLOYMENT_KEY_REQUIREMENT}</strong>
      </p>

      <dl className="recovery-kit-facts">
        <div>
          <dt>{FR_COPY.security.recoveryKit.kit}</dt>
          <dd data-testid="recovery-kit-id">{props.kitId}</dd>
        </div>
        <div>
          <dt>{FR_COPY.security.recoveryKit.downloadExpires}</dt>
          <dd data-testid="recovery-kit-expiry">{expiryLabel(props.downloadExpiresAt)}</dd>
        </div>
      </dl>

      <div className="recovery-kit-actions">
        <Button
          variant="primary"
          onClick={download}
          busy={props.busy}
          disabled={consumed}
          data-testid="download-recovery-kit"
        >
          {consumed
            ? FR_COPY.security.recoveryKit.downloaded
            : FR_COPY.security.recoveryKit.download}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void props.onRegenerate();
          }}
          busy={props.busy}
          data-testid="regenerate-recovery-kit"
        >
          {FR_COPY.security.recoveryKit.regenerate}
        </Button>
      </div>

      {consumed ? (
        <AsyncState
          compact
          className="recovery-kit-note"
          kind="info"
          title={FR_COPY.security.recoveryKit.consumed}
          testId="download-consumed-note"
        />
      ) : (
        <p className="recovery-kit-note">{FR_COPY.security.recoveryKit.oneDownload}</p>
      )}

      <div className="recovery-kit-confirm">
        <input
          id={acknowledgeId}
          type="checkbox"
          checked={acknowledged}
          disabled={!consumed || props.busy}
          onChange={(event) => setAcknowledged(event.target.checked)}
          data-testid="acknowledge-offline-storage"
        />
        <label htmlFor={acknowledgeId}>{FR_COPY.security.recoveryKit.acknowledge}</label>
      </div>

      <Button
        variant="primary"
        onClick={() => {
          void props.onConfirm();
        }}
        // Three conditions, each independent: the download must have happened,
        // the owner must have said so, and no request may be in flight.
        disabled={!consumed || !acknowledged}
        busy={props.busy}
        data-testid="confirm-offline-storage"
      >
        {FR_COPY.security.recoveryKit.finish}
      </Button>
    </section>
  );
}

/**
 * Hands a kit blob to the browser's download machinery.
 *
 * Exported so the page can call it the moment the blob arrives, without the
 * blob passing through component state on the way.
 */
export function saveKitBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked immediately: an object URL is readable by anything running in the
  // page for as long as it exists.
  URL.revokeObjectURL(url);
}
