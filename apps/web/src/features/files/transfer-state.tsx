/**
 * What a transfer is doing, in words an owner can act on (T051, US1, FR-009).
 *
 * Mirrors the save states of feature 003 deliberately, including the discipline
 * that made them worth having: the interface never claims more than is true.
 * `synchronized` appears only when the server has verified the bytes it stored,
 * never when the last chunk was acknowledged — those are different facts, and
 * only one of them means the file is safe.
 *
 * `verifying` exists for exactly that gap. Without it there would be a moment
 * where every byte has been sent and the honest answer is "not yet", and an
 * interface with no word for that moment fills it with an optimistic one.
 */

import { formatByteLength } from "../hierarchy/file-node.tsx";
import type { TransferState } from "./upload.ts";

/**
 * The sentence each state produces.
 *
 * Exported and tested separately from the component, because what matters is the
 * wording: a state machine that is right and a label that overclaims is still an
 * interface that lies.
 */
export function describeTransfer(state: TransferState): {
  readonly label: string;
  readonly detail: string | null;
} {
  switch (state.kind) {
    case "idle":
      return { label: "Ready", detail: null };
    case "uploading": {
      const percent = state.total === 0 ? 100 : Math.floor((state.sent / state.total) * 100);
      return {
        label: `Sending… ${percent}%`,
        // The byte counts, not only the percentage: on a large file a stalled
        // percentage and a slow one look identical, and the numbers distinguish
        // them.
        detail: `${formatByteLength(state.sent)} of ${formatByteLength(state.total)}`,
      };
    }
    case "verifying":
      return {
        label: "Checking…",
        detail: "Every byte has arrived. The server is confirming it stored them intact.",
      };
    case "synchronized":
      return { label: "Stored", detail: null };
    case "blocked":
      return {
        label: "Not stored",
        detail:
          state.limitBytes === undefined
            ? state.reason
            : `${state.reason} This installation accepts files up to ${formatByteLength(state.limitBytes)}.`,
      };
  }
}

export function TransferStateIndicator({ state }: { readonly state: TransferState }) {
  if (state.kind === "idle") {
    return null;
  }
  const { label, detail } = describeTransfer(state);
  return (
    <p
      className="save-state"
      data-testid="transfer-state"
      data-state={state.kind}
      // Assertive only when something needs a decision. A progress figure that
      // interrupted a screen reader on every chunk is one an owner turns off,
      // after which the refusal goes unheard too.
      role={state.kind === "blocked" ? "alert" : "status"}
      aria-live={state.kind === "blocked" ? "assertive" : "polite"}
    >
      <strong data-testid="transfer-state-label">{label}</strong>
      {detail !== null ? <span data-testid="transfer-state-detail"> — {detail}</span> : null}
    </p>
  );
}
