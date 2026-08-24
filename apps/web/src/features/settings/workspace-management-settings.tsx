import type { ProjectedItem } from "@myownnotion/client-core";
import type { SafeError } from "@myownnotion/domain";
import { useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { Button } from "../../ui/primitives/index.ts";
import { DiagnosticsPanel } from "../diagnostics/diagnostics-panel.tsx";
import { ItemDetails } from "../hierarchy/item-details.tsx";
import { RevisionRestore } from "../history/revision-restore.tsx";
import type { SettingsSection } from "./settings-shell.tsx";

type ManagementSection = Extract<SettingsSection, "local-data" | "trash" | "page-details">;

export interface WorkspaceManagementSettingsProps {
  readonly activeItem: ProjectedItem | null;
  readonly problem: SafeError | null;
  readonly section: ManagementSection;
  readonly service: LocalContentService;
  readonly trashedItems: readonly ProjectedItem[];
}

export function WorkspaceManagementSettings({
  activeItem,
  problem,
  section,
  service,
  trashedItems,
}: WorkspaceManagementSettingsProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (section === "local-data") {
    return <DiagnosticsPanel problem={problem} service={service} />;
  }

  if (section === "trash") {
    const restore = async (item: ProjectedItem): Promise<void> => {
      setRestoringId(item.id);
      setFeedback(null);
      const result = await service.mutate("item.restore", { itemId: item.id }, [
        item.currentRevisionId,
      ]);
      if (!result.ok) {
        setFeedback(`« ${item.name} » n’a pas pu être restauré.`);
        setRestoringId(null);
        return;
      }
      setFeedback(`« ${item.name} » a été restauré.`);
      await service.synchronize();
      setRestoringId(null);
    };

    return (
      <section aria-labelledby="trash-settings-heading" data-testid="trash-settings">
        <h2 id="trash-settings-heading">Éléments supprimés</h2>
        <p className="muted">
          Les éléments restent récupérables pendant leur durée de rétention. Leur contenu n’est pas
          affiché dans le workspace tant qu’ils sont dans la corbeille.
        </p>
        {feedback === null ? null : (
          <p role="status" className="status-banner" data-state="synced">
            {feedback}
          </p>
        )}
        {trashedItems.length === 0 ? (
          <p className="muted" data-testid="trash-empty">
            La corbeille est vide.
          </p>
        ) : (
          <ul className="settings-trash__list">
            {trashedItems.map((item) => (
              <li
                key={item.id}
                className="settings-trash__item"
                data-testid={`trash-item-${item.name}`}
              >
                <span className="settings-trash__identity">
                  <strong>{item.name}</strong>
                  <span>
                    {item.kind === "page" ? "Page" : item.kind === "folder" ? "Dossier" : "Fichier"}
                    {item.purgeAfter === null
                      ? " — durée de récupération inconnue"
                      : ` — récupérable jusqu’au ${new Date(item.purgeAfter).toLocaleString("fr-FR")}`}
                  </span>
                </span>
                <Button
                  size="compact"
                  busy={restoringId === item.id}
                  disabled={restoringId !== null && restoringId !== item.id}
                  onClick={() => void restore(item)}
                >
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (activeItem === null) {
    return (
      <section aria-labelledby="page-settings-heading" data-testid="page-details-settings">
        <h2 id="page-settings-heading">Page actuelle</h2>
        <p className="muted">Ouvrez une page ou un dossier avant de consulter ses détails.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="page-settings-heading" data-testid="page-details-settings">
      <h2 id="page-settings-heading">{activeItem.name}</h2>
      <p className="muted">
        Les identifiants, relations techniques et restaurations restent ici afin de ne pas
        concurrencer le contenu de la page.
      </p>
      <ItemDetails item={activeItem} />
      <RevisionRestore item={activeItem} onRestored={() => void service.synchronize()} />
    </section>
  );
}
