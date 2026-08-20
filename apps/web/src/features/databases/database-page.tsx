import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import type { DatabaseDefinition, DefinitionImpact, Uuid } from "@myownnotion/domain";
import {
  evaluateDatabaseView,
  extractSearchableDocumentText,
  readDocumentBody,
} from "@myownnotion/domain";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { DatabaseViewPage, DatabaseViewResult } from "../../services/databases.ts";
import { BoardView } from "./board-view.tsx";
import { CalendarView } from "./calendar-view.tsx";
import { DatabaseToolbar, replaceSavedView } from "./database-toolbar.tsx";
import { FilterEditor } from "./filter-editor.tsx";
import { type GalleryPreview, GalleryView } from "./gallery-view.tsx";
import { ListView } from "./list-view.tsx";
import {
  type DatabasePropertyDraft,
  PropertyEditor,
  propertyFromDraft,
  validatePropertyDraft,
} from "./property-editor.tsx";
import { SortGroupEditor } from "./sort-group-editor.tsx";
import { type DatabaseCellUpdate, TableView } from "./table-view.tsx";
import { TaskConfiguration } from "./task-configuration.tsx";
import { useDatabaseView } from "./use-database-view.ts";
import type { RelationOption } from "./value-editor.tsx";

const EMPTY_PROPERTY_DRAFT: DatabasePropertyDraft = { name: "", type: "text" };

export interface DefinitionConfirmation {
  readonly digest: string;
  readonly decision: "preserve-incompatible" | "discard-confirmed";
}

export function DatabasePage({
  database,
  entries,
  onReplaceDefinition,
  onPreviewDefinitionImpact,
  onCreateEntry,
  onOpenEntry,
  onUpdateEntry,
  relationOptions = [],
  queryPage,
  queryState,
  onQueryView,
  returnFocusEntryId,
  onReturnFocusRestored,
}: {
  readonly database: DatabaseDto;
  readonly entries: readonly DatabaseEntryDto[];
  readonly onReplaceDefinition: (
    definition: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ) => void | Promise<void>;
  readonly onPreviewDefinitionImpact?: (
    definition: DatabaseDefinition,
  ) => DefinitionImpact | null | Promise<DefinitionImpact | null>;
  readonly onCreateEntry: (title: string) => void | Promise<void>;
  readonly onOpenEntry: (entryId: Uuid, trigger?: HTMLElement | null) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly relationOptions?: readonly RelationOption[];
  readonly queryPage?: DatabaseViewPage | null;
  readonly queryState?: "loading" | "ready" | "invalid" | "degraded";
  readonly onQueryView?: (viewId: Uuid) => Promise<DatabaseViewResult>;
  readonly returnFocusEntryId?: Uuid | null;
  readonly onReturnFocusRestored?: () => void;
}) {
  const [editingProperty, setEditingProperty] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [pendingDefinition, setPendingDefinition] = useState<DatabaseDefinition | null>(null);
  const [impact, setImpact] = useState<DefinitionImpact | null>(null);
  const [loadedPage, setLoadedPage] = useState<DatabaseViewPage | null>(null);
  const [loadedState, setLoadedState] = useState<"loading" | "ready" | "invalid" | "degraded">(
    onQueryView === undefined ? "ready" : "loading",
  );

  // Contract schemas intentionally expose JSON strings, while the domain
  // brands UUIDs once validation has crossed the boundary. DatabaseDto has
  // already passed that contract validation, so the UI works on the branded
  // shape from here onward.
  const definition = database.definition as unknown as DatabaseDefinition;
  const activeProperties = definition.properties.filter((property) => property.state === "active");
  const viewContext = useDatabaseView(definition);
  const activeView =
    definition.views.find(
      ({ id, state }) => id === viewContext.context.activeViewId && state === "active",
    ) ?? definition.views.find(({ state }) => state === "active");
  const activeViewId = activeView?.id;
  const entryRevisionKey = entries
    .map(({ entryId, revisionId }) => `${entryId}:${revisionId}`)
    .join("|");
  const galleryPreviews = useMemo(() => {
    const previews = new Map<Uuid, GalleryPreview>();
    for (const entry of entries) {
      if (entry.document === null) continue;
      const read = readDocumentBody(entry.document.body);
      if (read.kind !== "blocks" || !read.result.ok) continue;
      const text = extractSearchableDocumentText(read.result.document).trim();
      if (text !== "") {
        previews.set(entry.entryId as Uuid, {
          kind: "page",
          text: text.length > 180 ? `${text.slice(0, 177)}…` : text,
        });
      }
    }
    return previews;
  }, [entries]);
  const fallbackPage = useMemo<DatabaseViewPage | null>(() => {
    if (activeView === undefined) return null;
    const evaluated = evaluateDatabaseView(
      definition,
      activeView.id,
      entries.map((entry) => ({
        entryId: entry.entryId as Uuid,
        title: entry.title,
        values: entry.values as never,
        relationTargets: entry.relationTargets as never,
      })),
    );
    if (!evaluated.ok) return null;
    const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
    return {
      databaseId: database.databaseId,
      viewId: activeView.id,
      definitionRevisionId: database.definitionRevisionId,
      generation: 1,
      coverage: "complete",
      availableCount: entries.length,
      expectedCount: entries.length,
      rows: evaluated.value.rows.flatMap((row) => {
        const entry = byId.get(row.entryId);
        return entry === undefined
          ? []
          : [
              {
                entryId: entry.entryId,
                revisionId: entry.revisionId,
                title: entry.title,
                values: entry.values,
                relationTargets: entry.relationTargets,
                groupId:
                  evaluated.value.groups.find((group) => group.entryIds.includes(row.entryId))
                    ?.id ?? null,
                syncState: "synced" as const,
              },
            ];
      }),
      groups: [],
      nextCursor: null,
      source: "local",
      staleCursorRecovered: false,
    } as DatabaseViewPage;
  }, [activeView, database.databaseId, database.definitionRevisionId, definition, entries]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: definition and entry revisions invalidate a same-ID saved view's server result
  useEffect(() => {
    if (activeViewId === undefined || onQueryView === undefined) return;
    let cancelled = false;
    setLoadedState("loading");
    void onQueryView(activeViewId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLoadedPage(result.value);
        setLoadedState("ready");
        return;
      }
      setLoadedState(
        result.problem.code === "database.invalid-view"
          ? "invalid"
          : result.problem.code.includes("projection")
            ? "degraded"
            : "ready",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeViewId, database.definitionRevisionId, entryRevisionKey, onQueryView]);
  const effectiveQueryState = queryState ?? loadedState;
  const page =
    queryPage !== undefined && queryPage !== null && queryPage.viewId === activeView?.id
      ? queryPage
      : effectiveQueryState === "ready" && loadedPage?.viewId === activeView?.id
        ? loadedPage
        : fallbackPage;
  useEffect(() => {
    if (returnFocusEntryId === undefined || returnFocusEntryId === null || page === null) {
      return;
    }
    let completion: number | undefined;
    let frame: number | undefined;
    let attempts = 0;
    const restore = (): void => {
      const trigger = document.querySelector<HTMLElement>(
        `[data-entry-trigger="${returnFocusEntryId}"]`,
      );
      if (trigger !== null) {
        trigger.focus();
        completion = window.setTimeout(() => {
          viewContext.finishEntryReturn();
          onReturnFocusRestored?.();
        }, 300);
        return;
      }
      attempts += 1;
      if (attempts < 12) frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (completion !== undefined) window.clearTimeout(completion);
    };
  }, [onReturnFocusRestored, page, returnFocusEntryId, viewContext.finishEntryReturn]);

  const saveView = async (view: NonNullable<typeof activeView>): Promise<void> => {
    await onReplaceDefinition(replaceSavedView(definition, view));
  };

  const openEntryFromView = (entryId: Uuid, trigger: HTMLElement | null): void => {
    viewContext.rememberTrigger(entryId, trigger);
    viewContext.openEntry(entryId);
    onOpenEntry(entryId, trigger);
  };

  const addProperty = (): void => {
    const result = validatePropertyDraft(propertyDraft);
    if (!result.ok) {
      setPropertyError(result.error);
      return;
    }
    const property = propertyFromDraft(
      result,
      `property-${String(definition.properties.length).padStart(6, "0")}`,
    );
    const candidate: DatabaseDefinition = {
      ...definition,
      properties: [...definition.properties, property],
      views: definition.views.map((view) => ({
        ...view,
        properties: [
          ...view.properties,
          { propertyId: property.id, visible: true, positionKey: property.positionKey },
        ],
      })),
    };
    setSavingProperty(true);
    void Promise.resolve(onReplaceDefinition(candidate))
      .then(() => {
        setPropertyDraft(EMPTY_PROPERTY_DRAFT);
        setPropertyError(null);
        setEditingProperty(false);
        setSavingProperty(false);
      })
      .catch(() => {
        setPropertyError("The property could not be saved. Your draft is still here.");
        setSavingProperty(false);
      });
  };

  const retireProperty = async (propertyId: Uuid): Promise<void> => {
    const taskRoles =
      definition.taskRoles === null || definition.taskRoles.statusPropertyId === propertyId
        ? null
        : {
            ...definition.taskRoles,
            dueDatePropertyId:
              definition.taskRoles.dueDatePropertyId === propertyId
                ? null
                : definition.taskRoles.dueDatePropertyId,
            priorityPropertyId:
              definition.taskRoles.priorityPropertyId === propertyId
                ? null
                : definition.taskRoles.priorityPropertyId,
          };
    const candidate: DatabaseDefinition = {
      ...definition,
      taskRoles,
      properties: definition.properties.map((property) =>
        property.id === propertyId ? { ...property, state: "retired" as const } : property,
      ),
      views: definition.views.map((view) => ({
        ...view,
        properties: view.properties.map((presentation) =>
          presentation.propertyId === propertyId
            ? { ...presentation, visible: false }
            : presentation,
        ),
      })),
    };
    const preview = await onPreviewDefinitionImpact?.(candidate);
    if (preview?.destructive) {
      setPendingDefinition(candidate);
      setImpact(preview);
      return;
    }
    await onReplaceDefinition(candidate);
  };

  const createEntry = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = entryTitle.trim();
    if (title.length === 0) {
      setEntryError("Give the page a title.");
      return;
    }
    setEntryError(null);
    try {
      await onCreateEntry(title);
      setEntryTitle("");
    } catch {
      setEntryError("The entry could not be created. Your title is still here.");
    }
  };

  return (
    <section className="database-page" aria-labelledby={`database-heading-${database.databaseId}`}>
      <header className="database-page__header">
        <div>
          <p className="muted">Database · page</p>
          <h2 id={`database-heading-${database.databaseId}`}>{database.name}</h2>
        </div>
        <button type="button" disabled={savingProperty} onClick={() => setEditingProperty(true)}>
          Add property
        </button>
      </header>

      {editingProperty ? (
        <PropertyEditor
          draft={propertyDraft}
          error={propertyError}
          onChange={(draft) => {
            setPropertyDraft(draft);
            setPropertyError(null);
          }}
          onSubmit={addProperty}
          onCancel={() => setEditingProperty(false)}
          submitting={savingProperty}
        />
      ) : null}

      {activeView === undefined ? (
        <p role="alert">This database has no usable saved view.</p>
      ) : (
        <>
          <DatabaseToolbar
            definition={definition}
            activeViewId={activeView.id}
            onSelectView={viewContext.selectView}
            onChange={(next) => onReplaceDefinition(next)}
          />
          <div className="database-view-config">
            <FilterEditor
              properties={definition.properties}
              view={activeView}
              onChange={saveView}
            />
            <SortGroupEditor
              properties={definition.properties}
              view={activeView}
              onChange={saveView}
            />
          </div>
        </>
      )}

      <section className="database-schema" aria-labelledby="database-schema-heading">
        <h3 id="database-schema-heading">Properties</h3>
        <ul>
          {activeProperties.map((property) => (
            <li key={property.id}>
              <span>{property.name}</span>
              <span className="muted">{property.type}</span>
              {property.type !== "title" ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => void retireProperty(property.id)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <TaskConfiguration definition={definition} onChange={onReplaceDefinition} />

      {impact !== null && pendingDefinition !== null ? (
        <section className="database-impact" role="alertdialog" aria-label="Confirm schema change">
          <h3>This schema change affects saved values</h3>
          <p>
            {impact.affectedValueCount} value{impact.affectedValueCount === 1 ? "" : "s"} across{" "}
            {impact.affectedEntryCount} entr{impact.affectedEntryCount === 1 ? "y" : "ies"}.
          </p>
          <div className="field-row">
            <button
              type="button"
              onClick={() => {
                void onReplaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "preserve-incompatible",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Preserve incompatible values
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                void onReplaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "discard-confirmed",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Discard affected values
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <form className="database-entry-create" onSubmit={createEntry}>
        <label htmlFor={`new-entry-${database.databaseId}`}>New entry</label>
        <div className="field-row">
          <input
            id={`new-entry-${database.databaseId}`}
            value={entryTitle}
            placeholder="Untitled page"
            onChange={(event) => setEntryTitle(event.target.value)}
          />
          <button type="submit">New entry</button>
        </div>
        {entryError !== null ? <p role="alert">{entryError}</p> : null}
      </form>

      <div className="database-view-status" aria-live="polite">
        {effectiveQueryState === "loading" ? <p>Loading the saved view…</p> : null}
        {effectiveQueryState === "invalid" ? (
          <p role="alert">This view is invalid. Repair the highlighted rule.</p>
        ) : null}
        {effectiveQueryState === "degraded" ? (
          <p role="alert">The complete view is rebuilding. Safe local data remains visible.</p>
        ) : null}
        {page?.staleCursorRecovered ? <p>The view changed; the first page was reloaded.</p> : null}
        {page === null ? null : page.coverage === "complete" ? (
          <p>Complete result · {page.expectedCount} entries</p>
        ) : (
          <p>
            Local data partial: {page.availableCount} of {page.expectedCount}
          </p>
        )}
      </div>

      {activeView !== undefined && page !== null ? (
        activeView.type === "list" ? (
          <ListView
            properties={definition.properties}
            view={activeView}
            page={page}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
            onOpenEntry={openEntryFromView}
          />
        ) : activeView.type === "table" ? (
          <TableView
            properties={definition.properties}
            view={activeView}
            page={page}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry })}
            relationOptions={relationOptions}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
            onOpenEntry={openEntryFromView}
            onResize={(propertyId, width) =>
              saveView({
                ...activeView,
                properties: activeView.properties.map((presentation) =>
                  presentation.propertyId === propertyId
                    ? { ...presentation, width }
                    : presentation,
                ),
              })
            }
          />
        ) : activeView.type === "board" ? (
          <BoardView
            properties={definition.properties}
            view={activeView}
            page={page}
            onOpenEntry={openEntryFromView}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry })}
            onChangeView={saveView}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
          />
        ) : activeView.type === "gallery" ? (
          <GalleryView
            properties={definition.properties}
            view={activeView}
            page={page}
            previews={galleryPreviews}
            onOpenEntry={openEntryFromView}
            onChangeView={saveView}
            scrollTop={viewContext.context.scrollTop}
            onScroll={viewContext.rememberScroll}
          />
        ) : (
          <CalendarView
            properties={definition.properties}
            view={activeView}
            page={page}
            onOpenEntry={openEntryFromView}
            {...(onUpdateEntry === undefined ? {} : { onUpdateEntry })}
            onChangeView={saveView}
          />
        )
      ) : null}
    </section>
  );
}
