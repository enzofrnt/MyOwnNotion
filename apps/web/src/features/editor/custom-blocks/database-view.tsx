import type { LocalDatabaseQuerySource, LocalDatabaseRow } from "@myownnotion/client-core";
import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabasePresentationDefinition,
  generateUuidV7,
  jsonValuesEqual,
  MISSING_DATA_SOURCE_MESSAGE,
  ownedSourceIdFromItemId,
  previewDefinitionImpact,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DatabaseRowSyncState } from "../../../services/databases.ts";
import type { LocalContentService } from "../../../services/local-content.ts";
import { AsyncState, Button } from "../../../ui/primitives/index.ts";
import { DatabasePage, type DefinitionConfirmation } from "../../databases/database-page.tsx";
import { definitionViewsPreservingPresentation } from "../../databases/definition-view-merge.ts";
import { PageViewQuery } from "../../databases/page-view-query.ts";
import { createProjectionRefresh } from "../../databases/projection-refresh.ts";
import type { DatabaseCellUpdate } from "../../databases/table-view.tsx";
import { updateDatabaseCell } from "../../databases/update-database-cell.ts";

interface LoadedView {
  readonly container: LocalDatabaseRow;
  readonly source: LocalDatabaseRow;
  readonly sourceLifecycle: "active" | "trashed" | "purged";
  readonly view: NonNullable<LocalDatabaseRow["presentation"]>["views"][number];
  readonly entries: readonly DatabaseEntryDto[];
  readonly querySource: Omit<LocalDatabaseQuerySource, "generation">;
  readonly states: ReadonlyMap<Uuid, DatabaseRowSyncState>;
  readonly queryGeneration?: number;
}

export async function loadView(
  service: LocalContentService,
  containerItemId: Uuid,
  viewId: Uuid,
): Promise<LoadedView | "missing-source" | "missing-view"> {
  const container = await service.getDatabase(containerItemId);
  const view = container?.presentation?.views.find(
    (candidate) => candidate.id === viewId && candidate.state === "active",
  );
  if (container === null || view === undefined) return "missing-view";
  let source = await service.getDatabase(view.sourceId);
  if (source === null) {
    // Older projections can name the derived primary source without storing
    // that source identity as a key. Modern sources never need this inventory.
    source =
      (await service.listDatabases()).find(
        (candidate) =>
          (candidate.sourceId ?? ownedSourceIdFromItemId(candidate.itemId)) === view.sourceId,
      ) ?? null;
  }
  if (source === null) return "missing-source";
  const owner = await service.getItem(source.itemId);
  if (owner === null) return "missing-source";
  const [ownerContainer, entryRows, queued, conflicts] = await Promise.all([
    source.itemId === containerItemId
      ? Promise.resolve(container)
      : service.getDatabase(source.itemId),
    owner.lifecycle === "active" ? service.listDatabaseEntries(source.itemId) : Promise.resolve([]),
    service.outbox.all(),
    service.outbox.activeConflicts(),
  ]);
  const primarySourceId =
    ownerContainer?.sourceId ?? source.sourceId ?? ownedSourceIdFromItemId(source.itemId);
  const memberships =
    owner.lifecycle === "active"
      ? entryRows.filter((membership) => (membership.sourceId ?? primarySourceId) === view.sourceId)
      : [];
  const ids = memberships.map((entry) => entry.entryItemId);
  const [items, relations] = await Promise.all([
    service.getItems(ids),
    service.getDatabaseEntryRelations(source.itemId, ids),
  ]);
  const states = new Map<Uuid, DatabaseRowSyncState>();
  for (const [mutations, state] of [
    [queued, "pending"],
    [conflicts, "conflict"],
  ] as const) {
    for (const mutation of mutations) {
      const entryId =
        mutation.payload["entryId"] ?? mutation.payload["id"] ?? mutation.payload["itemId"];
      if (typeof entryId === "string") states.set(entryId as Uuid, state);
    }
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const entries = memberships.flatMap((membership) => {
    const item = byId.get(membership.entryItemId);
    if (
      item === undefined ||
      item.lifecycle !== "active" ||
      (item.kind !== "page" && item.kind !== "folder")
    )
      return [];
    return [
      {
        databaseId: source.itemId,
        entryId: item.id,
        kind: item.kind,
        icon: item.icon ?? null,
        revisionId: item.currentRevisionId,
        lifecycle: item.lifecycle,
        title: item.name,
        document: item.pageDocument,
        values: membership.values.values,
        relationTargets: relations.get(item.id) ?? {},
      } as unknown as DatabaseEntryDto,
    ];
  });
  const availability = new Map(memberships.map((row) => [row.entryItemId, row.availability]));
  const querySource: Omit<LocalDatabaseQuerySource, "generation"> = {
    databaseId: source.itemId,
    definitionRevisionId: source.definitionRevisionId ?? source.itemId,
    definition: { ...source.definition, views: [view] },
    expectedCount: memberships.length,
    entries: entries.map((entry) => ({
      entryId: entry.entryId as Uuid,
      revisionId: entry.revisionId as Uuid,
      title: entry.title,
      availability: availability.get(entry.entryId as Uuid) ?? "never-fetched",
      values: entry.values as LocalDatabaseQuerySource["entries"][number]["values"],
      relationTargets: relations.get(entry.entryId as Uuid) ?? {},
    })),
  };
  return {
    container,
    source,
    sourceLifecycle: owner.lifecycle,
    view,
    entries,
    querySource,
    states,
  };
}

export function DatabaseViewSurface({
  containerItemId,
  viewId,
  service,
  openItem,
  returnFocusEntryId,
  onReturnFocusRestored,
  formatPlacement = "panel",
}: {
  readonly containerItemId: Uuid;
  readonly viewId: Uuid;
  readonly service: LocalContentService;
  readonly openItem: (itemId: Uuid) => void;
  readonly returnFocusEntryId?: Uuid | null;
  readonly onReturnFocusRestored?: () => void;
  readonly formatPlacement?: "panel" | "chrome";
}) {
  const readProjectionState = useCallback(() => {
    const snapshot = service.getSnapshot();
    if (snapshot.projectionComplete) return "complete";
    if (snapshot.projectionLoadFailed) return "error";
    return snapshot.syncState === "offline" ? "offline" : "loading";
  }, [service]);
  const projectionState = useSyncExternalStore(
    service.subscribe,
    readProjectionState,
    readProjectionState,
  );
  const projectionComplete = projectionState === "complete";
  // A cursor belongs to one service, container and view; crossing that boundary resets it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these identities define the lifetime of the cursor store.
  const query = useMemo(() => new PageViewQuery(), [service, containerItemId, viewId]);
  // Keep a readable local snapshot during discovery and refresh, but never
  // reuse another view's contents or promote partial data before its new read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these identities define one accepted view snapshot.
  const readScope = useMemo(() => ({}), [service, containerItemId, viewId]);
  const [viewSnapshot, setViewSnapshot] = useState<{
    readonly scope: object;
    readonly complete: boolean;
    readonly value: LoadedView | "missing-source" | "missing-view";
  } | null>(null);
  const loaded = viewSnapshot?.scope === readScope ? viewSnapshot.value : null;
  const acceptedComplete = viewSnapshot?.scope === readScope && viewSnapshot.complete;
  const [readyScope, setReadyScope] = useState<object | null>(null);
  const ready = readyScope === readScope;
  const [error, setError] = useState<string | null>(null);
  const refreshQueue = useMemo(
    () =>
      createProjectionRefresh({
        load: () => loadView(service, containerItemId, viewId),
        publish: (next) => {
          setViewSnapshot({
            scope: readScope,
            complete: projectionComplete,
            value:
              typeof next === "string"
                ? next
                : { ...next, queryGeneration: query.update(next.querySource, next.states) },
          });
          setError(null);
          setReadyScope(readScope);
        },
        onError: () => {
          setError("Cette vue ne peut pas être chargée pour le moment.");
          setReadyScope(readScope);
        },
      }),
    [service, containerItemId, viewId, query, readScope, projectionComplete],
  );
  const refresh = refreshQueue.refresh;
  const queryGeneration =
    typeof loaded === "object" && loaded !== null ? loaded.queryGeneration : undefined;
  // DatabasePage reloads its first page when the underlying snapshot changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation invalidates the query callback consumed by DatabasePage.
  const queryView = useCallback(
    (id: Uuid, cursor?: string) => query.query(id, cursor),
    [query, queryGeneration],
  );
  const retryDiscovery = useCallback(() => {
    void service
      .synchronize()
      .then(refresh)
      .catch(() => undefined);
  }, [service, refresh]);
  useEffect(() => {
    refreshQueue.activate();
    void refresh().catch(() => undefined);
    const unsubscribe = service.subscribeProjection(() => {
      void refresh().catch(() => undefined);
    });
    return () => {
      refreshQueue.deactivate();
      unsubscribe();
    };
  }, [service, refreshQueue, refresh]);
  const hasKnownEntries =
    typeof loaded === "object" && loaded !== null && loaded.entries.length > 0;
  if (!projectionComplete && !hasKnownEntries)
    return (
      <div className="editor-database-view-block" data-testid="database-view-surface">
        <AsyncState
          compact
          kind={error !== null ? "error" : projectionState}
          loadingLayout="table"
          loadingRows={3}
          description={
            error !== null || projectionState === "error"
              ? "Cette base de données n’a pas pu être chargée."
              : projectionState === "offline"
                ? "Cette base de données n’est pas encore disponible sur cet appareil. Reconnectez-vous pour la charger."
                : "Chargement de la base de données…"
          }
          action={
            projectionState === "loading" && error === null ? undefined : (
              <Button size="compact" onClick={retryDiscovery}>
                Réessayer
              </Button>
            )
          }
        />
      </div>
    );
  if (!ready)
    return (
      <div className="editor-database-view-block" data-testid="database-view-surface">
        Chargement de la base…
      </div>
    );
  if (error !== null && !hasKnownEntries)
    return (
      <div className="editor-database-view-block" data-testid="database-view-surface" role="alert">
        {error}
      </div>
    );
  if (
    loaded === "missing-source" ||
    (typeof loaded === "object" && loaded !== null && loaded.sourceLifecycle !== "active")
  )
    return (
      <div className="editor-database-view-block" data-testid="database-view-surface" role="alert">
        {MISSING_DATA_SOURCE_MESSAGE}
      </div>
    );
  if (loaded === null || loaded === "missing-view")
    return (
      <div className="editor-database-view-block" data-testid="database-view-surface" role="alert">
        La vue ou sa source n’est plus disponible.
      </div>
    );
  const discoveryState =
    error !== null
      ? "error"
      : !projectionComplete
        ? projectionState
        : !acceptedComplete
          ? "loading"
          : undefined;
  const definition: DatabaseDefinition = {
    ...loaded.source.definition,
    views: [loaded.view],
  };
  const database: DatabaseDto = {
    databaseId: loaded.source.itemId,
    sourceId: loaded.view.sourceId,
    definitionRevisionId: loaded.source.definitionRevisionId ?? loaded.source.itemId,
    lifecycle: "active",
    name: loaded.source.definition.name ?? "Base sans nom",
    definition: definition as unknown as DatabaseDto["definition"],
  };
  const planSourceWrite = async (candidate: DatabaseDefinition) => {
    const currentContainer = await service.getDatabase(containerItemId as Uuid);
    const currentSource = await service.getDatabase(loaded.source.itemId);
    if (currentContainer === null || currentSource === null) throw new Error("Base indisponible");
    const currentPresentation = currentContainer.presentation;
    const currentView = currentPresentation?.views.find((view) => view.id === viewId);
    const presentationRevisionId = currentContainer.presentationRevisionId;
    if (
      currentPresentation === undefined ||
      currentView === undefined ||
      presentationRevisionId === undefined
    ) {
      throw new Error("Vue indisponible");
    }
    const nextView = candidate.views[0];
    const { sourceId: _sourceId, ...currentViewSettings } = currentView;
    const viewChanged = nextView !== undefined && !jsonValuesEqual(nextView, currentViewSettings);
    const sourceChanged =
      !jsonValuesEqual(candidate.properties, currentSource.definition.properties) ||
      !jsonValuesEqual(candidate.taskRoles, currentSource.definition.taskRoles);
    if (sourceChanged && !service.getSnapshot().projectionComplete) {
      throw new Error(
        "Attendez la fin du chargement des entrées avant de modifier la structure de la base.",
      );
    }
    const presentationViews =
      (containerItemId === currentSource.itemId
        ? currentPresentation.views
        : currentSource.presentation?.views) ?? [];
    const nextSource: DatabaseDefinition = {
      ...currentSource.definition,
      properties: candidate.properties,
      taskRoles: candidate.taskRoles,
      views: definitionViewsPreservingPresentation(
        currentSource.definition.views,
        presentationViews,
        viewId,
        nextView,
      ),
    };
    return {
      currentContainer,
      currentPresentation,
      currentSource,
      currentView,
      nextSource,
      nextView,
      presentationRevisionId,
      sourceChanged,
      viewChanged,
    };
  };
  const replaceDefinition = async (
    candidate: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ): Promise<void> => {
    const plan = await planSourceWrite(candidate);
    if (plan.sourceChanged) {
      const result = await service.replaceDatabaseDefinition(plan.currentSource.itemId, {
        baseRevisionId: plan.currentSource.definitionRevisionId ?? plan.currentSource.itemId,
        ...(plan.currentSource.sourceId === undefined
          ? {}
          : { sourceId: plan.currentSource.sourceId }),
        definition: plan.nextSource as never,
        ...(confirmation === undefined
          ? {}
          : {
              impactConfirmation: {
                digest: confirmation.digest,
                decision: confirmation.decision,
              },
            }),
      });
      if (!result.ok) throw new Error(result.error.title);
      // The owner definition mutation also advances its presentation in one
      // transaction. A linked view has a separate container to update below.
      if (containerItemId === plan.currentSource.itemId) return;
    }
    if (plan.viewChanged && plan.nextView !== undefined) {
      const nextView = plan.nextView;
      const presentation: DatabasePresentationDefinition = {
        ...plan.currentPresentation,
        views: plan.currentPresentation.views.map((view) =>
          view.id === viewId ? { ...nextView, id: view.id, sourceId: view.sourceId } : view,
        ),
      };
      const result = await service.mutate(
        "database.presentation.replace",
        {
          containerItemId: containerItemId as Uuid,
          baseRevisionId: plan.presentationRevisionId,
          presentation,
        },
        [plan.presentationRevisionId],
      );
      if (!result.ok) throw new Error(result.error.title);
    }
  };
  const previewDefinition = async (candidate: DatabaseDefinition) => {
    const plan = await planSourceWrite(candidate);
    if (!plan.sourceChanged) return null;
    const revisionId = plan.currentSource.definitionRevisionId ?? plan.currentSource.itemId;
    const entries = await service.listDatabaseEntries(plan.currentSource.itemId);
    if (entries.some((entry) => entry.availability !== "present")) return null;
    return previewDefinitionImpact({
      baseRevisionId: revisionId,
      current: plan.currentSource.definition,
      candidate: plan.nextSource,
      entries: entries.map((entry) => entry.values),
    });
  };
  const updateEntry = (entryId: Uuid, update: DatabaseCellUpdate): Promise<void> =>
    updateDatabaseCell(service, loaded.source.itemId, entryId, update, {
      missingItemMessage: "Entrée indisponible",
    });
  return (
    <div
      className="editor-database-view-block"
      contentEditable={false}
      data-testid="database-view-surface"
    >
      <DatabasePage
        embeddingId={viewId as Uuid}
        formatPlacement={formatPlacement}
        {...(formatPlacement === "chrome"
          ? { toolsSlotId: `database-view-tools-${containerItemId}` }
          : {})}
        {...(returnFocusEntryId === undefined ? {} : { returnFocusEntryId })}
        {...(onReturnFocusRestored === undefined ? {} : { onReturnFocusRestored })}
        database={database}
        entries={loaded.entries}
        {...(discoveryState === undefined
          ? {}
          : { discoveryState, onRetryDiscovery: retryDiscovery })}
        onQueryView={queryView}
        onPreviewDefinitionImpact={previewDefinition}
        onReplaceDefinition={replaceDefinition}
        onCreateEntry={async (title, initialValues = {}, initialRelations = {}) => {
          const id = generateUuidV7();
          const result = await service.createDatabaseEntry(loaded.source.itemId, {
            id,
            sourceId: loaded.view.sourceId,
            title,
            values: initialValues,
            relationTargets: Object.fromEntries(
              Object.entries(initialRelations).map(([id, targets]) => [id, [...targets]]),
            ),
          });
          if (!result.ok) throw new Error(result.error.title);
          return id;
        }}
        onCreateFolder={async (title, initialValues = {}, initialRelations = {}) => {
          const id = generateUuidV7();
          const result = await service.createDatabaseEntry(loaded.source.itemId, {
            id,
            sourceId: loaded.view.sourceId,
            title,
            kind: "folder",
            values: initialValues,
            relationTargets: Object.fromEntries(
              Object.entries(initialRelations).map(([id, targets]) => [id, [...targets]]),
            ),
          });
          if (!result.ok) throw new Error(result.error.title);
          return id;
        }}
        onOpenEntry={(entryId) => openItem(entryId)}
        onUpdateEntry={updateEntry}
      />
    </div>
  );
}
