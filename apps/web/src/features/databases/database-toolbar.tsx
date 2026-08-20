import {
  type DatabaseDefinition,
  type DatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";

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
  type: "table" | "list",
  name: string,
): DatabaseDefinition {
  const views = activeViews(definition);
  const common = {
    ...source,
    id: generateUuidV7(),
    name,
    type,
    positionKey: `view-${String(views.length + 1).padStart(6, "0")}`,
    state: "active" as const,
  };
  const created: DatabaseView =
    type === "table"
      ? { ...common, type, options: { density: "comfortable", freezeTitle: true } }
      : {
          ...common,
          type,
          options: {
            density: "comfortable",
            secondaryPropertyIds: source.properties
              .filter(({ visible }) => visible)
              .map(({ propertyId }) => propertyId)
              .filter((propertyId) =>
                definition.properties.some(
                  (property) => property.id === propertyId && property.type !== "title",
                ),
              )
              .slice(0, 3),
          },
        };
  return { ...definition, views: [...definition.views, created] };
}

function RenameViewControl({
  view,
  onRename,
}: {
  readonly view: DatabaseView;
  readonly onRename: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(view.name);
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(view.name), [view.name]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalized = name.trim();
    if (normalized === "" || normalized === view.name) return;
    setSaving(true);
    void Promise.resolve(onRename(normalized)).finally(() => setSaving(false));
  };
  return (
    <form className="database-view-rename" onSubmit={submit}>
      <label>
        View name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="submit" disabled={saving || name.trim() === "" || name.trim() === view.name}>
        {saving ? "Renaming…" : "Rename view"}
      </button>
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
  const views = activeViews(definition);
  const active = views.find(({ id }) => id === activeViewId) ?? views[0];
  if (active === undefined) return <p role="alert">This database has no usable view.</p>;

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
    void onChange({
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
    void onChange(
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
    <section className="database-toolbar" aria-label="Saved database views">
      <div className="database-view-tabs" role="tablist" aria-label="Views">
        {views.map((view, index) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            data-view-id={view.id}
            aria-selected={view.id === active.id}
            tabIndex={view.id === active.id ? 0 : -1}
            onClick={() => onSelectView(view.id)}
            onKeyDown={(event) => selectAdjacent(event, index)}
          >
            {view.name} <span className="muted">{view.type}</span>
          </button>
        ))}
      </div>
      <div
        className="database-view-actions"
        role="toolbar"
        aria-label={`Actions for ${active.name}`}
      >
        <button
          type="button"
          onClick={() => {
            const next = createSavedView(definition, active, "table", `Table ${views.length + 1}`);
            const created = activeViews(next).at(-1);
            void onChange(next);
            if (created !== undefined) onSelectView(created.id);
          }}
        >
          New table view
        </button>
        <button
          type="button"
          onClick={() => {
            const next = createSavedView(definition, active, "list", `List ${views.length + 1}`);
            const created = activeViews(next).at(-1);
            void onChange(next);
            if (created !== undefined) onSelectView(created.id);
          }}
        >
          New list view
        </button>
        <button
          type="button"
          onClick={() => {
            const next = createSavedView(
              definition,
              active,
              active.type === "list" ? "list" : "table",
              `${active.name} copy`,
            );
            const created = activeViews(next).at(-1);
            void onChange(next);
            if (created !== undefined) onSelectView(created.id);
          }}
        >
          Duplicate view
        </button>
        <button type="button" disabled={views[0]?.id === active.id} onClick={() => move(-1)}>
          Move view earlier
        </button>
        <button type="button" disabled={views.at(-1)?.id === active.id} onClick={() => move(1)}>
          Move view later
        </button>
        <button
          type="button"
          disabled={views.length === 1}
          title={views.length === 1 ? "A database must keep one active view" : undefined}
          onClick={() => {
            const next = replaceSavedView(definition, { ...active, state: "retired" });
            const fallback = activeViews(next)[0];
            void onChange(next);
            if (fallback !== undefined) onSelectView(fallback.id);
          }}
        >
          Remove view
        </button>
      </div>
      <RenameViewControl
        view={active}
        onRename={(name) => onChange(replaceSavedView(definition, { ...active, name }))}
      />
      <details className="database-columns">
        <summary>Visible properties</summary>
        {presentations.map((presentation, index) => {
          const property = definition.properties.find(({ id }) => id === presentation.propertyId);
          return property === undefined ? null : (
            <div key={presentation.propertyId} className="database-column-control">
              <label>
                <input
                  type="checkbox"
                  checked={presentation.visible}
                  disabled={property.type === "title" || savingVisibility.has(property.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSavingVisibility((current) => new Set(current).add(property.id));
                    void Promise.resolve(
                      onChange(
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
              <button
                type="button"
                aria-label={`Move ${property.name} column earlier`}
                disabled={index === 0}
                onClick={() => moveProperty(property.id, -1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`Move ${property.name} column later`}
                disabled={index === presentations.length - 1}
                onClick={() => moveProperty(property.id, 1)}
              >
                →
              </button>
            </div>
          );
        })}
      </details>
    </section>
  );
}
