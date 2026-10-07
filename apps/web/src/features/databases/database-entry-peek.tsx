import type { ProjectedItem } from "@myownnotion/client-core";
import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, ownedSourceIdFromItemId, type Uuid } from "@myownnotion/domain";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { AsyncState, Button, DrawerContent, DrawerRoot } from "../../ui/primitives/index.ts";
import type { DatabaseEntryOpenRequest } from "./database-entry-open-context.tsx";
import { editEntrySourceDefinition, saveEntryPropertyChanges } from "./edit-entry-properties.ts";
import { type EntryDrafts, EntryPanel } from "./entry-panel.tsx";
import type { RelationOption } from "./value-editor.tsx";

interface PeekProjection {
  readonly item: ProjectedItem;
  readonly entry: DatabaseEntryDto;
  readonly definition: DatabaseDefinition;
  readonly sourceId: Uuid;
  readonly valuesAvailable: boolean;
}

/** Presentation only: writes go to the same entry and document as the full page. */
export function DatabaseEntryPeek({
  request,
  service,
  drafts,
  relationOptions,
  renderHeader,
  renderContent,
  onClose,
  onFullPage,
}: {
  readonly request: DatabaseEntryOpenRequest;
  readonly service: LocalContentService;
  readonly drafts: Map<Uuid, EntryDrafts>;
  readonly relationOptions: readonly RelationOption[];
  readonly renderHeader: (item: ProjectedItem) => ReactNode;
  readonly renderContent: (item: ProjectedItem) => ReactNode;
  readonly onClose: () => void;
  readonly onFullPage: (entryId: Uuid) => void;
}) {
  const [projection, setProjection] = useState<PeekProjection | null>(null);
  const [error, setError] = useState(false);
  const [closing, setClosing] = useState(false);
  const beginClose = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
    else setClosing(true);
  };
  useEffect(() => {
    if (!closing) return;
    // Fallback for a removed animation (theme, host or OS preference changed).
    const timer = setTimeout(onClose, 260);
    return () => clearTimeout(timer);
  }, [closing, onClose]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [item, row] = await Promise.all([
        service.getItem(request.entryId),
        service.getDatabaseEntry(request.entryId),
      ]);
      if (
        item === null ||
        row === null ||
        item.lifecycle !== "active" ||
        (item.kind !== "page" && item.kind !== "folder")
      )
        throw new Error("Entrée indisponible");
      const sourceId = row.sourceId ?? request.sourceId ?? ownedSourceIdFromItemId(row.databaseId);
      const [source, relations] = await Promise.all([
        service.getDatabase(sourceId),
        service.getDatabaseEntryRelationTargets(row.databaseId, request.entryId),
      ]);
      if (source === null) throw new Error("Source indisponible");
      if (generation.current !== current) return;
      setProjection({
        item,
        sourceId,
        definition: source.definition,
        valuesAvailable: row.availability === "present",
        entry: {
          databaseId: row.databaseId,
          entryId: item.id,
          kind: item.kind,
          icon: item.icon ?? null,
          revisionId: item.currentRevisionId,
          lifecycle: item.lifecycle,
          title: item.name,
          document: item.pageDocument,
          values: row.values.values,
          relationTargets: relations,
        } as unknown as DatabaseEntryDto,
      });
      setError(false);
    } catch {
      if (generation.current === current) setError(true);
    }
  }, [request.entryId, request.sourceId, service]);
  useEffect(() => {
    void refresh();
    const unsubscribe = service.subscribeProjection(() => void refresh());
    return () => {
      ++generation.current;
      unsubscribe();
    };
  }, [service, refresh]);
  return (
    <DrawerRoot
      open
      setOpen={(open) => {
        if (!open) beginClose();
      }}
    >
      <DrawerContent
        side="right"
        modal={false}
        backdrop={false}
        hideOnInteractOutside={false}
        className="database-entry-peek"
        data-closing={closing || undefined}
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) onClose();
        }}
        aria-label="Aperçu latéral de l’entrée"
        autoFocusOnHide={false}
        unmountOnHide
      >
        <header className="database-entry-peek__toolbar">
          <Button
            size="compact"
            variant="ghost"
            onClick={beginClose}
            aria-label="Fermer le volet"
            title="Fermer le volet"
          >
            <AppIcon name="peekClose" size="small" />
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={() => onFullPage(request.entryId)}
            title="Ouvrir en pleine page"
            aria-label="Ouvrir en pleine page"
          >
            <AppIcon name="expand" size="small" />
          </Button>
        </header>
        <div className="database-entry-peek__scroll" data-editor-scrollport>
          <article className="database-entry-peek__document">
            {error ? (
              <AsyncState
                kind="unavailable"
                description="Cette entrée ou sa source n’est pas disponible sur cet appareil."
                action={
                  <Button size="compact" onClick={() => void refresh()}>
                    Réessayer
                  </Button>
                }
              />
            ) : projection === null ? (
              <AsyncState kind="loading" description="Chargement de l’entrée…" />
            ) : (
              <EntryPanel
                key={request.entryId}
                entry={projection.entry}
                definition={projection.definition}
                valuesAvailable={projection.valuesAvailable}
                relationOptions={relationOptions}
                {...(drafts.has(request.entryId)
                  ? { initialDrafts: drafts.get(request.entryId) as EntryDrafts }
                  : {})}
                onDraftsChange={(next) => {
                  if (Object.keys(next).length === 0) drafts.delete(request.entryId);
                  else drafts.set(request.entryId, next);
                }}
                renderHeader={() => renderHeader(projection.item)}
                pageContent={renderContent(projection.item)}
                onSaveValues={(values, relations, changes) =>
                  saveEntryPropertyChanges(
                    service,
                    projection.entry.databaseId as Uuid,
                    request.entryId,
                    values,
                    relations,
                    changes,
                  )
                }
                onEditDefinition={(edit, confirmed) =>
                  editEntrySourceDefinition(service, projection.sourceId, edit, confirmed)
                }
                onClose={beginClose}
              />
            )}
          </article>
        </div>
      </DrawerContent>
    </DrawerRoot>
  );
}
