import type { LocalDatabaseRow } from "@myownnotion/client-core";
import type {
  DatabaseDto,
  DatabaseEntryDto,
  ReplaceDefinitionRequestDto,
  ReplaceEntryValuesRequestDto,
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
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";
import { DatabasePage, type DefinitionConfirmation } from "./database-page.tsx";
import type { DatabaseCellUpdate } from "./table-view.tsx";
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
  const updateEntry = async (entryId: Uuid, update: DatabaseCellUpdate): Promise<void> => {
    const item = await service.getItem(entryId);
    if (item === null) throw new Error("Cette entrée n'est pas disponible sur cet appareil.");
    if (update.kind === "title") {
      const result = await service.mutate("item.rename", { itemId: entryId, name: update.title }, [
        item.currentRevisionId,
      ]);
      if (!result.ok) throw new Error(result.error.title);
      return;
    }
    const entry = await service.getDatabaseEntry(entryId);
    if (entry === null) throw new Error("Les valeurs de cette entrée ne sont pas disponibles.");
    const values = { ...entry.values.values };
    const relations = {
      ...(await service.getDatabaseEntryRelationTargets(source.row.itemId, entryId)),
    };
    if (update.relationTargets !== undefined) {
      relations[update.propertyId] = update.relationTargets;
      delete values[update.propertyId];
    } else {
      delete relations[update.propertyId];
      if (update.value === undefined) delete values[update.propertyId];
      else values[update.propertyId] = update.value;
    }
    const result = await service.replaceDatabaseEntryValues(source.row.itemId, entryId, {
      baseRevisionId: item.currentRevisionId,
      values,
      relationTargets: relations,
    } as unknown as ReplaceEntryValuesRequestDto);
    if (!result.ok) throw new Error(result.error.title);
  };
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
          const result = await service.createDatabaseEntry(source.row.itemId, {
            id: generateUuidV7(),
            title,
            values: {},
            relationTargets: {},
          });
          if (!result.ok) throw new Error(result.error.title);
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [busy, setBusy] = useState(false);
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
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setPickerOpen(false);
    } catch {
      setError("La base n'a pas pu être ajoutée. Votre saisie est conservée ; réessayez.");
    } finally {
      setBusy(false);
    }
  };
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
      <Button
        size="compact"
        variant="ghost"
        onClick={() => setPickerOpen((value) => !value)}
        aria-expanded={pickerOpen}
      >
        Ajouter une base
      </Button>
      {pickerOpen ? (
        <div className="database-source-picker">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const source = sources.find((value) => value.row.itemId === selectedSource);
                if (source === undefined) throw new Error("Select a source");
                const template =
                  databaseEmbeddings(source.row.definition).find(
                    (value) => value.state === "active",
                  )?.views ?? source.row.definition.views;
                await replaceSource(service, source, {
                  ...source.row.definition,
                  embeddings: [
                    ...databaseEmbeddings(source.row.definition),
                    {
                      id: generateUuidV7(),
                      hostPageId,
                      state: "active",
                      views: template.map((view) => ({ ...view, id: generateUuidV7() })),
                    },
                  ],
                });
              });
            }}
          >
            <label>
              Base existante
              <select
                aria-label="Base existante"
                value={selectedSource}
                disabled={busy}
                onChange={(event) => setSelectedSource(event.target.value)}
              >
                <option value="">Choisir une source</option>
                {sources.map((source) => (
                  <option key={source.row.itemId} value={source.row.itemId}>
                    {source.database.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="compact" disabled={busy || selectedSource === ""}>
              Insérer cette base
            </Button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await service.createDatabase({
                  id: generateUuidV7(),
                  name: name.trim(),
                  hostPageId,
                  placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
                  titlePropertyId: generateUuidV7(),
                  titlePropertyName: "Titre",
                  initialViewId: generateUuidV7(),
                  initialViewName: "Table",
                });
                if (!result.ok) throw new Error(result.error.title);
                setName("");
              });
            }}
          >
            <Field
              label="Nouvelle base"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              placeholder="Projets, lectures…"
            />
            <Button type="submit" size="compact" disabled={busy || name.trim() === ""}>
              Créer et insérer
            </Button>
          </form>
          <p className="muted">
            Les entrées sont partagées. Les vues sont propres à chaque affichage.
          </p>
        </div>
      ) : null}
      {error === null ? null : <AsyncState compact kind="error" description={error} />}
    </div>
  );
}
