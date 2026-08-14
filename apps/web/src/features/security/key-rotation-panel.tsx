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
    ? "The key that protects this installation's keys. Rotating it is quick and does not touch your notes."
    : "The key that protects your notes. Rotating it rewrites every one of them, which takes a while.";
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
      return { tone: "ok", message: "A rotation is running. Your notes stay readable throughout." };
    case "failed":
      return {
        tone: "urgent",
        message:
          "The last rotation did not finish. Nothing was lost and your notes are readable — it needs to be run again.",
      };
    case "write-block":
      return {
        tone: "urgent",
        // The distinction this whole panel turns on.
        message:
          "This key is overdue, so new changes are paused. You can still read everything; rotating the key restores saving.",
      };
    case "emergency":
      return {
        tone: "urgent",
        message: "This key was marked urgent. Rotate it now — saving stops as soon as it is due.",
      };
    case "overdue-within-grace":
      return {
        tone: "warning",
        message:
          days === null
            ? "This key is overdue. Saving will pause soon unless it is rotated."
            : `This key is overdue. Saving pauses in ${days} ${days === 1 ? "day" : "days"} unless it is rotated.`,
      };
    case "due":
      return { tone: "warning", message: "This key is due to be rotated." };
    case "complete":
      return { tone: "ok", message: "Rotated. Nothing to do." };
    default:
      return { tone: "ok", message: "Up to date." };
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
    return "Starting.";
  }
  const unit = running.kind === "data-key" ? "notes" : "workspaces";
  return `${running.processedCount.toLocaleString()} of ${running.totalCount.toLocaleString()} ${unit}.`;
}

export function KeyRotationPanel(props: KeyRotationPanelProps) {
  const now = new Date();

  return (
    <section className="key-rotation-panel" aria-labelledby="key-rotation-heading">
      <h2 id="key-rotation-heading">Encryption keys</h2>

      {!props.writesAllowed && (
        // Announced rather than merely styled: an owner using a screen reader
        // must learn that saving has paused at the moment they arrive, not by
        // discovering it when an edit fails.
        <p className="key-rotation-panel__blocked" role="status">
          New changes are paused until a key is rotated. Everything you have written is still here
          and still readable.
        </p>
      )}

      <ul className="key-rotation-panel__policies">
        {props.policies.map((policy) => {
          const status = describeStatus(policy, now);
          const active = props.running.find((operation) => operation.kind === policy.kind);
          return (
            <li key={policy.kind} className={`key-rotation-panel__policy is-${status.tone}`}>
              <h3>{policy.kind === "wrapping-key" ? "Installation key" : "Note key"}</h3>
              <p className="key-rotation-panel__what">{describeKind(policy.kind)}</p>
              <p className="key-rotation-panel__status">{status.message}</p>
              {active !== undefined && (
                <p className="key-rotation-panel__progress" role="status">
                  {describeProgress(active)}
                </p>
              )}
              <p className="key-rotation-panel__next">
                {/* The server's own words for what to do next. Rewriting them
                    here would let the screen and the command line disagree. */}
                Next step: {policy.nextAction}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="key-rotation-panel__where">
        Rotating a key is done on the machine that hosts this installation, with{" "}
        <code>security rotation</code>. It is not available from this screen, because it needs the
        key file that only the host can read.
      </p>
    </section>
  );
}
