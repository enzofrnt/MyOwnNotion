/**
 * Whether the owner's words are safe (T039, T040, T043, US2, FR-007 to FR-011).
 *
 * The statement a note-taking application lives or dies by. Feature 001 already
 * reconciles correctly; what was missing was telling the owner what it is
 * doing — and telling them without ever claiming more than is true.
 *
 * **`saved` is the absence of pending work.** It is not set when a change is
 * applied locally, not when a request is issued, and not on a timer. The state
 * is derived from the same outbox rows the reconciler acts on, so the statement
 * and the reality cannot disagree (FR-008).
 *
 * **Offline changes the wording, not the state.** The owner's question offline
 * is different — will this survive? — so the answer is phrased for it, while
 * the underlying state stays `unsaved` because the row is `pending` either way.
 *
 * **Blocked says three things** (FR-010): what is refused, that existing
 * content is still readable, and what would resolve it. A refusal an owner
 * cannot act on is barely better than silence.
 */

import type { OutboxMutationRow, SaveState } from "@myownnotion/client-core";
import { deriveSaveState, rowsForItem } from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

/** What each state says, and what it must never say. */
function describe(state: SaveState): { readonly label: string; readonly detail: string | null } {
  switch (state.kind) {
    case "saved":
      return { label: "Saved", detail: null };
    case "sending":
      return { label: "Saving…", detail: null };
    case "unsaved":
      return state.offline
        ? {
            label: "Kept on this device",
            detail: "You are offline. This will be sent when the connection returns.",
          }
        : { label: "Not saved yet", detail: null };
    case "blocked":
      return { label: "Not saved — blocked", detail: `${state.reason} ${state.resolution}` };
  }
}

export function SaveStateIndicator({
  service,
  itemId,
}: {
  readonly service: LocalContentService;
  readonly itemId: string;
}) {
  const [rows, setRows] = useState<OutboxMutationRow[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const refresh = async () => {
      setRows(await service.outbox.all());
    };
    void refresh();
    return service.subscribe(() => {
      void refresh();
    });
  }, [service]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const state = deriveSaveState(rowsForItem(rows, itemId), online);
  const { label, detail } = describe(state);

  return (
    <p
      className="save-state"
      data-testid="save-state"
      data-state={state.kind}
      // Polite rather than assertive: this changes on every keystroke's worth
      // of queued work, and a live region that interrupts constantly is one an
      // owner turns off — after which it announces nothing at all (FR-020).
      role="status"
      aria-live="polite"
    >
      <strong data-testid="save-state-label">{label}</strong>
      {detail !== null ? <span data-testid="save-state-detail"> — {detail}</span> : null}
    </p>
  );
}
