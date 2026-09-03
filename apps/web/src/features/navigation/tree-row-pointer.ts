/**
 * Pointer contract for a tree row (spec 022 FR-019).
 *
 * A folder toggles expand/collapse on a short click and opens only on
 * double-click. The first click of a double-click is delayed so an already
 * expanded folder is not collapsed before the open gesture runs. Pages, files
 * and databases still open on the first click. The chevron keeps its own
 * immediate toggle.
 *
 * Opening is decided by a second click that still falls inside this delay —
 * not by the engine's `dblclick` event. The OS double-click window is often
 * ~500 ms, longer than the delay, so a click to expand, a pause, then a click
 * to collapse would otherwise still fire `dblclick` and open the folder.
 */
export type TreeRowPointerAction = "toggle" | "open" | "expand-and-open";

/** Wait long enough to tell a second click of a double-click from a real toggle. */
export const FOLDER_SINGLE_CLICK_DELAY_MS = 275;

export function resolveTreeRowPointerAction(
  kind: string,
  gesture: "click" | "dblclick",
  clickCount = 1,
): TreeRowPointerAction | null {
  if (kind === "folder") {
    if (gesture === "dblclick") return "expand-and-open";
    if (clickCount >= 2) return null;
    return "toggle";
  }
  return gesture === "click" ? "open" : null;
}

export function applyTreeRowPointerAction(
  action: TreeRowPointerAction | null,
  handlers: {
    readonly toggle: () => void;
    readonly expand: () => void;
    readonly open: () => void;
  },
): void {
  if (action === "toggle") handlers.toggle();
  if (action === "expand-and-open") handlers.expand();
  if (action === "open" || action === "expand-and-open") handlers.open();
}

export function createFolderClickScheduler(delayMs = FOLDER_SINGLE_CLICK_DELAY_MS): {
  readonly schedule: (run: () => void) => void;
  readonly cancel: () => void;
  readonly claimPending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(run) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
    claimPending() {
      if (timer === null) return false;
      clearTimeout(timer);
      timer = null;
      return true;
    },
  };
}

/**
 * A second click inside the pending window opens. A click after the window
 * has already toggled starts a new toggle, even when the engine still emits
 * `dblclick`.
 */
export function handleFolderRowPointerClick(
  scheduler: {
    readonly schedule: (run: () => void) => void;
    readonly claimPending: () => boolean;
  },
  handlers: {
    readonly toggle: () => void;
    readonly expand: () => void;
    readonly open: () => void;
  },
): void {
  if (scheduler.claimPending()) {
    applyTreeRowPointerAction("expand-and-open", handlers);
    return;
  }
  scheduler.schedule(handlers.toggle);
}
