import {
  DATABASE_PROPERTY_TYPES,
  type DatabaseProperty,
  type DatabasePropertyType,
  generateUuidV7,
} from "@myownnotion/domain";
import type { FormEvent } from "react";
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
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly submitting?: boolean;
}) {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  const usesOptions =
    draft.type === "status" || draft.type === "select" || draft.type === "multi-select";

  return (
    <form className="property-editor" aria-label={DATABASE_COPY.property.editor} onSubmit={submit}>
      <div className="field-row">
        <label htmlFor="property-name">{DATABASE_COPY.property.name}</label>
        <input
          id="property-name"
          value={draft.name}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <label htmlFor="property-type">{DATABASE_COPY.property.type}</label>
        <select
          id="property-type"
          value={draft.type}
          onChange={(event) =>
            onChange({ ...draft, type: event.target.value as EditablePropertyType })
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
            value={draft.optionsText ?? ""}
            placeholder={DATABASE_COPY.property.optionPlaceholder}
            onChange={(event) => onChange({ ...draft, optionsText: event.target.value })}
          />
        </label>
      ) : null}

      {draft.type === "date" ? (
        <label className="database-field">
          {DATABASE_COPY.property.dateMode}
          <select
            value={draft.dateMode ?? "date"}
            onChange={(event) =>
              onChange({ ...draft, dateMode: event.target.value as "date" | "instant" })
            }
          >
            <option value="date">{DATABASE_COPY.property.calendarDate}</option>
            <option value="instant">{DATABASE_COPY.property.dateAndTime}</option>
          </select>
        </label>
      ) : null}

      {draft.type === "relation" ? (
        <label className="database-field">
          {DATABASE_COPY.property.relationCardinality}
          <select
            value={draft.relationCardinality ?? "many"}
            onChange={(event) =>
              onChange({
                ...draft,
                relationCardinality: event.target.value as "one" | "many",
              })
            }
          >
            <option value="one">{DATABASE_COPY.property.onePage}</option>
            <option value="many">{DATABASE_COPY.property.manyPages}</option>
          </select>
        </label>
      ) : null}

      {error !== null ? <p role="alert">{error}</p> : null}
      <div className="field-row">
        <StableActionButton type="submit" disabled={submitting} onActivate={onSubmit}>
          {submitting ? DATABASE_COPY.common.savingLocally : DATABASE_COPY.property.save}
        </StableActionButton>
        <button type="button" className="link" onClick={onCancel} disabled={submitting}>
          {DATABASE_COPY.common.cancel}
        </button>
      </div>
    </form>
  );
}
