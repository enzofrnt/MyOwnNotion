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
      message: "Recovery status could not be loaded, so this screen cannot tell you either way.",
    };
  }
  if (status.active === null) {
    return {
      ready: false,
      message:
        "You have no recovery kit. If you lose your passkey and this machine, there is no way back into this workspace.",
    };
  }
  if (status.pending !== null) {
    return {
      ready: true,
      message:
        "You have a usable recovery kit, and a replacement is part-way through. The old kit keeps working until you confirm the new one.",
    };
  }
  return { ready: true, message: "You have a recovery kit." };
}

export function RecoveryReadinessPanel(props: RecoveryReadinessPanelProps) {
  const readiness = describeReadiness(props.status);

  return (
    <section className="recovery-readiness-panel" aria-labelledby="recovery-readiness-heading">
      <h2 id="recovery-readiness-heading">Getting back in</h2>

      <p
        className={`recovery-readiness-panel__state is-${readiness.ready ? "ready" : "not-ready"}`}
        // Announced rather than only coloured: "you have no way back in" is
        // not a detail to discover by noticing a shade of red.
        role="status"
        data-testid="recovery-readiness"
      >
        {readiness.message}
      </p>

      <p className="recovery-readiness-panel__key" data-testid="recovery-key-requirement">
        <strong>
          Your recovery kit is unlocked by this installation's deployment key file. Keep a backup of
          that key somewhere separate — the kit on its own cannot restore anything.
        </strong>
      </p>

      {props.status?.active !== null && props.status !== null && (
        <dl className="recovery-readiness-panel__facts">
          <div>
            <dt>Kit</dt>
            <dd data-testid="recovery-kit-id">{props.status.active?.kitId}</dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd data-testid="recovery-confirmed-at">
              {props.status.active?.confirmedAt === null
                ? "not yet"
                : new Date(props.status.active?.confirmedAt ?? "").toLocaleDateString()}
            </dd>
          </div>
        </dl>
      )}

      <button
        type="button"
        onClick={() => {
          void props.onPrepareReplacement();
        }}
        disabled={props.busy}
        data-testid="prepare-recovery-replacement"
      >
        Generate a new recovery kit
      </button>

      <p className="recovery-readiness-panel__note">
        {/* Said before they start, not after. An owner who thinks generating a
            kit invalidates the old one immediately will hesitate to do it at
            all — which leaves them on a kit they may have lost. */}
        Your current kit keeps working until you download the new one and confirm you have stored
        it.
      </p>
    </section>
  );
}
