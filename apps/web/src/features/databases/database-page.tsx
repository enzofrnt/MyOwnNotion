import type { DatabaseDto, DatabaseEntryDto } from "@myownnotion/contracts";
import type { DatabaseDefinition, DefinitionImpact, Uuid } from "@myownnotion/domain";
import {
  evaluateDatabaseView,
  extractSearchableDocumentText,
  readDocumentBody,
} from "@myownnotion/domain";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseViewPage, DatabaseViewResult } from "../../services/databases.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { BoardView } from "./board-view.tsx";
import { CalendarView } from "./calendar-view.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
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
  const propertyDraftRef = useRef<DatabasePropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const propertySubmissionInFlight = useRef(false);
  const [pendingDefinitionMutations, setPendingDefinitionMutations] = useState(0);
  const entryTitleRef = useRef("");
  const entryInputRef = useRef<HTMLInputElement>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const entrySubmissionInFlight = useRef(false);
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
  const replaceDefinition = async (
    next: DatabaseDefinition,
    confirmation?: DefinitionConfirmation,
  ): Promise<void> => {
    setPendingDefinitionMutations((current) => current + 1);
    try {
      await onReplaceDefinition(next, confirmation);
    } finally {
      setPendingDefinitionMutations((current) => Math.max(0, current - 1));
    }
  };
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
  const canRestoreEntryFocus = page !== null;
  useEffect(() => {
    if (returnFocusEntryId === undefined || returnFocusEntryId === null || !canRestoreEntryFocus) {
      return;
    }
    let frame: number | undefined;
    let attempts = 0;
    let completed = false;
    let lastFocusedTrigger: HTMLElement | null = null;

    // Clear the saved selection now, never from a delayed callback that could
    // land after the owner has started another controlled-input draft.
    viewContext.finishEntryReturn();

    const complete = (): void => {
      if (completed) return;
      completed = true;
      onReturnFocusRestored?.();
    };

    const restore = (): void => {
      const trigger = document.querySelector<HTMLElement>(
        `[data-entry-trigger="${returnFocusEntryId}"]`,
      );
      const activeElement = document.activeElement;
      const userMovedFocus =
        lastFocusedTrigger !== null &&
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== lastFocusedTrigger &&
        activeElement.isConnected;
      if (userMovedFocus) {
        complete();
        return;
      }

      // A local fallback, then the loaded view, can each render their own
      // trigger. Follow only those replacements; never steal focus once the
      // owner has moved to another connected control.
      if (trigger !== null) {
        if (activeElement !== trigger) trigger.focus();
        lastFocusedTrigger = trigger;
      }
      attempts += 1;
      if (attempts < 20) {
        frame = requestAnimationFrame(restore);
      } else {
        complete();
      }
    };
    restore();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    canRestoreEntryFocus,
    onReturnFocusRestored,
    returnFocusEntryId,
    viewContext.finishEntryReturn,
  ]);

  const saveView = async (view: NonNullable<typeof activeView>): Promise<void> => {
    await replaceDefinition(replaceSavedView(definition, view));
  };

  const openEntryFromView = (entryId: Uuid, trigger: HTMLElement | null): void => {
    viewContext.rememberTrigger(entryId, trigger);
    viewContext.openEntry(entryId);
    onOpenEntry(entryId, trigger);
  };

  const addProperty = (submittedDraft: DatabasePropertyDraft): void => {
    if (propertySubmissionInFlight.current) return;
    // Preserve exactly what the form submitted when validation fails. The
    // final input event can be newer than this component's last committed
    // render on a constrained browser.
    propertyDraftRef.current = submittedDraft;
    setPropertyDraft(submittedDraft);
    const result = validatePropertyDraft(submittedDraft);
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
    const acceptedDraft = submittedDraft;
    // Commit the form state at submission time. A previous asynchronous save
    // must never close a newer editor that the owner has already opened.
    propertyDraftRef.current = EMPTY_PROPERTY_DRAFT;
    propertySubmissionInFlight.current = true;
    setPropertyDraft(EMPTY_PROPERTY_DRAFT);
    setPropertyError(null);
    setEditingProperty(false);
    setSavingProperty(true);
    void replaceDefinition(candidate)
      .catch(() => {
        propertyDraftRef.current = acceptedDraft;
        setPropertyDraft(acceptedDraft);
        setPropertyError(DATABASE_COPY.page.propertySaveFailed);
        setEditingProperty(true);
      })
      .finally(() => {
        propertySubmissionInFlight.current = false;
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
    await replaceDefinition(candidate);
  };

  const submitEntry = async (): Promise<void> => {
    // Pointer activation and the form submit can both reach this function. The
    // ref closes that gap synchronously, before React has rendered `disabled`,
    // so one physical gesture can never create two entries.
    if (entrySubmissionInFlight.current) return;
    // The DOM owns this short-lived draft. A synchronization projection can
    // rerender this page between the browser's input event and React's state
    // commit on constrained WebKit runners; reading the mounted field keeps
    // exactly what the owner can still see instead of an older render value.
    const submittedTitle = entryInputRef.current?.value ?? entryTitleRef.current;
    entryTitleRef.current = submittedTitle;
    const title = submittedTitle.trim();
    if (title.length === 0) {
      setEntryError(DATABASE_COPY.page.titleRequired);
      return;
    }
    entrySubmissionInFlight.current = true;
    setEntryError(null);
    // Clear and lock the visible field before the asynchronous write. If
    // the clear waited until the write completed, that older render could
    // erase the next title a user had already started typing under load.
    entryTitleRef.current = "";
    if (entryInputRef.current !== null) entryInputRef.current.value = "";
    setSavingEntry(true);
    try {
      await onCreateEntry(title);
    } catch {
      entryTitleRef.current = submittedTitle;
      if (entryInputRef.current !== null) entryInputRef.current.value = submittedTitle;
      setEntryError(DATABASE_COPY.page.entryCreateFailed);
    } finally {
      entrySubmissionInFlight.current = false;
      setSavingEntry(false);
    }
  };
  const createEntry = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitEntry();
  };

  return (
    <section
      className="database-page"
      aria-labelledby={`database-heading-${database.databaseId}`}
      aria-busy={pendingDefinitionMutations > 0}
      data-definition-state={pendingDefinitionMutations > 0 ? "saving" : "idle"}
    >
      <header className="database-page__header">
        <div>
          <p className="muted">{DATABASE_COPY.page.eyebrow}</p>
          <h2 id={`database-heading-${database.databaseId}`}>Database contents</h2>
        </div>
        <button type="button" disabled={savingProperty} onClick={() => setEditingProperty(true)}>
          {DATABASE_COPY.page.addProperty}
        </button>
      </header>

      {editingProperty ? (
        <PropertyEditor
          draft={propertyDraft}
          error={propertyError}
          onChange={(draft) => {
            propertyDraftRef.current = draft;
            setPropertyDraft(draft);
            setPropertyError(null);
          }}
          onSubmit={addProperty}
          onCancel={() => setEditingProperty(false)}
          submitting={savingProperty}
        />
      ) : null}

      {activeView === undefined ? (
        <p role="alert">{DATABASE_COPY.common.noUsableView}</p>
      ) : (
        <>
          <DatabaseToolbar
            definition={definition}
            activeViewId={activeView.id}
            onSelectView={viewContext.selectView}
            onChange={replaceDefinition}
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
        <h3 id="database-schema-heading">{DATABASE_COPY.page.properties}</h3>
        <ul>
          {activeProperties.map((property) => (
            <li key={property.id}>
              <span>{property.name}</span>
              <span className="muted">{DATABASE_COPY.property.typeLabels[property.type]}</span>
              {property.type !== "title" ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => void retireProperty(property.id)}
                >
                  {DATABASE_COPY.common.remove}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <TaskConfiguration definition={definition} onChange={replaceDefinition} />

      {impact !== null && pendingDefinition !== null ? (
        <section
          className="database-impact"
          role="alertdialog"
          aria-label={DATABASE_COPY.page.confirmSchemaChange}
        >
          <h3>{DATABASE_COPY.page.schemaImpactHeading}</h3>
          <p>{DATABASE_COPY.page.impact(impact.affectedValueCount, impact.affectedEntryCount)}</p>
          <div className="field-row">
            <button
              type="button"
              onClick={() => {
                void replaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "preserve-incompatible",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              {DATABASE_COPY.common.preserveIncompatible}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                void replaceDefinition(pendingDefinition, {
                  digest: impact.impactDigest,
                  decision: "discard-confirmed",
                });
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              {DATABASE_COPY.common.discardAffected}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setImpact(null);
                setPendingDefinition(null);
              }}
            >
              {DATABASE_COPY.common.cancel}
            </button>
          </div>
        </section>
      ) : null}

      <form className="database-entry-create" onSubmit={createEntry}>
        <label htmlFor={`new-entry-${database.databaseId}`}>{DATABASE_COPY.page.newEntry}</label>
        <div className="field-row">
          <input
            ref={entryInputRef}
            id={`new-entry-${database.databaseId}`}
            defaultValue=""
            placeholder={DATABASE_COPY.page.untitledPage}
            disabled={savingEntry}
            onChange={(event) => {
              entryTitleRef.current = event.currentTarget.value;
              setEntryError(null);
            }}
          />
          <StableActionButton
            type="submit"
            disabled={savingEntry}
            onActivate={() => void submitEntry()}
          >
            {DATABASE_COPY.page.newEntry}
          </StableActionButton>
        </div>
        {entryError !== null ? <p role="alert">{entryError}</p> : null}
      </form>

      <div className="database-view-status" aria-live="polite">
        {effectiveQueryState === "loading" ? <p>{DATABASE_COPY.page.loadingView}</p> : null}
        {effectiveQueryState === "invalid" ? (
          <p role="alert">{DATABASE_COPY.page.invalidView}</p>
        ) : null}
        {effectiveQueryState === "degraded" ? (
          <p role="alert">{DATABASE_COPY.page.rebuildingView}</p>
        ) : null}
        {page?.staleCursorRecovered ? <p>{DATABASE_COPY.page.staleView}</p> : null}
        {page === null ? null : page.coverage === "complete" ? (
          <p>{DATABASE_COPY.page.completeResult(page.expectedCount)}</p>
        ) : (
          <p>{DATABASE_COPY.page.partialResult(page.availableCount, page.expectedCount)}</p>
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
