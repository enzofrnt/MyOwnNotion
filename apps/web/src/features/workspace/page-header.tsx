import type { ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";

export interface PageBreadcrumb {
  readonly id: string;
  readonly label: string;
  readonly onOpen?: () => void;
}

export interface PageHeaderProps {
  readonly title?: string;
  readonly breadcrumbs?: readonly PageBreadcrumb[];
  readonly actions?: ReactNode;
  readonly kind?: "page" | "folder" | "file" | "workspace";
}

const KIND_LABELS = {
  page: "Page",
  folder: "Dossier",
  file: "Fichier",
  workspace: "Espace de travail",
} as const;

export function PageHeader({
  actions,
  breadcrumbs = [],
  kind = "workspace",
  title,
}: PageHeaderProps) {
  const compactChrome = kind === "page" || kind === "folder";
  return (
    <header
      className="workspace-page-header"
      data-compact={compactChrome || undefined}
      data-testid="workspace-page-header"
    >
      <div className="workspace-page-header__path-row">
        <nav aria-label="Fil d’Ariane" className="workspace-breadcrumbs">
          <ol>
            <li>
              <span>MyOwnNotion</span>
            </li>
            {breadcrumbs.map((crumb, index) => (
              <li
                key={crumb.id}
                aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
              >
                <AppIcon name="arrowRight" size="small" />
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
