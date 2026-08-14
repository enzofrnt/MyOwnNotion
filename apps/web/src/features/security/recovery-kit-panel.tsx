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
export const DEPLOYMENT_KEY_REQUIREMENT =
  "Back up your deployment key file as well, somewhere separate. This kit is unlocked by that key — on its own it cannot restore anything.";

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
    return "soon";
  }
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function RecoveryKitPanel(props: RecoveryKitPanelProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgeId = useId();
  const consumed = props.delivery === "download-consumed";

  const download = useCallback(() => {
    void props.onDownload();
  }, [props.onDownload]);

  return (
    <section className="recovery-kit-panel" aria-labelledby="recovery-kit-heading">
      <h2 id="recovery-kit-heading">Save your recovery kit</h2>
      <p>
        This is the only copy. It is downloaded once, and it is what gets you back into this
        installation if you lose your passkey. Store it offline — a printout or an encrypted drive,
        not this device's downloads folder.
      </p>
      <p className="recovery-kit-panel__deployment-key" data-testid="deployment-key-requirement">
        {/* Beside the download, not below the fold: this is the half of the
            answer that an owner cannot infer from the file they are given. */}
        <strong>{DEPLOYMENT_KEY_REQUIREMENT}</strong>
      </p>

      <dl className="recovery-kit-facts">
        <div>
          <dt>Kit</dt>
          <dd data-testid="recovery-kit-id">{props.kitId}</dd>
        </div>
        <div>
          <dt>Download closes</dt>
          <dd data-testid="recovery-kit-expiry">{expiryLabel(props.downloadExpiresAt)}</dd>
        </div>
      </dl>

      <div className="recovery-kit-actions">
        <button
          type="button"
          onClick={download}
          disabled={props.busy || consumed}
          data-testid="download-recovery-kit"
        >
          {consumed ? "Downloaded" : "Download recovery kit"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void props.onRegenerate();
          }}
          disabled={props.busy}
          data-testid="regenerate-recovery-kit"
        >
          Generate a new kit
        </button>
      </div>

      {consumed ? (
        <p className="recovery-kit-note" role="status" data-testid="download-consumed-note">
          The download is spent. If the file did not save, generate a new kit — the old one stops
          working the moment a new one is created.
        </p>
      ) : (
        <p className="recovery-kit-note">
          You can download this kit once. Generating a new kit invalidates this one.
        </p>
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
        <label htmlFor={acknowledgeId}>
          I have stored this recovery kit, and a copy of the deployment key, somewhere offline that
          I can reach without this device.
        </label>
      </div>

      <button
        type="button"
        className="primary"
        onClick={() => {
          void props.onConfirm();
        }}
        // Three conditions, each independent: the download must have happened,
        // the owner must have said so, and no request may be in flight.
        disabled={!consumed || !acknowledged || props.busy}
        data-testid="confirm-offline-storage"
      >
        Finish setup
      </button>
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
