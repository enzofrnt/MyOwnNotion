import { useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export interface WorkspaceHomeProps {
  /** The workspace already holds at least one page or folder. */
  readonly hasItems: boolean;
  readonly onCreatePage?: () => Promise<void>;
}

/**
 * Landing surface shown when no item is open (`/notes`). It borrows the page
 * canvas geometry — path-like caption, title, reading column — so the owner
 * lands on something that reads as a page of this app instead of a system
 * notice, and it offers the one useful action where the owner is looking.
 */
export function WorkspaceHome({ hasItems, onCreatePage }: WorkspaceHomeProps) {
  const [creating, setCreating] = useState(false);

  const createPage = async (): Promise<void> => {
    if (onCreatePage === undefined || creating) return;
    setCreating(true);
    try {
      await onCreatePage();
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="workspace-home" data-testid="workspace-home">
      <p className="workspace-home__caption">Espace de travail</p>
      <h1 className="workspace-home__title" data-testid="active-item-heading">
        Bienvenue
      </h1>
      <p className="workspace-home__detail">
        {hasItems
          ? "Choisissez une page dans la barre latérale, ou créez-en une nouvelle."
          : "Créez votre première page pour commencer à écrire."}
      </p>
      {onCreatePage === undefined ? null : (
        <div className="workspace-home__actions">
          <Button
            data-testid="home-create-page"
            variant="secondary"
            busy={creating}
            onClick={() => void createPage()}
          >
            <AppIcon name="add" size="small" />
            Nouvelle page
          </Button>
        </div>
      )}
    </section>
  );
}
