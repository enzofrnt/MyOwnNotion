import type { DatabaseEntryDto } from "@myownnotion/contracts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  NonRelationPropertyValue,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { type ReactNode, useMemo, useState } from "react";
import {
  type RelationOption,
  type ValueDraft,
  ValueEditor,
  validateValueDraft,
} from "./value-editor.tsx";

function initialDraft(property: DatabaseProperty, entry: DatabaseEntryDto): ValueDraft {
  if (property.type === "relation") return entry.relationTargets[property.id] ?? [];
  const value = entry.values[property.id] as NonRelationPropertyValue | undefined;
  if (value === undefined) {
    if (property.type === "checkbox") return false;
    if (property.type === "multi-select") return [];
    return "";
  }
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "status":
    case "select":
      return value.optionId;
    case "multi-select":
      return value.optionIds;
    case "checkbox":
      return value.checked;
  }
}

export function EntryPanel({
  entry,
  definition,
  relationOptions = [],
  pageContent,
  onSaveValues,
  onClose,
}: {
  readonly entry: DatabaseEntryDto;
  readonly definition: DatabaseDefinition;
  readonly relationOptions?: readonly RelationOption[];
  readonly pageContent?: ReactNode;
  readonly onSaveValues: (
    values: Readonly<Record<Uuid, NonRelationPropertyValue>>,
    relationTargets: RelationTargets,
  ) => void | Promise<void>;
  readonly onClose: () => void;
}) {
  const editableProperties = useMemo(
    () =>
      definition.properties.filter(
        (property) => property.state === "active" && property.type !== "title",
      ),
    [definition],
  );
  const taskProperties = useMemo(() => {
    const roles = definition.taskRoles;
    if (roles === null) return [];
    const configured = [
      ["status", roles.statusPropertyId],
      ["dueDate", roles.dueDatePropertyId],
      ["priority", roles.priorityPropertyId],
    ] as const;
    return configured.flatMap(([role, propertyId]) => {
      if (propertyId === null) return [];
      const property = editableProperties.find(({ id }) => id === propertyId);
      return property === undefined ? [] : [{ role, property }];
    });
  }, [definition.taskRoles, editableProperties]);
  const taskPropertyIds = useMemo(
    () => new Set(taskProperties.map(({ property }) => property.id)),
    [taskProperties],
  );
  const ordinaryProperties = useMemo(
    () => editableProperties.filter(({ id }) => !taskPropertyIds.has(id)),
    [editableProperties, taskPropertyIds],
  );
  const [drafts, setDrafts] = useState<Readonly<Record<string, ValueDraft>>>(() =>
    Object.fromEntries(
      editableProperties.map((property) => [property.id, initialDraft(property, entry)]),
    ),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const nextValues: Record<string, NonRelationPropertyValue> = {};
    const nextRelations: Record<string, readonly Uuid[]> = {};
    const nextErrors: Record<string, string> = {};
    for (const property of editableProperties) {
      const input =
        drafts[property.id] ??
        (property.type === "checkbox" ? false : property.type === "multi-select" ? [] : "");
      const result = validateValueDraft(property, input);
      if (!result.ok) {
        nextErrors[property.id] = result.error;
      } else if (result.value !== undefined) {
        nextValues[property.id] = result.value;
      } else if (result.relationTargets !== undefined) {
        nextRelations[property.id] = result.relationTargets;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaveError(null);
    setSaveConfirmation(null);
    setSaving(true);
    try {
      await onSaveValues(
        nextValues as Readonly<Record<Uuid, NonRelationPropertyValue>>,
        nextRelations as RelationTargets,
      );
      setSaveConfirmation("Properties saved locally.");
    } catch {
      setSaveError("The properties could not be saved. Your values are still here.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="entry-panel" aria-labelledby={`entry-heading-${entry.entryId}`}>
      <header className="database-panel__header">
        <div>
          <p className="muted">Database entry · page</p>
          <h2 id={`entry-heading-${entry.entryId}`}>{entry.title}</h2>
        </div>
        <button type="button" className="link" onClick={onClose}>
          Close entry
        </button>
      </header>

      <div className="entry-properties">
        {editableProperties.length === 0 ? (
          <p className="empty-state">This database has no additional properties yet.</p>
        ) : (
          <>
            {taskProperties.length === 0 ? null : (
              <section className="entry-task-properties" aria-label="Task tracking">
                <h3>Task tracking</h3>
                {taskProperties.map(({ role, property }) => (
                  <div key={role} data-task-role={role} className="entry-task-property">
                    <p className="muted">
                      {role === "status"
                        ? "Task status"
                        : role === "dueDate"
                          ? "Task due date"
                          : "Task priority"}
                    </p>
                    <ValueEditor
                      property={property}
                      input={
                        drafts[property.id] ??
                        (property.type === "checkbox"
                          ? false
                          : property.type === "multi-select"
                            ? []
                            : "")
                      }
                      error={errors[property.id] ?? null}
                      relationOptions={relationOptions.filter(
                        (option) => option.id !== entry.entryId,
                      )}
                      onChange={(input) => {
                        setDrafts((current) => ({ ...current, [property.id]: input }));
                        setSaveConfirmation(null);
                        setErrors((current) => {
                          const { [property.id]: _removed, ...remaining } = current;
                          return remaining;
                        });
                      }}
                    />
                  </div>
                ))}
              </section>
            )}
            {ordinaryProperties.length === 0 ? null : (
              <section className="entry-ordinary-properties" aria-label="Other properties">
                {ordinaryProperties.map((property) => (
                  <ValueEditor
                    key={property.id}
                    property={property}
                    input={
                      drafts[property.id] ??
                      (property.type === "checkbox"
                        ? false
                        : property.type === "multi-select"
                          ? []
                          : "")
                    }
                    error={errors[property.id] ?? null}
                    relationOptions={relationOptions.filter(
                      (option) => option.id !== entry.entryId,
                    )}
                    onChange={(input) => {
                      setDrafts((current) => ({ ...current, [property.id]: input }));
                      setSaveConfirmation(null);
                      setErrors((current) => {
                        const { [property.id]: _removed, ...remaining } = current;
                        return remaining;
                      });
                    }}
                  />
                ))}
              </section>
            )}
          </>
        )}
        <button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving locally…" : "Save properties"}
        </button>
        {saveConfirmation === null ? null : (
          <p role="status" data-testid="entry-properties-saved">
            {saveConfirmation}
          </p>
        )}
        {saveError !== null ? <p role="alert">{saveError}</p> : null}
      </div>

      <section className="entry-document" aria-label="Page content">
        <h3>Page content</h3>
        {pageContent ?? <p className="muted">The editorial document belongs to this same page.</p>}
      </section>
    </section>
  );
}
