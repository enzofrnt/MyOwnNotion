import type { DatabaseEntryOpenRequest } from "./database-entry-open-context.tsx";

/** Finish a peek return without replacing a newer action's focus. */
export function restoreEntryPeekFocus(
  origin: DatabaseEntryOpenRequest | null,
  closingPeek: Element | null,
): void {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active.isConnected &&
    !closingPeek?.contains(active)
  )
    return;
  const trigger = origin?.trigger?.isConnected
    ? origin.trigger
    : origin === null
      ? null
      : document.querySelector<HTMLElement>(
          `.workspace-main [data-entry-trigger="${origin.entryId}"]`,
        );
  trigger?.focus({ preventScroll: true });
}
