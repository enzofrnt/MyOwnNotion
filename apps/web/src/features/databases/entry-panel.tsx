import type { DatabaseEntryDto } from "@myownnotion/contracts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  NonRelationPropertyValue,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
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
  // Pointer activation may run before React commits the render scheduled by
  // the last input event (observed on WebKit). Keep the authoritative draft in
  // a synchronously updated ref so Save can never submit the previous render's
  // value while the field already shows the owner's final text.
  const draftsRef = useRef(drafts);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);

  const updateDraft = (propertyId: Uuid, input: ValueDraft): void => {
    const next = { ...draftsRef.current, [propertyId]: input };
    draftsRef.current = next;
    setDrafts(next);
    setSaveConfirmation(null);
    setErrors((current) => {
      const { [propertyId]: _removed, ...remaining } = current;
      return remaining;
    });
  };

  const save = async (): Promise<void> => {
    if (saveInFlight.current) return;
    const nextValues: Record<string, NonRelationPropertyValue> = {};
    const nextRelations: Record<string, readonly Uuid[]> = {};
    const nextErrors: Record<string, string> = {};
    const currentDrafts = draftsRef.current;
    for (const property of editableProperties) {
      const input =
        currentDrafts[property.id] ??
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
    saveInFlight.current = true;
    setSaveError(null);
    setSaveConfirmation(null);
    setSaving(true);
    try {
      await onSaveValues(
        nextValues as Readonly<Record<Uuid, NonRelationPropertyValue>>,
        nextRelations as RelationTargets,
      );
      setSaveConfirmation(DATABASE_COPY.entry.saved);
    } catch {
      setSaveError(DATABASE_COPY.entry.saveFailed);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="entry-panel" aria-labelledby={`entry-heading-${entry.entryId}`}>
      <header className="database-panel__header">
        <div>
          <p className="muted">{DATABASE_COPY.entry.eyebrow}</p>
          <h2 id={`entry-heading-${entry.entryId}`}>{entry.title}</h2>
        </div>
        <button type="button" className="link" onClick={onClose}>
          {DATABASE_COPY.entry.close}
        </button>
      </header>

      <div className="entry-properties">
        {editableProperties.length === 0 ? (
          <p className="empty-state">{DATABASE_COPY.entry.noProperties}</p>
        ) : (
          <>
            {taskProperties.length === 0 ? null : (
              <section
                className="entry-task-properties"
                aria-label={DATABASE_COPY.entry.taskTracking}
              >
                <h3>{DATABASE_COPY.entry.taskTracking}</h3>
                {taskProperties.map(({ role, property }) => (
                  <div key={role} data-task-role={role} className="entry-task-property">
                    <p className="muted">
                      {role === "status"
                        ? DATABASE_COPY.entry.taskStatus
                        : role === "dueDate"
                          ? DATABASE_COPY.entry.taskDueDate
                          : DATABASE_COPY.entry.taskPriority}
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
                      onChange={(input) => updateDraft(property.id, input)}
                    />
                  </div>
                ))}
              </section>
            )}
            {ordinaryProperties.length === 0 ? null : (
              <section
                className="entry-ordinary-properties"
                aria-label={DATABASE_COPY.entry.otherProperties}
              >
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
                    onChange={(input) => updateDraft(property.id, input)}
                  />
                ))}
              </section>
            )}
          </>
        )}
        <StableActionButton type="button" onActivate={() => void save()} disabled={saving}>
          {saving ? DATABASE_COPY.common.savingLocally : DATABASE_COPY.entry.save}
        </StableActionButton>
        {saveConfirmation === null ? null : (
          <p role="status" data-testid="entry-properties-saved">
            {saveConfirmation}
          </p>
        )}
        {saveError !== null ? <p role="alert">{saveError}</p> : null}
      </div>

      <section className="entry-document" aria-label={DATABASE_COPY.entry.pageContent}>
        <h3>{DATABASE_COPY.entry.pageContent}</h3>
        {pageContent ?? <p className="muted">{DATABASE_COPY.entry.samePageDocument}</p>}
      </section>
    </section>
  );
}
