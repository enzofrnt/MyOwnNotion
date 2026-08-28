/**
 * Whether the owner could actually recover (T054, T088, US4, FR-015, FR-016, SC-008).
 *
 * The kit panel next door is part of the setup ceremony: it appears once, hands
 * over a file, and is gone. This one answers a question an owner has *later*,
 * usually years later, and almost always at the worst possible moment: **if
 * this machine died tonight, could I get my notes back?**
 *
 * Two decisions shape it.
 *
 * **It states what is missing, not only what is present.** An installation with
 * no usable kit says so in the first line, in those words. A panel that showed
 * a kit identifier when there was one and nothing at all when there was not
 * would leave the dangerous case looking like a rendering bug.
 *
 * **It repeats the deployment-key requirement every time.** This installation
 * seals the kit under the key file on the host, so the kit alone restores
 * nothing. An owner reads this screen rarely, and forgetting that pairing is
 * exactly how a carefully stored kit turns out to be useless.
 */

import type { RecoveryStatusView } from "../../services/security-api.ts";
import { FR_COPY, formatDate } from "../../ui/copy/index.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

export interface RecoveryReadinessPanelProps {
  readonly status: RecoveryStatusView | null;
  readonly busy: boolean;
  readonly onPrepareReplacement: () => Promise<void>;
}

/**
 * The one sentence an owner reads first.
 *
 * Exported so the wording is testable without a DOM. It is the sentence that
 * decides whether someone acts today or assumes they are covered.
 */
export function describeReadiness(status: RecoveryStatusView | null): {
  readonly ready: boolean;
  readonly message: string;
} {
  if (status === null) {
    // Unknown is not ready. Claiming "no kit" would be a statement the client
    // cannot support, and rendering nothing at all would read as fine.
    return {
      ready: false,
      message: FR_COPY.security.recovery.unknown,
    };
  }
  if (status.active === null) {
    return {
      ready: false,
      message: FR_COPY.security.recovery.missing,
    };
  }
  if (status.pending !== null) {
    return {
      ready: true,
      message: FR_COPY.security.recovery.replacementPending,
    };
  }
  return { ready: true, message: FR_COPY.security.recovery.ready };
}

export function RecoveryReadinessPanel(props: RecoveryReadinessPanelProps) {
  const readiness = describeReadiness(props.status);

  return (
    <section
      className="recovery-readiness-panel ui-settings-panel"
      aria-labelledby="recovery-readiness-heading"
    >
      <h2 id="recovery-readiness-heading">{FR_COPY.security.recovery.title}</h2>

      <AsyncState
        className={`recovery-readiness-panel__state is-${readiness.ready ? "ready" : "not-ready"}`}
        compact
        kind={readiness.ready ? "success" : "error"}
        title={readiness.message}
        testId="recovery-readiness"
      />

      <p className="recovery-readiness-panel__key" data-testid="recovery-key-requirement">
        <strong>{FR_COPY.security.recovery.keyRequirement}</strong>
      </p>

      {props.status?.active !== null && props.status !== null && (
        <dl className="recovery-readiness-panel__facts">
          <div>
            <dt>{FR_COPY.security.recovery.kit}</dt>
            <dd data-testid="recovery-kit-id">{props.status.active?.kitId}</dd>
          </div>
          <div>
            <dt>{FR_COPY.security.recovery.confirmed}</dt>
            <dd data-testid="recovery-confirmed-at">
              {props.status.active?.confirmedAt === null
                ? FR_COPY.security.recovery.notYet
                : formatDate(props.status.active?.confirmedAt ?? "")}
            </dd>
          </div>
        </dl>
      )}

      <Button
        variant="secondary"
        onClick={() => {
          void props.onPrepareReplacement();
        }}
        busy={props.busy}
        data-testid="prepare-recovery-replacement"
      >
        {FR_COPY.security.recovery.generate}
      </Button>

      <p className="recovery-readiness-panel__note">
        {/* Said before they start, not after. An owner who thinks generating a
            kit invalidates the old one immediately will hesitate to do it at
            all — which leaves them on a kit they may have lost. */}
        {FR_COPY.security.recovery.replacementSafety}
      </p>
    </section>
  );
}
