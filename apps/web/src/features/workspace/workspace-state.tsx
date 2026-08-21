import type { ReactNode } from "react";
import { Button, Status } from "../../ui/primitives/index.ts";

export type WorkspaceStateKind = "loading" | "empty" | "offline" | "error";

export interface WorkspaceStateProps {
  readonly kind: WorkspaceStateKind;
  readonly detail?: string;
  readonly diagnostics?: ReactNode;
  readonly onRetry?: () => void;
}

export function WorkspaceState({ diagnostics, detail, kind, onRetry }: WorkspaceStateProps) {
  if (kind === "loading") {
    return (
      <div
        className="workspace-state workspace-state--loading"
        data-testid="workspace-shell-skeleton"
        role="status"
        aria-busy="true"
      >
        <span className="ui-visually-hidden">Chargement de l’espace de travail…</span>
        <span className="workspace-skeleton workspace-skeleton--title" aria-hidden="true" />
        <span className="workspace-skeleton workspace-skeleton--line" aria-hidden="true" />
        <span className="workspace-skeleton workspace-skeleton--line-short" aria-hidden="true" />
      </div>
    );
  }

  const content = {
    empty: {
      title: "Votre espace est prêt",
      detail: detail ?? "Créez une première page pour commencer à écrire.",
    },
    offline: {
      title: "Contenu indisponible hors ligne",
      detail:
        detail ??
        "Ce contenu n’est pas encore présent sur cet appareil. Reconnectez-vous pour le charger.",
    },
    error: {
      title: "L’espace n’a pas pu être chargé",
      detail:
        detail ??
        "Vos données locales sont conservées. Vous pouvez réessayer sans perdre votre travail.",
    },
  }[kind];

  return (
    <div className="workspace-state" data-state={kind} data-testid={`workspace-state-${kind}`}>
      <Status
        kind={kind === "error" ? "error" : kind === "offline" ? "offline" : "info"}
        title={content.title}
      >
        {content.detail}
      </Status>
      {onRetry === undefined ? null : <Button onClick={onRetry}>Réessayer</Button>}
      {diagnostics === undefined ? null : (
        <details className="workspace-state__diagnostics">
          <summary>Détails techniques</summary>
          {diagnostics}
        </details>
      )}
    </div>
  );
}
