/** Focused workspace navigation: search, shortcuts, hierarchy and settings. */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

/** How many rows a shortcut list shows before it stops being a shortcut. */
const SHORTCUT_LIMIT = 5;

export function favouritesOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .filter((item) => item.favourite)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** UUIDv7 revision identities put the most recently changed item first. */
export function recentsOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .toSorted((left, right) => right.currentRevisionId.localeCompare(left.currentRevisionId))
    .slice(0, SHORTCUT_LIMIT);
}

function itemIcon(item: ProjectedItem): "file" | "fileText" | "folder" {
  if (item.kind === "folder") return "folder";
  if (item.kind === "file") return "file";
  return "fileText";
}

function ShortcutList({
  emptyMessage,
  items,
  onOpen,
  testId,
}: {
  readonly items: readonly ProjectedItem[];
  readonly testId: string;
  readonly emptyMessage: string;
  readonly onOpen: (itemId: ProjectedItem["id"]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="workspace-navigation__empty" data-testid={`${testId}-empty`}>
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul className="workspace-shortcuts" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="workspace-shortcut"
            data-testid={`${testId}-${item.name}`}
            onClick={() => onOpen(item.id)}
          >
            <AppIcon name={itemIcon(item)} size="small" />
            <span>{item.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface SidebarProps {
  readonly items: readonly ProjectedItem[];
  readonly tree: ReactNode;
  readonly creationControls: ReactNode;
  readonly footerStatus?: ReactNode;
  readonly onOpen: (itemId: ProjectedItem["id"]) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenSearch: () => void;
}

export function Sidebar({
  creationControls,
  footerStatus,
  items,
  onOpen,
  onOpenSearch,
  onOpenSettings,
  tree,
}: SidebarProps) {
  const favourites = favouritesOf(items);
  const recents = recentsOf(items);

  return (
    <nav className="workspace-navigation" aria-label="Navigation principale" data-testid="sidebar">
      <header className="workspace-navigation__brand">
        <span className="workspace-navigation__mark" aria-hidden="true">
          M
        </span>
        <h2>MyOwnNotion</h2>
      </header>

      <Button className="workspace-navigation__search" variant="ghost" onClick={onOpenSearch}>
        <AppIcon name="search" />
        <span>Rechercher</span>
        <kbd>⌘ K</kbd>
      </Button>

      <section
        className="workspace-navigation__section"
        aria-labelledby="sidebar-favourites-heading"
      >
        <h3 id="sidebar-favourites-heading">Favoris</h3>
        <ShortcutList
          items={favourites}
          testId="favourites"
          emptyMessage="Aucun favori pour le moment."
          onOpen={onOpen}
        />
      </section>

      <section className="workspace-navigation__section" aria-labelledby="sidebar-recents-heading">
        <h3 id="sidebar-recents-heading">Récents</h3>
        <ShortcutList
          items={recents}
          testId="recents"
          emptyMessage="Aucune modification récente."
          onOpen={onOpen}
        />
      </section>

      <section
        className="workspace-navigation__section workspace-navigation__tree"
        aria-labelledby="sidebar-tree-heading"
      >
        <div className="workspace-navigation__section-heading">
          <h3 id="sidebar-tree-heading">Espace privé</h3>
        </div>
        {creationControls}
        {tree}
      </section>

      <footer className="workspace-navigation__footer">
        {footerStatus}
        <Button variant="ghost" data-testid="open-settings" onClick={onOpenSettings}>
          <AppIcon name="settings" />
          Réglages
        </Button>
      </footer>
    </nav>
  );
}
