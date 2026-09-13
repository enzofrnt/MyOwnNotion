import { useState } from "react";
import type { PreparedRecoveryKit } from "../../services/security-api.ts";
import { FR_COPY, formatDateTime } from "../../ui/copy/index.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

export type RecoveryReplacementDelivery = "downloadable" | "download-consumed";

export interface RecoveryReplacementPanelProps {
  readonly kit: Pick<PreparedRecoveryKit, "kitId" | "downloadExpiresAt" | "notice">;
  readonly delivery: RecoveryReplacementDelivery;
  readonly downloadSaved: boolean;
  readonly busy: boolean;
  readonly message?: { readonly kind: "error" | "info" | "success"; readonly text: string };
  readonly onDownload: () => Promise<void>;
  readonly onConfirm: () => Promise<void>;
}

function expiryLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return FR_COPY.security.recoveryKit.soon;
  return formatDateTime(at, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Completes the replacement ceremony without putting the kit bytes in React
 * state. The server consumes the download before returning it; confirmation
 * therefore stays disabled until the response has reached the browser.
 */
export function RecoveryReplacementPanel(props: RecoveryReplacementPanelProps) {
  const acknowledgedId = "recovery-replacement-offline-storage";
  const consumed = props.delivery === "download-consumed";
  const canConfirm = consumed && props.downloadSaved;
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <section
      className="recovery-replacement-panel ui-settings-panel"
      aria-labelledby="recovery-replacement-heading"
      data-testid="recovery-replacement-panel"
    >
      <h2 id="recovery-replacement-heading">{FR_COPY.security.recovery.replacement.title}</h2>
      <p>{FR_COPY.security.recovery.replacement.introduction}</p>
      <p className="recovery-replacement-notice">{props.kit.notice}</p>
      <dl className="recovery-replacement-facts">
        <div>
          <dt>{FR_COPY.security.recoveryKit.kit}</dt>
          <dd data-testid="replacement-recovery-kit-id">{props.kit.kitId}</dd>
        </div>
        <div>
          <dt>{FR_COPY.security.recovery.replacement.expires}</dt>
          <dd data-testid="replacement-recovery-kit-expiry">
            {expiryLabel(props.kit.downloadExpiresAt)}
          </dd>
        </div>
      </dl>

      <div className="recovery-replacement-actions">
        <Button
          variant="primary"
          busy={props.busy}
          disabled={consumed}
          onClick={() => {
            void props.onDownload();
          }}
          data-testid="download-recovery-replacement"
        >
          {consumed
            ? FR_COPY.security.recovery.replacement.downloaded
            : FR_COPY.security.recovery.replacement.download}
        </Button>
      </div>

      {consumed ? (
        <AsyncState
          compact
          kind="info"
          title={FR_COPY.security.recovery.replacement.oneDownload}
          testId="recovery-replacement-downloaded"
        />
      ) : null}

      {props.message === undefined ? null : (
        <AsyncState
          compact
          kind={props.message.kind}
          title={props.message.text}
          testId="recovery-replacement-message"
        />
      )}

      <div className="recovery-replacement-confirm">
        <input
          id={acknowledgedId}
          type="checkbox"
          checked={acknowledged}
          disabled={!canConfirm || props.busy}
          onChange={(event) => setAcknowledged(event.target.checked)}
          data-testid="acknowledge-recovery-replacement"
        />
        <label htmlFor={acknowledgedId}>{FR_COPY.security.recovery.replacement.acknowledge}</label>
      </div>

      <Button
        variant="primary"
        disabled={!canConfirm || !acknowledged || props.busy}
        onClick={() => {
          void props.onConfirm();
        }}
        busy={props.busy}
        data-testid="confirm-recovery-replacement"
      >
        {FR_COPY.security.recovery.replacement.confirm}
      </Button>
    </section>
  );
}
