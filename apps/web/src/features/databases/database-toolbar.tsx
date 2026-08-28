import {
  type DatabaseDefinition,
  type DatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { type FormEvent, type KeyboardEvent, useLayoutEffect, useState } from "react";
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";

function activeViews(definition: DatabaseDefinition): DatabaseView[] {
  return definition.views
    .filter(({ state }) => state === "active")
    .sort(
      (left, right) =>
        left.positionKey.localeCompare(right.positionKey) || left.id.localeCompare(right.id),
    );
}

export function replaceSavedView(
  definition: DatabaseDefinition,
  replacement: DatabaseView,
): DatabaseDefinition {
  return {
    ...definition,
    views: definition.views.map((view) => (view.id === replacement.id ? replacement : view)),
  };
}

export function createSavedView(
  definition: DatabaseDefinition,
  source: DatabaseView,
  type: DatabaseView["type"],
  name: string,
): DatabaseDefinition {
  const views = activeViews(definition);
  const activeProperties = definition.properties.filter(({ state }) => state === "active");
  const common = {
    ...source,
    id: generateUuidV7(),
    name,
    type,
    positionKey: `view-${String(views.length + 1).padStart(6, "0")}`,
    state: "active" as const,
  };
  let created: DatabaseView;
  if (type === "table") {
    created = { ...common, type, options: { density: "comfortable", freezeTitle: true } };
  } else if (type === "list") {
    created = {
      ...common,
      type,
      options: {
        density: "comfortable",
        secondaryPropertyIds: source.properties
          .filter(({ visible }) => visible)
          .map(({ propertyId }) => propertyId)
          .filter((propertyId) =>
            activeProperties.some(
              (property) => property.id === propertyId && property.type !== "title",
            ),
          )
          .slice(0, 3),
      },
    };
  } else if (type === "board") {
    const axis = activeProperties.find(
      (property) => property.type === "status" || property.type === "select",
    );
    if (axis === undefined || (axis.type !== "status" && axis.type !== "select")) return definition;
    created = {
      ...common,
      type,
      group: null,
      options: {
        axisPropertyId: axis.id,
        columnOrder: axis.config.options.map(({ id }) => id),
        collapsedColumnIds: [],
      },
    };
  } else if (type === "gallery") {
    created = {
      ...common,
      type,
      options: {
        cardPropertyIds: source.properties
          .filter(({ visible }) => visible)
          .map(({ propertyId }) => propertyId)
          .filter((propertyId) =>
            activeProperties.some(
              (property) => property.id === propertyId && property.type !== "title",
            ),
          )
          .slice(0, 4),
        preview: "page",
      },
    };
  } else {
    const dateProperty = activeProperties.find((property) => property.type === "date");
    if (dateProperty === undefined) return definition;
    created = {
      ...common,
      type,
      group: null,
      options: { datePropertyId: dateProperty.id, initialMode: "month" },
    };
  }
  return { ...definition, views: [...definition.views, created] };
}

export function duplicateSavedView(
  definition: DatabaseDefinition,
  source: DatabaseView,
  name: string,
): DatabaseDefinition {
  const views = activeViews(definition);
  return {
    ...definition,
    views: [
      ...definition.views,
      {
        ...source,
        id: generateUuidV7(),
        name,
        positionKey: `view-${String(views.length + 1).padStart(6, "0")}`,
        state: "active",
      },
    ],
  };
}

function RenameViewControl({
  view,
  disabled,
  onRename,
}: {
  readonly view: DatabaseView;
  readonly disabled?: boolean;
  readonly onRename: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(view.name);
  const [saving, setSaving] = useState(false);
  // Synchronize an externally selected or renamed view before the browser can
  // accept input. A passive effect can run after a fast user starts typing and
  // replace that draft with the old view name.
  useLayoutEffect(() => setName(view.name), [view.name]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalized = name.trim();
    if (normalized === "" || normalized === view.name) return;
    setSaving(true);
    void Promise.resolve(onRename(normalized)).finally(() => setSaving(false));
  };
  return (
    <form className="database-view-rename" onSubmit={submit}>
      <Field
        label={DATABASE_COPY.toolbar.viewName}
        size="compact"
        value={name}
        disabled={disabled || saving}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        size="compact"
        busy={saving}
        disabled={disabled || saving || name.trim() === "" || name.trim() === view.name}
      >
        {DATABASE_COPY.toolbar.rename}
      </Button>
    </form>
  );
}

export function DatabaseToolbar({
  definition,
  activeViewId,
  onSelectView,
  onChange,
}: {
  readonly definition: DatabaseDefinition;
  readonly activeViewId: Uuid;
  readonly onSelectView: (viewId: Uuid) => void;
  readonly onChange: (definition: DatabaseDefinition) => void | Promise<void>;
}) {
  const [savingVisibility, setSavingVisibility] = useState<ReadonlySet<Uuid>>(new Set());
  const [savingView, setSavingView] = useState(false);
  const views = activeViews(definition);
  const active = views.find(({ id }) => id === activeViewId) ?? views[0];
  if (active === undefined) {
    return <AsyncState compact kind="error" description={DATABASE_COPY.common.noUsableView} />;
  }
  const hasBoardAxis = definition.properties.some(
    ({ state, type }) => state === "active" && (type === "status" || type === "select"),
  );
  const hasCalendarDate = definition.properties.some(
    ({ state, type }) => state === "active" && type === "date",
  );

  const persist = (next: DatabaseDefinition): Promise<void> => {
    setSavingView(true);
    return Promise.resolve(onChange(next)).finally(() => setSavingView(false));
  };

  const create = (type: DatabaseView["type"], name: string): void => {
    const next = createSavedView(definition, active, type, name);
    const created = activeViews(next).at(-1);
    if (created?.id === active.id) return;
    void persist(next);
    if (created !== undefined) onSelectView(created.id);
  };

  const selectAdjacent = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const target = views[(index + direction + views.length) % views.length];
    if (target === undefined) return;
    onSelectView(target.id);
    const element = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `[data-view-id="${target.id}"]`,
    );
    element?.focus();
  };

  const move = (direction: -1 | 1): void => {
    const index = views.findIndex(({ id }) => id === active.id);
    const target = index + direction;
    if (target < 0 || target >= views.length) return;
    const reordered = [...views];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) return;
    reordered.splice(target, 0, moved);
    const positions = new Map(
      reordered.map((view, position) => [view.id, `view-${String(position + 1).padStart(6, "0")}`]),
    );
    void persist({
      ...definition,
      views: definition.views.map((view) => ({
        ...view,
        positionKey: positions.get(view.id) ?? view.positionKey,
      })),
    });
  };
  const presentations = [...active.properties].sort(
    (left, right) =>
      left.positionKey.localeCompare(right.positionKey) ||
      left.propertyId.localeCompare(right.propertyId),
  );
  const moveProperty = (propertyId: Uuid, direction: -1 | 1): void => {
    const index = presentations.findIndex((presentation) => presentation.propertyId === propertyId);
    const target = index + direction;
    const currentPresentation = presentations[index];
    const targetPresentation = presentations[target];
    if (currentPresentation === undefined || targetPresentation === undefined) return;
    void persist(
      replaceSavedView(definition, {
        ...active,
        properties: active.properties.map((presentation) =>
          presentation.propertyId === currentPresentation.propertyId
            ? { ...presentation, positionKey: targetPresentation.positionKey }
            : presentation.propertyId === targetPresentation.propertyId
              ? { ...presentation, positionKey: currentPresentation.positionKey }
              : presentation,
        ),
      }),
    );
  };

  return (
    <section className="database-toolbar" aria-label={DATABASE_COPY.toolbar.savedViews}>
      <div className="database-view-tabs" role="tablist" aria-label={DATABASE_COPY.toolbar.views}>
        {views.map((view, index) => (
          <Button
            key={view.id}
            type="button"
            size="compact"
            variant="ghost"
            role="tab"
            data-view-id={view.id}
            aria-selected={view.id === active.id}
            tabIndex={view.id === active.id ? 0 : -1}
            onClick={() => onSelectView(view.id)}
            onKeyDown={(event) => selectAdjacent(event, index)}
          >
            {view.name} <span className="muted">{DATABASE_COPY.toolbar.viewTypes[view.type]}</span>
          </Button>
        ))}
      </div>
      <div
        className="database-view-actions"
        role="toolbar"
        aria-label={DATABASE_COPY.toolbar.actionsFor(active.name)}
      >
        <Button
          type="button"
          size="compact"
          disabled={savingView}
          onClick={() =>
            create("table", DATABASE_COPY.toolbar.defaultViewName("table", views.length + 1))
          }
        >
          {DATABASE_COPY.toolbar.newTable}
        </Button>
        <Button
          type="button"
          size="compact"
          disabled={savingView}
          onClick={() =>
            create("list", DATABASE_COPY.toolbar.defaultViewName("list", views.length + 1))
          }
        >
          {DATABASE_COPY.toolbar.newList}
        </Button>
        <Button
          type="button"
          size="compact"
          disabled={savingView || !hasBoardAxis}
          title={hasBoardAxis ? undefined : DATABASE_COPY.toolbar.boardNeedsProperty}
          onClick={() =>
            create("board", DATABASE_COPY.toolbar.defaultViewName("board", views.length + 1))
          }
        >
          {DATABASE_COPY.toolbar.newBoard}
        </Button>
        <Button
          type="button"
          size="compact"
          disabled={savingView}
          onClick={() =>
            create("gallery", DATABASE_COPY.toolbar.defaultViewName("gallery", views.length + 1))
          }
        >
          {DATABASE_COPY.toolbar.newGallery}
        </Button>
        <Button
          type="button"
          size="compact"
          disabled={savingView || !hasCalendarDate}
          title={hasCalendarDate ? undefined : DATABASE_COPY.toolbar.calendarNeedsProperty}
          onClick={() =>
            create("calendar", DATABASE_COPY.toolbar.defaultViewName("calendar", views.length + 1))
          }
        >
          {DATABASE_COPY.toolbar.newCalendar}
        </Button>
        <Button
          type="button"
          size="compact"
          disabled={savingView}
          onClick={() => {
            const next = duplicateSavedView(
              definition,
              active,
              DATABASE_COPY.toolbar.copyName(active.name),
            );
            const created = activeViews(next).at(-1);
            void persist(next);
            if (created !== undefined) onSelectView(created.id);
          }}
        >
          {DATABASE_COPY.toolbar.duplicate}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={savingView || views[0]?.id === active.id}
          onClick={() => move(-1)}
        >
          {DATABASE_COPY.toolbar.moveEarlier}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={savingView || views.at(-1)?.id === active.id}
          onClick={() => move(1)}
        >
          {DATABASE_COPY.toolbar.moveLater}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="danger"
          disabled={savingView || views.length === 1}
          title={views.length === 1 ? DATABASE_COPY.toolbar.needsOneView : undefined}
          onClick={() => {
            const next = replaceSavedView(definition, { ...active, state: "retired" });
            const fallback = activeViews(next)[0];
            void persist(next);
            if (fallback !== undefined) onSelectView(fallback.id);
          }}
        >
          {DATABASE_COPY.toolbar.remove}
        </Button>
      </div>
      <RenameViewControl
        view={active}
        disabled={savingView}
        onRename={(name) => persist(replaceSavedView(definition, { ...active, name }))}
      />
      <details className="database-columns">
        <summary>{DATABASE_COPY.toolbar.visibleProperties}</summary>
        {presentations.map((presentation, index) => {
          const property = definition.properties.find(({ id }) => id === presentation.propertyId);
          return property === undefined ? null : (
            <div key={presentation.propertyId} className="database-column-control">
              <label>
                <input
                  type="checkbox"
                  checked={presentation.visible}
                  disabled={
                    savingView || property.type === "title" || savingVisibility.has(property.id)
                  }
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSavingVisibility((current) => new Set(current).add(property.id));
                    void Promise.resolve(
                      persist(
                        replaceSavedView(definition, {
                          ...active,
                          properties: active.properties.map((candidate) =>
                            candidate.propertyId === presentation.propertyId
                              ? { ...candidate, visible: checked }
                              : candidate,
                          ),
                        }),
                      ),
                    ).finally(() =>
                      setSavingVisibility((current) => {
                        const next = new Set(current);
                        next.delete(property.id);
                        return next;
                      }),
                    );
                  }}
                />
                {property.name}
              </label>
              <Button
                type="button"
                size="square"
                variant="ghost"
                aria-label={DATABASE_COPY.toolbar.moveColumnEarlier(property.name)}
                disabled={savingView || index === 0}
                onClick={() => moveProperty(property.id, -1)}
              >
                ←
              </Button>
              <Button
                type="button"
                size="square"
                variant="ghost"
                aria-label={DATABASE_COPY.toolbar.moveColumnLater(property.name)}
                disabled={savingView || index === presentations.length - 1}
                onClick={() => moveProperty(property.id, 1)}
              >
                →
              </Button>
            </div>
          );
        })}
      </details>
    </section>
  );
}
