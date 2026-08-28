/**
 * Whether this device is hearing about changes made elsewhere (T013, FR-010).
 *
 * Small on purpose, and worded carefully. The one thing an owner must never
 * conclude from this is that their work is at risk: a device with no live
 * connection has saved everything locally and will send it when it can. So the
 * absent state reads "keeping your changes here", not "disconnected" — the
 * failure language would describe a data loss that is not happening.
 *
 * Deliberately separate from `ConnectionStatus`, which answers "is this server
 * reachable and trustworthy". A live stream can drop while the server stays
 * perfectly reachable — a proxy timeout does exactly that — and collapsing the
 * two would make one indicator answer two questions with one word.
 */

import { FR_COPY } from "../../ui/copy/fr.ts";
import { Status } from "../../ui/primitives/status.tsx";
import type { ChangeStreamStatus } from "./use-change-stream.ts";

const LABELS: Record<ChangeStreamStatus["state"], string> = {
  connecting: FR_COPY.synchronization.realtime.connecting,
  live: FR_COPY.synchronization.realtime.live,
  local: FR_COPY.synchronization.realtime.local,
  revoked: FR_COPY.synchronization.realtime.revoked,
  "needs-update": FR_COPY.synchronization.realtime.needsUpdate,
};

const COMPACT_LABELS: Record<ChangeStreamStatus["state"], string> = {
  connecting: FR_COPY.synchronization.realtime.compactConnecting,
  live: FR_COPY.synchronization.realtime.compactLive,
  local: FR_COPY.synchronization.realtime.compactLocal,
  revoked: FR_COPY.synchronization.realtime.compactRevoked,
  "needs-update": FR_COPY.synchronization.realtime.compactNeedsUpdate,
};

/** The two states that will not clear on their own. */
function isRefusal(state: ChangeStreamStatus["state"]): boolean {
  return state === "revoked" || state === "needs-update";
}

export function ConnectionState({ status }: { readonly status: ChangeStreamStatus }) {
  const refused = isRefusal(status.state);
  const detailedLabel = `${LABELS[status.state]}${refused && status.refusal !== null ? ` ${status.refusal}` : ""}`;
  return (
    <Status
      className="workspace-connection-state"
      kind={refused ? "error" : "info"}
      state={status.state}
      data-testid="live-connection-state"
      title={
        <>
          <span className="workspace-status__full">{detailedLabel}</span>
          <span className="workspace-status__compact" aria-hidden="true">
            {COMPACT_LABELS[status.state]}
          </span>
        </>
      }
    />
  );
}
