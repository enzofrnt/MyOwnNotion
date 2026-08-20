import {
  DATABASE_PROPERTY_TYPES,
  type DatabaseProperty,
  type DatabasePropertyType,
  generateUuidV7,
} from "@myownnotion/domain";
import type { FormEvent } from "react";

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
    return { ok: false, draft, error: "Give the property a name." };
  }
  if (normalizedName.length > 512) {
    return { ok: false, draft, error: "Property names must be 512 characters or fewer." };
  }
  if (draft.type === "status" || draft.type === "select" || draft.type === "multi-select") {
    const labels = (draft.optionsText ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
      return { ok: false, draft, error: "Each option needs a distinct label." };
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
    <form className="property-editor" aria-label="Property editor" onSubmit={submit}>
      <div className="field-row">
        <label htmlFor="property-name">Name</label>
        <input
          id="property-name"
          value={draft.name}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <label htmlFor="property-type">Type</label>
        <select
          id="property-type"
          value={draft.type}
          onChange={(event) =>
            onChange({ ...draft, type: event.target.value as EditablePropertyType })
          }
        >
          {EDITABLE_PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {usesOptions ? (
        <label className="database-field">
          Options, separated by commas
          <input
            value={draft.optionsText ?? ""}
            placeholder="Planned, In progress, Done"
            onChange={(event) => onChange({ ...draft, optionsText: event.target.value })}
          />
        </label>
      ) : null}

      {draft.type === "date" ? (
        <label className="database-field">
          Date precision
          <select
            value={draft.dateMode ?? "date"}
            onChange={(event) =>
              onChange({ ...draft, dateMode: event.target.value as "date" | "instant" })
            }
          >
            <option value="date">Calendar date</option>
            <option value="instant">Date and time</option>
          </select>
        </label>
      ) : null}

      {draft.type === "relation" ? (
        <label className="database-field">
          Allowed targets
          <select
            value={draft.relationCardinality ?? "many"}
            onChange={(event) =>
              onChange({
                ...draft,
                relationCardinality: event.target.value as "one" | "many",
              })
            }
          >
            <option value="one">One page</option>
            <option value="many">Many pages</option>
          </select>
        </label>
      ) : null}

      {error !== null ? <p role="alert">{error}</p> : null}
      <div className="field-row">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving locally…" : "Save property"}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
