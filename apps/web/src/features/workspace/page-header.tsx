import type { ReactNode } from "react";
import { FR_COPY } from "../../ui/copy/index.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

/** Portal target for the active page editor’s undo/redo toolbar. */
export const WORKSPACE_HISTORY_SLOT_ID = "workspace-history-slot";

/**
 * Holds the undo/redo place on surfaces without a local history (databases,
 * folders, graph), so the controls never jump when the owner switches tabs.
 * CSS hides it as soon as an editor portals its live toolbar into the slot.
 */
function HistoryPlaceholder() {
  return (
    <div
      className="editor-history-controls"
      data-placeholder="true"
      role="toolbar"
      aria-label={FR_COPY.editor.surface.historyLabel}
    >
      <Button
        type="button"
        size="square"
        variant="ghost"
        aria-label={FR_COPY.editor.surface.undo}
        title={FR_COPY.editor.surface.undoTitle}
        disabled
      >
        <AppIcon name="undo" />
      </Button>
      <Button
        type="button"
        size="square"
        variant="ghost"
        aria-label={FR_COPY.editor.surface.redo}
        title={FR_COPY.editor.surface.redoTitle}
        disabled
      >
        <AppIcon name="redo" />
      </Button>
    </div>
  );
}

export interface PageBreadcrumb {
  readonly id: string;
  readonly label: string;
  readonly onOpen?: () => void;
}

export interface PageHeaderProps {
  readonly title?: string;
  /**
   * Context path for non-page surfaces (graph, welcome). A page or folder
   * renders its own path above its emoji instead (spec 022, FR-001).
   */
  readonly breadcrumbs?: readonly PageBreadcrumb[];
  /** Open tabs strip; shown on every surface so tabs stay reachable. */
  readonly tabs?: ReactNode;
  readonly actions?: ReactNode;
  readonly kind?:
    | "page"
    | "folder"
    | "file"
    | "database"
    | "database_view"
    | "workspace"
    | "home"
    | "graph";
}

const KIND_LABELS = {
  page: "Page",
  folder: "Dossier",
  file: "Fichier",
  database: "Base de données",
  database_view: "Vue de base de données",
  workspace: "Espace de travail",
  home: "Espace de travail",
  graph: "Graphe",
} as const;

export function PageHeader({
  actions,
  breadcrumbs = [],
  kind = "workspace",
  tabs,
  title,
}: PageHeaderProps) {
  const compactChrome =
    kind === "page" ||
    kind === "folder" ||
    kind === "database" ||
    kind === "database_view" ||
    kind === "graph" ||
    kind === "home";
  // The landing has no editor and no document identity: its caption lives in the
  // canvas, so disabled undo/redo would be chrome without a job.
  const showsHistory = compactChrome && kind !== "home";
  return (
    <header
      className="workspace-page-header"
      data-compact={compactChrome || undefined}
      data-testid="workspace-page-header"
    >
      <div className="workspace-page-header__path-row">
        {showsHistory ? (
          <div
            id={WORKSPACE_HISTORY_SLOT_ID}
            className="workspace-page-header__history"
            data-testid="workspace-history-slot"
          >
            {kind === "page" ? null : <HistoryPlaceholder />}
          </div>
        ) : null}
        {tabs === undefined ? null : <div className="workspace-page-header__tabs">{tabs}</div>}
        {compactChrome || breadcrumbs.length === 0 ? null : (
          <nav aria-label="Fil d’Ariane" className="workspace-breadcrumbs">
            <ol>
              {breadcrumbs.map((crumb, index) => (
                <li
                  key={crumb.id}
                  aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                >
                  {index === 0 ? null : <AppIcon name="arrowRight" size="small" />}
                  {crumb.onOpen === undefined || index === breadcrumbs.length - 1 ? (
                    <span>{crumb.label}</span>
                  ) : (
                    <button
                      type="button"
                      className="workspace-breadcrumbs__link"
                      onClick={crumb.onOpen}
                    >
                      {crumb.label}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {compactChrome && kind !== "home" && actions !== undefined ? (
          <div className="workspace-page-header__actions" data-testid="page-context-actions">
            {actions}
          </div>
        ) : null}
      </div>
      {compactChrome ? null : (
        <div className="workspace-page-header__title-row">
          <div className="workspace-page-header__identity">
            <span className="workspace-page-header__kind">{KIND_LABELS[kind]}</span>
            <h1 data-testid="active-item-heading">{title ?? "Bienvenue"}</h1>
          </div>
          {actions === undefined ? null : (
            <div className="workspace-page-header__actions" data-testid="page-context-actions">
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
