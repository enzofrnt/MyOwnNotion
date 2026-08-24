import {
  DATABASE_PROPERTY_TYPES,
  type DatabaseProperty,
  type DatabasePropertyType,
  generateUuidV7,
} from "@myownnotion/domain";
import { type FormEvent, useRef, useState } from "react";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";

export type EditablePropertyType = Exclude<DatabasePropertyType, "title">;

export interface DatabasePropertyDraft {
  readonly name: string;
  readonly type: EditablePropertyType;
  readonly optionsText?: string;
  readonly dateMode?: "date" | "instant";
  readonly relationCardinality?: "one" | "many";
}

export type PropertyDraftValidation =
  | {
      readonly ok: true;
      readonly draft: DatabasePropertyDraft;
      readonly normalizedName: string;
    }
  | { readonly ok: false; readonly draft: DatabasePropertyDraft; readonly error: string };

export function validatePropertyDraft(draft: DatabasePropertyDraft): PropertyDraftValidation {
  const normalizedName = draft.name.trim();
  if (normalizedName.length === 0) {
    return { ok: false, draft, error: DATABASE_COPY.property.nameRequired };
  }
  if (normalizedName.length > 512) {
    return { ok: false, draft, error: DATABASE_COPY.property.nameTooLong };
  }
  if (draft.type === "status" || draft.type === "select" || draft.type === "multi-select") {
    const labels = (draft.optionsText ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
      return { ok: false, draft, error: DATABASE_COPY.property.distinctOptions };
    }
  }
  return { ok: true, draft, normalizedName };
}

export function propertyFromDraft(
  validation: Extract<PropertyDraftValidation, { ok: true }>,
  positionKey: string,
): DatabaseProperty {
  const common = {
    id: generateUuidV7(),
    name: validation.normalizedName,
    positionKey,
    state: "active" as const,
  };
  const draft = validation.draft;
  switch (draft.type) {
    case "date":
      return { ...common, type: "date", config: { mode: draft.dateMode ?? "date" } };
    case "relation":
      return {
        ...common,
        type: "relation",
        config: { cardinality: draft.relationCardinality ?? "many" },
      };
    case "status":
    case "select":
    case "multi-select":
      return {
        ...common,
        type: draft.type,
        config: {
          options: (draft.optionsText ?? "")
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean)
            .map((label, index) => ({
              id: generateUuidV7(),
              label,
              positionKey: `option-${String(index).padStart(6, "0")}`,
              tone: "gray",
              state: "active" as const,
            })),
        },
      };
    case "text":
    case "number":
    case "checkbox":
      return { ...common, type: draft.type, config: {} };
  }
}

const EDITABLE_PROPERTY_TYPES = DATABASE_PROPERTY_TYPES.filter(
  (type): type is EditablePropertyType => type !== "title",
);

function stringFormValue(data: FormData, name: string, fallback: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : fallback;
}

/**
 * Captures one coherent property draft from the controls the owner submitted.
 *
 * React may not have committed the final controlled-input render before a
 * second browser event arrives. Reading the submitted form prevents that last
 * visible edit from being replaced by the previous render's draft.
 */
export function propertyDraftFromFormData(
  data: FormData,
  fallback: DatabasePropertyDraft,
): DatabasePropertyDraft {
  const rawType = stringFormValue(data, "property-type", fallback.type);
  const type = EDITABLE_PROPERTY_TYPES.includes(rawType as EditablePropertyType)
    ? (rawType as EditablePropertyType)
    : fallback.type;
  const common = {
    name: stringFormValue(data, "property-name", fallback.name),
    type,
  };

  if (type === "status" || type === "select" || type === "multi-select") {
    return {
      ...common,
      optionsText: stringFormValue(data, "property-options", fallback.optionsText ?? ""),
    };
  }
  if (type === "date") {
    const dateMode = stringFormValue(data, "property-date-mode", fallback.dateMode ?? "date");
    return { ...common, dateMode: dateMode === "instant" ? "instant" : "date" };
  }
  if (type === "relation") {
    const cardinality = stringFormValue(
      data,
      "property-relation-cardinality",
      fallback.relationCardinality ?? "many",
    );
    return { ...common, relationCardinality: cardinality === "one" ? "one" : "many" };
  }
  return common;
}

export function PropertyEditor({
  draft,
  error,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
}: {
  readonly draft: DatabasePropertyDraft;
  readonly error: string | null;
  readonly onChange: (draft: DatabasePropertyDraft) => void;
  readonly onSubmit: (draft: DatabasePropertyDraft) => void;
  readonly onCancel: () => void;
  readonly submitting?: boolean;
}) {
  // This draft belongs to the mounted form, not to synchronization-driven
  // parent renders. The controls are intentionally uncontrolled: WebKit can
  // paint an input event, receive a concurrent projection render, and only
  // then let React commit the corresponding state update. A controlled value
  // repaints the older draft in that gap and silently erases what is visibly in
  // the field. The ref gives event handlers one current draft while FormData
  // remains authoritative at submission.
  const [visibleDraft, setVisibleDraft] = useState(draft);
  const visibleDraftRef = useRef(draft);
  const changeDraft = (update: (current: DatabasePropertyDraft) => DatabasePropertyDraft): void => {
    const next = update(visibleDraftRef.current);
    visibleDraftRef.current = next;
    setVisibleDraft(next);
    onChange(next);
  };
  const formRef = useRef<HTMLFormElement>(null);
  const submitVisibleDraft = (): void => {
    const form = formRef.current;
    onSubmit(
      form === null
        ? visibleDraftRef.current
        : propertyDraftFromFormData(new FormData(form), visibleDraftRef.current),
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitVisibleDraft();
  };

  const usesOptions =
    visibleDraft.type === "status" ||
    visibleDraft.type === "select" ||
    visibleDraft.type === "multi-select";

  return (
    <form
      ref={formRef}
      className="property-editor"
      aria-label={DATABASE_COPY.property.editor}
      onSubmit={submit}
    >
      <div className="field-row">
        <label htmlFor="property-name">{DATABASE_COPY.property.name}</label>
        <input
          id="property-name"
          name="property-name"
          defaultValue={visibleDraft.name}
          autoComplete="off"
          onChange={(event) => changeDraft((current) => ({ ...current, name: event.target.value }))}
        />
        <label htmlFor="property-type">{DATABASE_COPY.property.type}</label>
        <select
          id="property-type"
          name="property-type"
          defaultValue={visibleDraft.type}
          onChange={(event) =>
            changeDraft((current) => ({
              ...current,
              type: event.target.value as EditablePropertyType,
            }))
          }
        >
          {EDITABLE_PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {DATABASE_COPY.property.typeLabels[type]}
            </option>
          ))}
        </select>
      </div>

      {usesOptions ? (
        <label className="database-field">
          {DATABASE_COPY.property.optionsSeparated}
          <input
            name="property-options"
            defaultValue={visibleDraft.optionsText ?? ""}
            placeholder={DATABASE_COPY.property.optionPlaceholder}
            onChange={(event) =>
              changeDraft((current) => ({ ...current, optionsText: event.target.value }))
            }
          />
        </label>
      ) : null}

      {visibleDraft.type === "date" ? (
        <label className="database-field">
          {DATABASE_COPY.property.dateMode}
          <select
            name="property-date-mode"
            defaultValue={visibleDraft.dateMode ?? "date"}
            onChange={(event) =>
              changeDraft((current) => ({
                ...current,
                dateMode: event.target.value as "date" | "instant",
              }))
            }
          >
            <option value="date">{DATABASE_COPY.property.calendarDate}</option>
            <option value="instant">{DATABASE_COPY.property.dateAndTime}</option>
          </select>
        </label>
      ) : null}

      {visibleDraft.type === "relation" ? (
        <label className="database-field">
          {DATABASE_COPY.property.relationCardinality}
          <select
            name="property-relation-cardinality"
            defaultValue={visibleDraft.relationCardinality ?? "many"}
            onChange={(event) =>
              changeDraft((current) => ({
                ...current,
                relationCardinality: event.target.value as "one" | "many",
              }))
            }
          >
            <option value="one">{DATABASE_COPY.property.onePage}</option>
            <option value="many">{DATABASE_COPY.property.manyPages}</option>
          </select>
        </label>
      ) : null}

      {error !== null ? <p role="alert">{error}</p> : null}
      <div className="field-row">
        <StableActionButton type="submit" disabled={submitting} onActivate={submitVisibleDraft}>
          {submitting ? DATABASE_COPY.common.savingLocally : DATABASE_COPY.property.save}
        </StableActionButton>
        <button type="button" className="link" onClick={onCancel} disabled={submitting}>
          {DATABASE_COPY.common.cancel}
        </button>
      </div>
    </form>
  );
}
