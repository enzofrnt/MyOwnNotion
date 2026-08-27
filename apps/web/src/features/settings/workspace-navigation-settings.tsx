import {
  type LocalDatabase,
  readWorkspacePresentationState,
  updateWorkspacePresentationState,
  type WorkspacePresentationState,
} from "@myownnotion/client-core";
import { useEffect, useState } from "react";

type VisibleShortcut = "favouritesVisible" | "recentsVisible";

export function WorkspaceNavigationSettings({ db }: { readonly db: LocalDatabase }) {
  const [presentation, setPresentation] = useState<WorkspacePresentationState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readWorkspacePresentationState(db).then((state) => {
      if (!cancelled) setPresentation(state);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setVisible = (field: VisibleShortcut, visible: boolean): void => {
    setPresentation((current) => (current === null ? current : { ...current, [field]: visible }));
    void updateWorkspacePresentationState(db, (current) => ({
      ...current,
      [field]: visible,
    })).then(setPresentation);
  };

  if (presentation === null) {
    return <p className="muted">Chargement des préférences…</p>;
  }

  return (
    <section className="settings-navigation-preferences" data-testid="navigation-settings">
      <h2>Barre latérale</h2>
      <p className="muted">
        Ces choix concernent uniquement cet appareil. Vos notes et leur synchronisation ne sont pas
        modifiées.
      </p>
      <label className="settings-toggle-row">
        <span>
          <strong>Favoris</strong>
          <small>Afficher les pages marquées comme favorites.</small>
        </span>
        <input
          type="checkbox"
          checked={presentation.favouritesVisible}
          onChange={(event) => setVisible("favouritesVisible", event.currentTarget.checked)}
        />
      </label>
      <label className="settings-toggle-row">
        <span>
          <strong>Récents</strong>
          <small>Afficher les dernières pages modifiées.</small>
        </span>
        <input
          type="checkbox"
          checked={presentation.recentsVisible}
          onChange={(event) => setVisible("recentsVisible", event.currentTarget.checked)}
        />
      </label>
    </section>
  );
}
