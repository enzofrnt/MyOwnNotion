/**
 * Canvas routing for a selected page.
 *
 * Opening a note used to wait on encrypted database/entry reads before the
 * editor could mount. Ordinary pages are the common case: show the editor
 * immediately, and only hold the skeleton when this identity is already known
 * to be a database or an entry that has not finished hydrating.
 */

export const MAX_WARMED_PAGE_SESSIONS = 8;

export type StructuredHostKind = "page" | "database" | "entry";

export function holdsStructuredCanvas(input: {
  readonly selectedItemId: string;
  readonly cachedKind: StructuredHostKind | undefined;
  readonly selectedDatabaseId: string | null;
  readonly selectedEntryId: string | null;
}): boolean {
  if (input.cachedKind === "database") {
    return input.selectedDatabaseId !== input.selectedItemId;
  }
  if (input.cachedKind === "entry") {
    return input.selectedEntryId !== input.selectedItemId;
  }
  return false;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Pages whose editing sessions stay mounted after the owner leaves them.
 *
 * Returning to a tab must not reconstruct the CRDT and BlockNote tree. Only
 * identities still open as tabs (or the current destination) are retained.
 */
export function nextWarmedPageIds(
  current: readonly string[],
  selectedPageId: string | null,
  retainIds: ReadonlySet<string>,
  selectedKind: StructuredHostKind | undefined,
): readonly string[] {
  const retained = current.filter((id) => retainIds.has(id));
  const skipSelected =
    selectedPageId === null || selectedKind === "database" || selectedKind === "entry";
  const next = skipSelected
    ? retained
    : [...retained.filter((id) => id !== selectedPageId), selectedPageId];
  const bounded =
    next.length > MAX_WARMED_PAGE_SESSIONS
      ? next.slice(next.length - MAX_WARMED_PAGE_SESSIONS)
      : next;
  return sameIds(current, bounded) ? current : bounded;
}

export function visibleWarmedPageIds(
  warmed: readonly string[],
  selectedPageId: string | null,
  selectedKind: StructuredHostKind | undefined,
): readonly string[] {
  if (selectedPageId === null || selectedKind === "database" || selectedKind === "entry") {
    return warmed.filter((id) => id !== selectedPageId);
  }
  return warmed.includes(selectedPageId) ? warmed : [...warmed, selectedPageId];
}
