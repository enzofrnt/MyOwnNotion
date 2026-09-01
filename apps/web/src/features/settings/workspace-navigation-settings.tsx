import {
  type LocalDatabase,
  readWorkspacePresentationState,
  updateWorkspacePresentationState,
  type WorkspacePresentationState,
} from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import { Switch } from "../../ui/primitives/index.ts";

type VisibleShortcut = "favouritesVisible" | "recentsVisible";

export function WorkspaceNavigationSettings({ db }: { readonly db: LocalDatabase }) {
  const [presentation, setPresentation] = useState<WorkspacePresentationState | null>(null);
  const [saving, setSaving] = useState<VisibleShortcut | null>(null);

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
    setSaving(field);
    void updateWorkspacePresentationState(db, (current) => ({
      ...current,
      [field]: visible,
    })).then((next) => {
      // The checked state is the acknowledgement that IndexedDB now owns the
      // preference. An optimistic flip let navigation resume while the write
      // was still pending, so the workspace could hydrate the previous value
      // and persist it over the owner's choice on slower mobile runs.
      setPresentation(next);
      setSaving((current) => (current === field ? null : current));
    });
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
      <div className="settings-toggle-row">
        <span>
          <strong>Favoris</strong>
          <small>Afficher les pages marquées comme favorites.</small>
        </span>
        <Switch
          aria-label="Afficher les favoris"
          checked={presentation.favouritesVisible}
          disabled={saving === "favouritesVisible"}
          onCheckedChange={(checked) => setVisible("favouritesVisible", checked)}
        />
      </div>
      <div className="settings-toggle-row">
        <span>
          <strong>Récents</strong>
          <small>Afficher les dernières pages modifiées.</small>
        </span>
        <Switch
          aria-label="Afficher les récents"
          checked={presentation.recentsVisible}
          disabled={saving === "recentsVisible"}
          onCheckedChange={(checked) => setVisible("recentsVisible", checked)}
        />
      </div>
    </section>
  );
}
