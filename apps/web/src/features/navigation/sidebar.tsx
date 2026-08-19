/**
 * Favourites, recents, and the way to settings (T053, US3, FR-012).
 *
 * Three shortcuts that answer three different questions, which is why they are
 * three lists rather than one ranked one: *what did I mark as important*, *what
 * was touched lately*, and *where do I change how this works*.
 *
 * **Favourites are server-backed** because the spec makes them
 * per-installation. The alternative — keeping them beside the expanded
 * branches in the local projection — would mean a page starred on the laptop is
 * not starred on the phone, and for a single-owner product that is a bug the
 * owner would report rather than a design.
 *
 * **Recents means recently changed, not recently opened.** Opening a page is
 * not a mutation, so a per-installation "recently opened" would need the client
 * to write to the server every time the owner looked at something. What is
 * already known everywhere is when an item last changed, and the revision
 * identifier carries it: revision ids are UUIDv7, so their ordering *is* time
 * ordering. The list is honest about which of the two it shows.
 */

import type { ProjectedItem } from "@myownnotion/client-core";

/** How many rows a shortcut list shows before it stops being a shortcut. */
const SHORTCUT_LIMIT = 5;

export function favouritesOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .filter((item) => item.favourite)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * The most recently changed items, newest first.
 *
 * Sorted on `currentRevisionId` rather than on a timestamp the row does not
 * carry. UUIDv7 puts a millisecond timestamp in its leading bits, so a plain
 * lexicographic comparison of two revision ids orders them by when they were
 * created — no clock reading, and no field to keep in step.
 */
export function recentsOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .toSorted((left, right) => right.currentRevisionId.localeCompare(left.currentRevisionId))
    .slice(0, SHORTCUT_LIMIT);
}

function ShortcutList({
  items,
  testId,
  emptyMessage,
  onOpen,
}: {
  readonly items: readonly ProjectedItem[];
  readonly testId: string;
  readonly emptyMessage: string;
  readonly onOpen: (itemId: ProjectedItem["id"]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="empty-state" data-testid={`${testId}-empty`}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul className="tree" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id} className="tree-row">
          <span className="tree-kind">{item.kind}</span>
          <button
            type="button"
            className="link tree-name"
            data-testid={`${testId}-${item.name}`}
            onClick={() => onOpen(item.id)}
          >
            {item.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({
  items,
  onOpen,
  onOpenSettings,
  onOpenSearch,
}: {
  readonly items: readonly ProjectedItem[];
  readonly onOpen: (itemId: ProjectedItem["id"]) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenSearch: () => void;
}) {
  const favourites = favouritesOf(items);
  const recents = recentsOf(items);

  return (
    <nav className="sidebar" aria-label="Workspace shortcuts" data-testid="sidebar">
      <button type="button" className="search-trigger" onClick={onOpenSearch}>
        Search <kbd>Ctrl/⌘ K</kbd>
      </button>

      <section aria-labelledby="sidebar-favourites-heading">
        <h2 id="sidebar-favourites-heading">Favourites</h2>
        <ShortcutList
          items={favourites}
          testId="favourites"
          emptyMessage="Nothing is marked as a favourite yet."
          onOpen={onOpen}
        />
      </section>

      <section aria-labelledby="sidebar-recents-heading">
        <h2 id="sidebar-recents-heading">Recent</h2>
        <p className="muted">Most recently changed, on any device.</p>
        <ShortcutList
          items={recents}
          testId="recents"
          emptyMessage="Nothing has been changed yet."
          onOpen={onOpen}
        />
      </section>

      <button type="button" className="link" data-testid="open-settings" onClick={onOpenSettings}>
        Settings
      </button>
    </nav>
  );
}
