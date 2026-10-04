import {
  type DatabaseDefinition,
  type DatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { columnPresentations, viewColumns } from "./view-columns.ts";

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

function VisibilityControl({
  name,
  visible,
  disabled,
  onChange,
}: {
  readonly name: string;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly onChange: (visible: boolean) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState(visible);
  const confirmed = useRef(visible);
  useLayoutEffect(() => {
    confirmed.current = visible;
    setChecked(visible);
  }, [visible]);
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.checked;
          setChecked(next);
          void onChange(next).then((saved) => {
            if (!saved) setChecked(confirmed.current);
          });
        }}
      />
      {name}
    </label>
  );
}

export function DatabaseToolbar({
  definition,
  activeViewId,
  onSelectView,
  onChange,
  singleView = false,
}: {
  readonly definition: DatabaseDefinition;
  readonly activeViewId: Uuid;
  readonly onSelectView: (viewId: Uuid) => void;
  readonly onChange: (definition: DatabaseDefinition) => void | Promise<void>;
  readonly singleView?: boolean;
}) {
  const [savingView, setSavingView] = useState(false);
  const [saveError, setSaveError] = useState(false);
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

  const persist = async (next: DatabaseDefinition): Promise<boolean> => {
    setSavingView(true);
    setSaveError(false);
    try {
      await onChange(next);
      return true;
    } catch {
      setSaveError(true);
      return false;
    } finally {
      setSavingView(false);
    }
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
  const moveProperty = (propertyId: Uuid, direction: -1 | 1): void => {
    const columns = [...viewColumns(definition.properties, active.properties)];
    const index = columns.findIndex((column) => column.property.id === propertyId);
    const target = index + direction;
    const moved = columns[index];
    const neighbor = columns[target];
    if (moved === undefined || neighbor === undefined) return;
    columns[index] = neighbor;
    columns[target] = moved;
    const keys = columns
      .map((column) => {
        const previous = active.properties.find((item) => item.propertyId === column.property.id);
        return previous?.positionKey ?? column.property.positionKey;
      })
      .sort((left, right) => left.localeCompare(right));
    void persist(
      replaceSavedView(definition, {
        ...active,
        properties: columns.map((column, position) => {
          const previous = active.properties.find((item) => item.propertyId === column.property.id);
          const positionKey = keys[position] ?? column.property.positionKey;
          return {
            propertyId: column.property.id,
            visible: column.property.type === "title" ? true : column.visible,
            positionKey,
            ...(previous?.width === undefined ? {} : { width: previous.width }),
          };
        }),
      }),
    );
  };

  if (singleView) {
    return (
      <section className="database-toolbar" aria-label="Format de la vue intégrée">
        {saveError ? (
          <AsyncState compact kind="error" description={DATABASE_COPY.toolbar.saveFailed} />
        ) : null}
        <label>
          Format
          <NativeSelect
            density="compact"
            aria-label="Format de la vue intégrée"
            value={active.type}
            disabled={savingView}
            onChange={(event) => {
              const type = event.target.value as DatabaseView["type"];
              const generated = createSavedView(definition, active, type, active.name);
              const converted = activeViews(generated).at(-1);
              if (converted === undefined || converted.id === active.id) return;
              void persist({
                ...definition,
                views: [
                  {
                    ...converted,
                    id: active.id,
                    name: active.name,
                    positionKey: active.positionKey,
                  },
                ],
              });
            }}
          >
            <option value="table">Tableau</option>
            <option value="board" disabled={!hasBoardAxis}>
              Kanban
            </option>
            <option value="gallery">Galerie</option>
            <option value="list">Liste</option>
            <option value="calendar" disabled={!hasCalendarDate}>
              Calendrier
            </option>
          </NativeSelect>
        </label>
        {hasBoardAxis ? null : <p className="muted">{DATABASE_COPY.toolbar.boardNeedsProperty}</p>}
        {hasCalendarDate ? null : (
          <p className="muted">{DATABASE_COPY.toolbar.calendarNeedsProperty}</p>
        )}
      </section>
    );
  }

  return (
    <section className="database-toolbar" aria-label={DATABASE_COPY.toolbar.savedViews}>
      {saveError ? (
        <AsyncState compact kind="error" description={DATABASE_COPY.toolbar.saveFailed} />
      ) : null}
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
        onRename={async (name) => {
          await persist(replaceSavedView(definition, { ...active, name }));
        }}
      />
      <details className="database-columns">
        <summary>{DATABASE_COPY.toolbar.visibleProperties}</summary>
        {viewColumns(definition.properties, active.properties).map((column, index, columns) => {
          const property = column.property;
          return (
            <div key={property.id} className="database-column-control">
              <VisibilityControl
                key={`${active.id}:${property.id}`}
                name={property.name}
                visible={column.visible}
                disabled={savingView || property.type === "title"}
                onChange={(visible) =>
                  persist(
                    replaceSavedView(definition, {
                      ...active,
                      properties: columnPresentations(
                        active.properties,
                        columns.map((candidate) =>
                          candidate.property.id === property.id
                            ? { ...candidate, visible }
                            : candidate,
                        ),
                      ),
                    }),
                  )
                }
              />
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
                disabled={savingView || index === columns.length - 1}
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
