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

import { AsyncState, FR_COPY } from "../../ui/index.ts";
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
      return { label: FR_COPY.files.transfer.ready, detail: null };
    case "uploading": {
      const percent = state.total === 0 ? 100 : Math.floor((state.sent / state.total) * 100);
      return {
        label: `${FR_COPY.files.transfer.sending} ${percent}%`,
        // The byte counts, not only the percentage: on a large file a stalled
        // percentage and a slow one look identical, and the numbers distinguish
        // them.
        detail: `${formatByteLength(state.sent)} ${FR_COPY.files.transfer.of} ${formatByteLength(state.total)}`,
      };
    }
    case "verifying":
      return {
        label: FR_COPY.files.transfer.verifying,
        detail: FR_COPY.files.transfer.verifyingDetail,
      };
    case "synchronized":
      return { label: FR_COPY.files.transfer.stored, detail: null };
    case "blocked":
      return {
        label: FR_COPY.files.transfer.blocked,
        detail:
          state.limitBytes === undefined
            ? FR_COPY.files.transfer.blockedDetail
            : `${FR_COPY.files.transfer.blockedDetail} ${FR_COPY.files.transfer.limitDetail} ${formatByteLength(state.limitBytes)}.`,
      };
  }
}

export function TransferStateIndicator({ state }: { readonly state: TransferState }) {
  if (state.kind === "idle") {
    return null;
  }
  const { label, detail } = describeTransfer(state);
  return (
    <AsyncState
      compact
      kind={
        state.kind === "blocked" ? "error" : state.kind === "synchronized" ? "success" : "syncing"
      }
      title={<span data-testid="transfer-state-label">{label}</span>}
      description={
        detail === null ? undefined : <span data-testid="transfer-state-detail">{detail}</span>
      }
      testId="transfer-state"
    />
  );
}
