import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type DatabaseDefinition,
  type DatabaseProperty,
  generateUuidV7,
  type PropertyOption,
  type Uuid,
} from "@myownnotion/domain";
import { useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button, MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import { mergeChoiceOptionEdits } from "./edit-entry-properties.ts";
import { isChoiceProperty } from "./option-appearance.tsx";
import {
  ENTRY_PROPERTY_TYPES,
  PropertyConfiguration,
  updateEntryProperty,
} from "./property-configuration.tsx";
import { DatabasePropertyIcon } from "./property-icon.tsx";
import type { EntryDrafts } from "./use-entry-autosave.ts";
import { type RelationOption, type ValueDraft, ValueEditor } from "./value-editor.tsx";

export type EntryDefinitionEdit = (
  edit: (definition: DatabaseDefinition) => DatabaseDefinition,
  confirmed?: boolean,
) => Promise<void>;
export function reorderEntryProperties(
  definition: DatabaseDefinition,
  id: Uuid,
  targetId: Uuid,
  edge: "before" | "after",
): DatabaseDefinition {
  const ordered = [...definition.properties].sort(
    (a, b) => a.positionKey.localeCompare(b.positionKey) || a.id.localeCompare(b.id),
  );
  const from = ordered.findIndex((p) => p.id === id),
    target = ordered.find((p) => p.id === targetId);
  if (from < 0 || target === undefined || id === targetId || ordered[from]?.type === "title")
    return definition;
  const moved = ordered.splice(from, 1)[0];
  if (moved === undefined) return definition;
  const at = ordered.findIndex((p) => p.id === targetId) + (edge === "after" ? 1 : 0);
  ordered.splice(Math.max(1, at), 0, moved);
  return {
    ...definition,
    properties: ordered.map((p, index) => ({
      ...p,
      positionKey: `property-${String(index).padStart(6, "0")}`,
    })),
  };
}
export function duplicateEntryProperty(
  definition: DatabaseDefinition,
  id: Uuid,
): DatabaseDefinition {
  const p = definition.properties.find((p) => p.id === id);
  if (p === undefined || p.type === "title") return definition;
  const names = new Set(definition.properties.map((p) => p.name));
  let name = `${p.name} (copie)`;
  for (let n = 2; names.has(name); n += 1) name = `${p.name} (copie ${n})`;
  const copy = {
    ...p,
    id: generateUuidV7(),
    name,
    positionKey: `${p.positionKey}-copy`,
    ...(isChoiceProperty(p)
      ? { config: { options: p.config.options.map((o) => ({ ...o, id: generateUuidV7() })) } }
      : {}),
  } as DatabaseProperty;
  return {
    ...definition,
    properties: [...definition.properties, copy],
    views: definition.views.map((v) => ({
      ...v,
      properties: [
        ...v.properties,
        { propertyId: copy.id, visible: true, positionKey: copy.positionKey },
      ],
    })),
  };
}

function PropertyRow({
  property,
  definition,
  draft,
  error,
  options,
  edit,
  onChange,
  onBlur,
  preview,
  dragActive,
}: {
  property: DatabaseProperty;
  definition: DatabaseDefinition;
  draft: ValueDraft;
  error: string | null;
  options: readonly RelationOption[];
  edit: EntryDefinitionEdit | undefined;
  onChange: (input: ValueDraft) => void;
  onBlur: () => void;
  preview: "before" | "after" | null;
  dragActive: boolean;
}) {
  const sortable = useSortable({ id: property.id, disabled: edit === undefined });
  const [config, setConfig] = useState<DOMRect | null>(null);
  const changed = (change: (p: DatabaseProperty) => DatabaseProperty) => {
    void edit?.((d) => updateEntryProperty(d, property.id, change)).catch(() => undefined);
  };
  const optionEdit = async (options: readonly PropertyOption[]) => {
    await edit?.((d) =>
      updateEntryProperty(d, property.id, (p) =>
        isChoiceProperty(p)
          ? {
              ...p,
              config: {
                options: mergeChoiceOptionEdits(
                  p.config.options,
                  isChoiceProperty(property) ? property.config.options : [],
                  options,
                ),
              },
            }
          : p,
      ),
    );
  };
  const duplicate = () => {
    setConfig(null);
    void edit?.((d) => duplicateEntryProperty(d, property.id)).catch(() => undefined);
  };
  const retire = () => {
    setConfig(null);
    changed((p) => ({ ...p, state: "retired" }));
  };
  const ordered = definition.properties
    .filter((p) => p.state === "active" && p.type !== "title")
    .sort((a, b) => a.positionKey.localeCompare(b.positionKey));
  const index = ordered.findIndex((p) => p.id === property.id);
  const move = (offset: number) => {
    const target = ordered[index + offset];
    if (target !== undefined)
      void edit?.((d) =>
        reorderEntryProperties(d, property.id, target.id, offset > 0 ? "after" : "before"),
      ).catch(() => undefined);
  };
  const role =
    definition.taskRoles?.statusPropertyId === property.id
      ? "status"
      : definition.taskRoles?.dueDatePropertyId === property.id
        ? "dueDate"
        : definition.taskRoles?.priorityPropertyId === property.id
          ? "priority"
          : undefined;
  const openConfig = (anchor: DOMRect) => setConfig(anchor);
  return (
    <fieldset
      ref={sortable.setNodeRef}
      aria-label={`Propriété ${property.name}`}
      className="entry-property-row"
      data-property-id={property.id}
      data-task-role={role}
      data-preview={preview ?? undefined}
      data-dragging={sortable.isDragging || undefined}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: dragActive ? undefined : sortable.transition,
      }}
      onContextMenu={(event) => {
        if (edit === undefined) return;
        event.preventDefault();
        openConfig(DOMRect.fromRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 }));
      }}
    >
      {role === undefined ? null : (
        <span className="ui-visually-hidden">
          {role === "status"
            ? DATABASE_COPY.entry.taskStatus
            : role === "dueDate"
              ? DATABASE_COPY.entry.taskDueDate
              : DATABASE_COPY.entry.taskPriority}
        </span>
      )}
      {edit === undefined ? null : (
        <Button
          ref={sortable.setActivatorNodeRef}
          className="entry-property-row__handle"
          size="square"
          variant="ghost"
          aria-label={`Déplacer ${property.name}`}
          title={`Déplacer ${property.name}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <AppIcon name="drag" size="small" />
        </Button>
      )}
      <ValueEditor
        property={property}
        presentation="entry"
        input={draft}
        error={error}
        relationOptions={options}
        onChange={onChange}
        onBlur={onBlur}
        onChangeOptions={edit === undefined ? undefined : optionEdit}
        {...(edit === undefined
          ? {}
          : {
              labelContent: (
                <Button
                  variant="ghost"
                  size="compact"
                  className="entry-property-row__label"
                  aria-label={`Modifier la propriété ${property.name}`}
                  aria-haspopup="dialog"
                  aria-expanded={config !== null}
                  onClick={(event) => openConfig(event.currentTarget.getBoundingClientRect())}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openConfig(
                      DOMRect.fromRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 }),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      openConfig(event.currentTarget.getBoundingClientRect());
                    }
                  }}
                >
                  <DatabasePropertyIcon type={property.type} icon={property.icon} />
                  <span>{property.name}</span>
                </Button>
              ),
            })}
      />
      {edit === undefined ? null : (
        <PropertyConfiguration
          property={property}
          anchor={config}
          open={config !== null}
          onClose={() => setConfig(null)}
          onChange={changed}
          onOptions={(options) => void optionEdit(options).catch(() => undefined)}
          onDuplicate={duplicate}
          onRetire={retire}
          onMove={move}
          moveUpDisabled={index <= 0}
          moveDownDisabled={index < 0 || index >= ordered.length - 1}
        />
      )}
    </fieldset>
  );
}

export function EntryPropertyList({
  definition,
  drafts,
  errors,
  options,
  edit,
  onChange,
  onBlur,
}: {
  definition: DatabaseDefinition;
  drafts: EntryDrafts;
  errors: Readonly<Record<string, string>>;
  options: readonly RelationOption[];
  edit?: EntryDefinitionEdit | undefined;
  onChange: (property: DatabaseProperty, input: ValueDraft) => void;
  onBlur: () => void;
}) {
  const properties = definition.properties
    .filter((p) => p.state === "active" && p.type !== "title")
    .sort((a, b) => a.positionKey.localeCompare(b.positionKey) || a.id.localeCompare(b.id));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [drag, setDrag] = useState<{ id: Uuid; over: Uuid | null } | null>(null);
  const from = properties.findIndex((p) => p.id === drag?.id),
    to = properties.findIndex((p) => p.id === drag?.over);
  const create = (type: (typeof ENTRY_PROPERTY_TYPES)[number]) => {
    const property: DatabaseProperty = {
      id: generateUuidV7(),
      name: DATABASE_COPY.property.typeLabels[type].replace(/^./, (c) => c.toUpperCase()),
      positionKey: `z-${generateUuidV7()}`,
      state: "active",
      type,
      config:
        type === "date"
          ? { mode: "date" }
          : type === "relation"
            ? { cardinality: "many" }
            : type === "select"
              ? { options: [] }
              : {},
    } as DatabaseProperty;
    void edit?.((d) => ({
      ...d,
      properties: [...d.properties, property],
      views: d.views.map((v) => ({
        ...v,
        properties: [
          ...v.properties,
          { propertyId: property.id, visible: true, positionKey: property.positionKey },
        ],
      })),
    })).catch(() => undefined);
  };
  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Appuyez sur Espace pour déplacer la propriété, puis utilisez les flèches. Espace dépose, Échap annule.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Déplacement de ${properties.find((p) => p.id === active.id)?.name ?? "la propriété"}.`,
            onDragOver: ({ active, over }) => {
              const target = properties.find((p) => p.id === over?.id);
              if (target === undefined || active.id === over?.id) return;
              const from = properties.findIndex((p) => p.id === active.id);
              const to = properties.findIndex((p) => p.id === over?.id);
              return `${from < to ? "Après" : "Avant"} ${target.name}.`;
            },
            onDragEnd: () => "Propriété déposée.",
            onDragCancel: () => "Déplacement annulé. L’ordre est conservé.",
          },
        }}
        onDragStart={(event) => setDrag({ id: event.active.id as Uuid, over: null })}
        onDragOver={(event) =>
          setDrag((current) =>
            current === null ? null : { ...current, over: (event.over?.id as Uuid) ?? null },
          )
        }
        onDragCancel={() => setDrag(null)}
        onDragEnd={(event) => {
          setDrag(null);
          if (event.over === null || event.active.id === event.over.id) return;
          const from = properties.findIndex((p) => p.id === event.active.id),
            to = properties.findIndex((p) => p.id === event.over?.id);
          void edit?.((d) =>
            reorderEntryProperties(
              d,
              event.active.id as Uuid,
              event.over?.id as Uuid,
              from < to ? "after" : "before",
            ),
          ).catch(() => undefined);
        }}
      >
        <SortableContext items={properties.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <section
            className="entry-ordinary-properties"
            aria-label={
              definition.taskRoles === null
                ? DATABASE_COPY.entry.otherProperties
                : DATABASE_COPY.entry.taskTracking
            }
          >
            {properties.map((p) => (
              <PropertyRow
                key={p.id}
                property={p}
                definition={definition}
                draft={
                  drafts[p.id] ??
                  (p.type === "checkbox"
                    ? false
                    : p.type === "multi-select" || p.type === "relation"
                      ? []
                      : "")
                }
                error={errors[p.id] ?? null}
                options={options}
                edit={edit}
                onChange={(input) => onChange(p, input)}
                onBlur={onBlur}
                dragActive={drag !== null}
                preview={
                  drag?.over === p.id && from !== to ? (from < to ? "after" : "before") : null
                }
              />
            ))}
          </section>
        </SortableContext>
      </DndContext>
      {edit === undefined ? null : (
        <MenuRoot>
          <MenuTrigger bare className="entry-properties__add">
            <AppIcon name="add" size="small" />
            Ajouter une propriété
          </MenuTrigger>
          <MenuContent
            className="property-settings__menu"
            unmountOnHide
            aria-label="Ajouter une propriété"
          >
            {ENTRY_PROPERTY_TYPES.map((type) => (
              <MenuItem key={type} onClick={() => create(type)}>
                <DatabasePropertyIcon type={type} />
                {DATABASE_COPY.property.typeLabels[type]}
              </MenuItem>
            ))}
          </MenuContent>
        </MenuRoot>
      )}
    </>
  );
}
