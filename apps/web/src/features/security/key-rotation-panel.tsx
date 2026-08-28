/**
 * The owner's view of key rotation (T088, US5, FR-025 – FR-027, SC-008).
 *
 * Rotation is administrative work, and most of it happens on the host where
 * the owner of a self-hosted installation is also the operator. What this
 * panel exists for is the part they cannot see from a terminal: **whether
 * anything is wrong, and what happens if they ignore it.**
 *
 * Three decisions shape it, and each is a place where the obvious presentation
 * misleads.
 *
 * **A due date is not the deadline that matters.** What an owner needs is how
 * long until writing stops, because that is the day the workspace becomes
 * read-only. So the countdown is to the write block, and the due date is
 * secondary.
 *
 * **A blocked installation must say that reading still works.** This is the
 * difference between "I have lost my notes" and "I cannot add to my notes
 * until I do something". An owner who believes the first will panic; the
 * second is an inconvenience with a fix. Everything about the blocked state is
 * phrased around that distinction.
 *
 * **A rotation in progress reports its size, not just a spinner.** These
 * operations take minutes to hours. A progress bar with no numbers is
 * indistinguishable from a hang, and an owner who concludes it has hung will
 * restart the container mid-sweep.
 */

import type { RotationPolicyViewDto } from "@myownnotion/contracts";
import { FR_COPY, formatNumber } from "../../ui/copy/index.ts";
import { AsyncState } from "../../ui/primitives/index.ts";

export interface RunningRotationView {
  readonly operationId: string;
  readonly kind: "wrapping-key" | "data-key";
  readonly phase: string;
  readonly processedCount: number;
  readonly totalCount: number;
}

export interface KeyRotationPanelProps {
  readonly policies: readonly RotationPolicyViewDto[];
  readonly running: readonly RunningRotationView[];
  readonly writesAllowed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What each key protects, in the owner's terms rather than the schema's.
 *
 * "Wrapping key" and "data key" are the right words inside the code and the
 * wrong ones on a settings screen: they describe the mechanism, and an owner
 * needs to know the consequence. The two rotations differ in cost by orders of
 * magnitude, and that difference is what a person deciding when to run one
 * actually needs.
 */
export function describeKind(kind: RotationPolicyViewDto["kind"]): string {
  return kind === "wrapping-key"
    ? FR_COPY.security.rotation.installationKeyDescription
    : FR_COPY.security.rotation.noteKeyDescription;
}

/**
 * Whole days until writing stops. Negative once it already has.
 *
 * Rounded down, deliberately. "1 day left" that is really eleven hours is a
 * promise the installation cannot keep, and an owner who plans around it finds
 * a read-only workspace on the morning they meant to act.
 */
export function daysUntilWriteBlock(writeBlockAt: string, now: Date): number | null {
  const at = new Date(writeBlockAt);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return Math.floor((at.getTime() - now.getTime()) / DAY_MS);
}

/**
 * The one sentence an owner reads first.
 *
 * Every branch that describes a problem also says what still works, because a
 * warning that only names the failure invites the worst reading of it. The
 * blocked case in particular: an owner who believes their notes are gone
 * behaves very differently from one who knows they can still read them.
 */
export function describeStatus(
  policy: RotationPolicyViewDto,
  now: Date,
): { readonly tone: "ok" | "warning" | "urgent"; readonly message: string } {
  const days = daysUntilWriteBlock(policy.writeBlockAt, now);

  switch (policy.state) {
    case "in-progress":
      return { tone: "ok", message: FR_COPY.security.rotation.status.inProgress };
    case "failed":
      return {
        tone: "urgent",
        message: FR_COPY.security.rotation.status.failed,
      };
    case "write-block":
      return {
        tone: "urgent",
        // The distinction this whole panel turns on.
        message: FR_COPY.security.rotation.status.writeBlock,
      };
    case "emergency":
      return {
        tone: "urgent",
        message: FR_COPY.security.rotation.status.emergency,
      };
    case "overdue-within-grace":
      return {
        tone: "warning",
        message:
          days === null
            ? FR_COPY.security.rotation.status.overdueUnknown
            : `${FR_COPY.security.rotation.status.overdue} ${days} ${
                days === 1
                  ? FR_COPY.security.rotation.status.day
                  : FR_COPY.security.rotation.status.days
              } si elle n’est pas renouvelée.`,
      };
    case "due":
      return { tone: "warning", message: FR_COPY.security.rotation.status.due };
    case "complete":
      return { tone: "ok", message: FR_COPY.security.rotation.status.complete };
    default:
      return { tone: "ok", message: FR_COPY.security.rotation.status.current };
  }
}

/**
 * Progress as a sentence, never a bare percentage.
 *
 * "62%" on an operation that will take another hour tells an owner nothing
 * they can act on; "4,812 of 7,700 notes" tells them it is moving. On a
 * rotation that has not counted anything yet, this says so rather than
 * showing a confident zero.
 */
export function describeProgress(running: RunningRotationView): string {
  if (running.totalCount <= 0) {
    return FR_COPY.security.rotation.progressStarting;
  }
  const unit =
    running.kind === "data-key"
      ? FR_COPY.security.rotation.notes
      : FR_COPY.security.rotation.workspaces;
  return `${formatNumber(running.processedCount)} ${FR_COPY.security.rotation.progressOf} ${formatNumber(
    running.totalCount,
  )} ${unit}.`;
}

function describeNextAction(action: string): string {
  switch (action) {
    case "schedule-rotation":
      return FR_COPY.security.rotation.actions.schedule;
    case "start-rotation":
      return FR_COPY.security.rotation.actions.start;
    case "start-rotation-urgently":
      return FR_COPY.security.rotation.actions.urgent;
    case "resume-rotation":
      return FR_COPY.security.rotation.actions.resume;
    case "retry-rotation":
      return FR_COPY.security.rotation.actions.retry;
    default:
      return FR_COPY.security.rotation.actions.none;
  }
}

export function KeyRotationPanel(props: KeyRotationPanelProps) {
  const now = new Date();

  return (
    <section
      className="key-rotation-panel ui-settings-panel"
      aria-labelledby="key-rotation-heading"
    >
      <h2 id="key-rotation-heading">{FR_COPY.security.rotation.title}</h2>

      {!props.writesAllowed && (
        <AsyncState
          compact
          className="key-rotation-panel__blocked"
          kind="conflict"
          title={FR_COPY.security.rotation.writesPaused}
        />
      )}

      <ul className="key-rotation-panel__policies">
        {props.policies.map((policy) => {
          const status = describeStatus(policy, now);
          const active = props.running.find((operation) => operation.kind === policy.kind);
          return (
            <li key={policy.kind} className={`key-rotation-panel__policy is-${status.tone}`}>
              <h3>
                {policy.kind === "wrapping-key"
                  ? FR_COPY.security.rotation.installationKey
                  : FR_COPY.security.rotation.noteKey}
              </h3>
              <p className="key-rotation-panel__what">{describeKind(policy.kind)}</p>
              <p className="key-rotation-panel__status">{status.message}</p>
              {active !== undefined && (
                <p className="key-rotation-panel__progress" role="status">
                  {describeProgress(active)}
                </p>
              )}
              <p className="key-rotation-panel__next">
                {FR_COPY.security.rotation.nextStep} : {describeNextAction(policy.nextAction)}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="key-rotation-panel__where">
        {FR_COPY.security.rotation.hostInstructions} <code>security rotation</code>.{" "}
        {FR_COPY.security.rotation.hostReason}
      </p>
    </section>
  );
}
