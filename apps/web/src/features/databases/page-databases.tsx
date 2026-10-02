import type { LocalDatabaseRow } from "@myownnotion/client-core";
import type {
  DatabaseDto,
  DatabaseEntryDto,
  ReplaceDefinitionRequestDto,
} from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabaseEmbedding,
  databaseDefinitionForEmbedding,
  databaseEmbeddings,
  generateUuidV7,
  jsonValuesEqual,
  replaceDatabaseEmbeddingDefinition,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseViewService } from "../../services/databases.ts";
import type { LocalContentService } from "../../services/local-content.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";
import { DatabasePage, type DefinitionConfirmation } from "./database-page.tsx";
import type { DatabaseCellUpdate } from "./table-view.tsx";
import { updateDatabaseCell } from "./update-database-cell.ts";
import type { RelationOption } from "./value-editor.tsx";

interface Source {
  readonly row: LocalDatabaseRow;
  readonly database: DatabaseDto;
  readonly entries: readonly DatabaseEntryDto[];
}

async function readSource(
  service: LocalContentService,
  row: LocalDatabaseRow,
  includeEntries: boolean,
): Promise<Source | null> {
  const anchor =
    row.definitionRevisionId === undefined || row.definition.name === undefined
      ? await service.getItem(row.itemId)
      : null;
  const revision = row.definitionRevisionId ?? anchor?.currentRevisionId;
  if (revision === undefined) return null;
  const entries: DatabaseEntryDto[] = [];
  const memberships = includeEntries ? await service.listDatabaseEntries(row.itemId) : [];
  const ids = memberships.map((entry) => entry.entryItemId);
  const [items, relations] = await Promise.all([
    service.getItems(ids),
    service.getDatabaseEntryRelations(row.itemId, ids),
  ]);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const membership of memberships) {
    const item = byId.get(membership.entryItemId) ?? null;
    if (item === null || item.lifecycle !== "active") continue;
    entries.push({
      databaseId: row.itemId,
      entryId: item.id,
      revisionId: item.currentRevisionId,
      lifecycle: item.lifecycle,
      title: item.name,
      document: item.pageDocument,
      values: membership.values.values,
      relationTargets: relations.get(item.id) ?? {},
    } as unknown as DatabaseEntryDto);
  }
  return {
    row,
    database: {
      databaseId: row.itemId,
      definitionRevisionId: revision,
      lifecycle: "active",
      name: row.definition.name ?? anchor?.name ?? "Base sans nom",
      definition: row.definition,
    } as unknown as DatabaseDto,
    entries,
  };
}

async function replaceSource(
  service: LocalContentService,
  source: Source,
  definition: DatabaseDefinition,
  confirmation?: DefinitionConfirmation,
): Promise<void> {
  const current = await service.getDatabase(source.row.itemId);
  if (current === null || !jsonValuesEqual(current.definition, source.row.definition)) {
    throw new Error("La base a changé. Réessayez depuis sa version actuelle.");
  }
  const result = await service.replaceDatabaseDefinition(source.row.itemId, {
    baseRevisionId: current.definitionRevisionId ?? source.database.definitionRevisionId,
    definition,
    ...(confirmation === undefined ? {} : { impactConfirmation: confirmation }),
  } as unknown as ReplaceDefinitionRequestDto);
  if (!result.ok) throw new Error(result.error.title);
}

function EmbeddedDatabase({
  service,
  source,
  embedding,
  views,
  onOpenEntry,
  relationOptions,
  returnFocusEntryId,
  onReturnFocusRestored,
}: {
  readonly service: LocalContentService;
  readonly source: Source;
  readonly embedding: DatabaseEmbedding;
  readonly views: DatabaseViewService;
  readonly onOpenEntry: (
    entryId: Uuid,
    embeddingId: Uuid,
    entry: DatabaseEntryDto | undefined,
    definition: DatabaseDefinition,
  ) => void;
  readonly relationOptions: readonly RelationOption[];
  readonly returnFocusEntryId?: Uuid | null;
  readonly onReturnFocusRestored?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const definition = databaseDefinitionForEmbedding(source.row.definition, embedding.id);
  const query = useCallback(
    (viewId: Uuid, cursor?: string) =>
      views.query(source.row.itemId, {
        viewId,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    [views, source.row.itemId],
  );
  const updateEntry = (entryId: Uuid, update: DatabaseCellUpdate): Promise<void> =>
    updateDatabaseCell(service, source.row.itemId, entryId, update, {
      missingItemMessage: "Cette entrée n'est pas disponible sur cet appareil.",
      missingEntryMessage: "Les valeurs de cette entrée ne sont pas disponibles.",
    });
  if (definition === null) return null;
  return (
    <section
      className="database-embedding"
      aria-label={source.database.name}
      data-embedding-id={embedding.id}
    >
      <div className="database-embedding__actions">
        <span className="muted">Source partagée · {source.database.name}</span>
        <Button
          size="compact"
          variant="ghost"
          disabled={removing}
          onClick={() => {
            setRemoving(true);
            setError(null);
            void replaceSource(service, source, {
              ...source.row.definition,
              embeddings: databaseEmbeddings(source.row.definition).map((value) =>
                value.id === embedding.id ? { ...value, state: "retired" } : value,
              ),
            })
              .catch(() => setError("L'affichage n'a pas pu être retiré. Réessayez."))
              .finally(() => setRemoving(false));
          }}
        >
          Retirer de cette page
        </Button>
      </div>
      {error === null ? null : <AsyncState compact kind="error" description={error} />}
      <DatabasePage
        embeddingId={embedding.id}
        database={{ ...source.database, definition } as unknown as DatabaseDto}
        entries={source.entries}
        onReplaceDefinition={(candidate, confirmation) =>
          replaceSource(
            service,
            source,
            replaceDatabaseEmbeddingDefinition(source.row.definition, embedding.id, candidate),
            confirmation,
          )
        }
        onPreviewDefinitionImpact={(candidate) =>
          service.previewDatabaseDefinitionImpact(
            source.row.itemId,
            source.database.definitionRevisionId as Uuid,
            replaceDatabaseEmbeddingDefinition(source.row.definition, embedding.id, candidate),
          )
        }
        onCreateEntry={async (title) => {
          const id = generateUuidV7();
          const result = await service.createDatabaseEntry(source.row.itemId, {
            id,
            title,
            values: {},
            relationTargets: {},
          });
          if (!result.ok) throw new Error(result.error.title);
          return id;
        }}
        onOpenEntry={(entryId) =>
          onOpenEntry(
            entryId,
            embedding.id,
            source.entries.find((entry) => entry.entryId === entryId),
            source.row.definition,
          )
        }
        {...(returnFocusEntryId === undefined ? {} : { returnFocusEntryId })}
        {...(onReturnFocusRestored === undefined ? {} : { onReturnFocusRestored })}
        onUpdateEntry={updateEntry}
        onQueryView={query}
        relationOptions={relationOptions}
      />
    </section>
  );
}

/** Normal pages display references to independent sources beside their editorial content. */
export function PageDatabases({
  service,
  hostPageId,
  active = true,
  onOpenEntry,
  relationOptions = [],
  returnFocus,
  onReturnFocusRestored,
}: {
  readonly service: LocalContentService;
  readonly hostPageId: Uuid;
  readonly active?: boolean;
  readonly onOpenEntry: (
    entryId: Uuid,
    embeddingId: Uuid,
    entry: DatabaseEntryDto | undefined,
    definition: DatabaseDefinition,
  ) => void;
  readonly relationOptions?: readonly RelationOption[];
  readonly returnFocus?: { readonly entryId: Uuid; readonly embeddingId: Uuid } | null;
  readonly onReturnFocusRestored?: () => void;
}) {
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const views = useMemo(() => new DatabaseViewService(service), [service]);
  useEffect(() => () => views.dispose(), [views]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    let refreshRequested = false;
    const load = async (): Promise<void> => {
      if (inFlight) {
        refreshRequested = true;
        return;
      }
      inFlight = true;
      try {
        do {
          refreshRequested = false;
          const rows = await service.listDatabases();
          const loaded = await Promise.all(
            rows.map((row) =>
              readSource(
                service,
                row,
                databaseEmbeddings(row.definition).some(
                  (embedding) =>
                    embedding.hostPageId === hostPageId && embedding.state === "active",
                ),
              ),
            ),
          );
          if (!cancelled) setSources(loaded.filter((source): source is Source => source !== null));
        } while (refreshRequested && !cancelled);
      } catch {
        if (!cancelled)
          setError("Les bases ne sont pas disponibles. Réouvrez cette page pour réessayer.");
      } finally {
        inFlight = false;
      }
    };
    void load();
    const unsubscribe = service.subscribeProjection(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service, hostPageId, active]);
  if (!active) return null;
  return (
    <div className="page-databases">
      {sources.flatMap((source) =>
        databaseEmbeddings(source.row.definition)
          .filter(
            (embedding) => embedding.hostPageId === hostPageId && embedding.state === "active",
          )
          .map((embedding) => (
            <EmbeddedDatabase
              key={embedding.id}
              service={service}
              source={source}
              embedding={embedding}
              views={views}
              onOpenEntry={onOpenEntry}
              relationOptions={relationOptions}
              returnFocusEntryId={
                returnFocus?.embeddingId === embedding.id ? returnFocus.entryId : null
              }
              {...(onReturnFocusRestored === undefined ? {} : { onReturnFocusRestored })}
            />
          )),
      )}
      {error === null ? null : <AsyncState compact kind="error" description={error} />}
    </div>
  );
}
