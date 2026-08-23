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

import type { ChangeStreamStatus } from "./use-change-stream.ts";

const LABELS: Record<ChangeStreamStatus["state"], string> = {
  connecting: "Connecting to live updates…",
  live: "Live — changes from your other devices appear here",
  local: "Keeping your changes on this device until the connection returns",
  // Both of these are situations an owner has to act on, so they say what to do.
  // "Not connected" would be true and useless: nothing they could do with it.
  revoked: "This device's access was withdrawn. It can no longer synchronize.",
  "needs-update": "This device needs an update before it can synchronize again.",
};

const COMPACT_LABELS: Record<ChangeStreamStatus["state"], string> = {
  connecting: "Connecting live updates…",
  live: "Live updates",
  local: "Live updates paused",
  revoked: "Device access revoked",
  "needs-update": "Device update required",
};

/** The two states that will not clear on their own. */
function isRefusal(state: ChangeStreamStatus["state"]): boolean {
  return state === "revoked" || state === "needs-update";
}

export function ConnectionState({ status }: { readonly status: ChangeStreamStatus }) {
  const refused = isRefusal(status.state);
  const detailedLabel = `${LABELS[status.state]}${refused && status.refusal !== null ? ` ${status.refusal}` : ""}`;
  return (
    <p
      className={refused ? "status-banner" : "muted"}
      data-testid="live-connection-state"
      data-state={status.state}
      // `alert` only for the two states that need acting on, and `status`
      // otherwise. A live region that interrupts on every reconnection would
      // announce a routine proxy timeout in the same voice as a withdrawn
      // device, and an owner would learn to ignore both.
      role={refused ? "alert" : "status"}
      title={detailedLabel}
    >
      <span className="workspace-status__full">{detailedLabel}</span>
      <span className="workspace-status__compact" aria-hidden="true">
        {COMPACT_LABELS[status.state]}
      </span>
    </p>
  );
}
