/** Focused workspace navigation: search, hierarchy and settings. */

import type { ProjectedItem } from "@myownnotion/client-core";
import type { ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button, OverlayScrollArea } from "../../ui/primitives/index.ts";
import { SidebarCollapseButton } from "./sidebar-collapse.tsx";

/** How many rows a shortcut list shows before it stops being a shortcut. */
const SHORTCUT_LIMIT = 5;

/** Kept for later reuse — Favoris is not rendered in the sidebar today. */
export function favouritesOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .filter((item) => item.favourite)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Kept for later reuse — Récents is not rendered in the sidebar today. */
export function recentsOf(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items
    .toSorted((left, right) => right.currentRevisionId.localeCompare(left.currentRevisionId))
    .slice(0, SHORTCUT_LIMIT);
}

export interface SidebarProps {
  readonly items: readonly ProjectedItem[];
  readonly tree: ReactNode;
  readonly creationControls: ReactNode;
  /** Reserved: workspace sync chrome used to live here; keep the prop for call sites. */
  readonly footerStatus?: ReactNode;
  readonly shortcutPreferences: SidebarShortcutPreferences;
  readonly onShortcutExpandedChange: (section: "favourites" | "recents", expanded: boolean) => void;
  readonly onOpen: (itemId: ProjectedItem["id"]) => void;
  readonly onOpenGraph: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenSearch: () => void;
}

export interface SidebarShortcutPreferences {
  readonly favouritesVisible: boolean;
  readonly favouritesExpanded: boolean;
  readonly recentsVisible: boolean;
  readonly recentsExpanded: boolean;
}

export function Sidebar({
  creationControls,
  onOpenGraph,
  onOpenSearch,
  onOpenSettings,
  tree,
}: SidebarProps) {
  return (
    <nav className="workspace-navigation" aria-label="Navigation principale" data-testid="sidebar">
      <OverlayScrollArea className="workspace-navigation__body">
        <div className="workspace-navigation__search-row">
          <Button className="workspace-navigation__search" variant="ghost" onClick={onOpenSearch}>
            <AppIcon name="search" />
            <span>Rechercher</span>
            <kbd>⌘ K</kbd>
          </Button>
          <SidebarCollapseButton />
        </div>

        <Button
          className="workspace-navigation__graph"
          variant="ghost"
          data-testid="open-knowledge-graph"
          onClick={onOpenGraph}
        >
          <AppIcon name="graph" />
          <span>Graphe</span>
        </Button>

        <section className="workspace-navigation__section workspace-navigation__tree">
          <div className="workspace-navigation__section-heading">
            <h3 id="sidebar-tree-heading">Notes</h3>
            {creationControls}
          </div>
          {tree}
        </section>
      </OverlayScrollArea>

      <footer className="workspace-navigation__footer">
        <Button variant="ghost" data-testid="open-settings" onClick={onOpenSettings}>
          <AppIcon name="settings" />
          Réglages
        </Button>
      </footer>
    </nav>
  );
}
