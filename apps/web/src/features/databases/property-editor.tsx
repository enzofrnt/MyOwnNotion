import {
  DATABASE_PROPERTY_TYPES,
  type DatabaseProperty,
  type DatabasePropertyType,
  generateUuidV7,
} from "@myownnotion/domain";
import { type FormEvent, useId, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import { NativeInput } from "../../ui/primitives/native-input.tsx";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import {
  nextOptionTone,
  type OptionTone,
  OptionTonePicker,
  optionTone,
} from "./option-appearance.tsx";

export type EditablePropertyType = Exclude<DatabasePropertyType, "title">;

export interface PropertyOptionDraft {
  readonly key: string;
  readonly label: string;
  readonly tone: OptionTone;
}

export interface DatabasePropertyDraft {
  readonly name: string;
  readonly type: EditablePropertyType;
  readonly options?: readonly PropertyOptionDraft[];
  readonly dateMode?: "date" | "instant";
  readonly relationCardinality?: "one" | "many";
}

const CHOICE_PROPERTY_TYPES = ["status", "select", "multi-select"] as const;

function isChoiceType(type: EditablePropertyType): boolean {
  return (CHOICE_PROPERTY_TYPES as readonly string[]).includes(type);
}

/** One owner-facing type for a property whose values are named states. */
const PROPERTY_TYPE_CHOICES = DATABASE_PROPERTY_TYPES.filter(
  (type): type is EditablePropertyType =>
    type !== "title" && type !== "status" && type !== "multi-select",
);

export function defaultSelectionOptions(): PropertyOptionDraft[] {
  return [
    { key: generateUuidV7(), label: "Pas commencé", tone: "gray" },
    { key: generateUuidV7(), label: "En cours", tone: "blue" },
    { key: generateUuidV7(), label: "Terminé", tone: "green" },
  ];
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
  if (isChoiceType(draft.type)) {
    const labels = (draft.options ?? []).map((option) => option.label.trim()).filter(Boolean);
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
          options: (draft.options ?? [])
            .map((option) => ({ ...option, label: option.label.trim() }))
            .filter((option) => option.label.length > 0)
            .map((option, index) => ({
              id: generateUuidV7(),
              label: option.label,
              positionKey: `option-${String(index).padStart(6, "0")}`,
              tone: optionTone(option.tone),
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
  const type =
    rawType !== "title" && DATABASE_PROPERTY_TYPES.includes(rawType as DatabasePropertyType)
      ? (rawType as EditablePropertyType)
      : fallback.type;
  const common = {
    name: stringFormValue(data, "property-name", fallback.name),
    type,
  };

  if (isChoiceType(type)) {
    const keys = stringFormValue(data, "option-order", "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    return {
      ...common,
      options: keys.map((key) => ({
        key,
        label: stringFormValue(data, `option-label-${key}`, ""),
        tone: optionTone(stringFormValue(data, `option-tone-${key}`, "gray")),
      })),
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

function FormTonePicker({
  name,
  tone,
  onChange,
}: {
  readonly name: string;
  readonly tone: OptionTone;
  readonly onChange: (tone: OptionTone) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="hidden" name={name} defaultValue={tone} />
      <OptionTonePicker
        tone={tone}
        onChange={(next) => {
          if (inputRef.current !== null) inputRef.current.value = next;
          onChange(next);
        }}
      />
    </>
  );
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
  const fieldId = useId();
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

  const usesOptions = isChoiceType(visibleDraft.type);
  const optionRows = visibleDraft.options ?? [];

  return (
    <form
      ref={formRef}
      className="property-editor"
      aria-label={DATABASE_COPY.property.editor}
      onSubmit={submit}
    >
      <div className="property-editor__fields">
        <label className="property-editor__field" htmlFor={`${fieldId}-name`}>
          <span>{DATABASE_COPY.property.name}</span>
          <NativeInput
            type="text"
            density="compact"
            id={`${fieldId}-name`}
            name="property-name"
            defaultValue={visibleDraft.name}
            autoComplete="off"
            onChange={(event) =>
              changeDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label className="property-editor__field" htmlFor={`${fieldId}-type`}>
          <span>{DATABASE_COPY.property.type}</span>
          <NativeSelect
            density="compact"
            id={`${fieldId}-type`}
            name="property-type"
            defaultValue={visibleDraft.type}
            onChange={(event) =>
              changeDraft((current) => {
                const type = event.target.value as EditablePropertyType;
                if (!isChoiceType(type)) return { ...current, type };
                return {
                  ...current,
                  type,
                  options:
                    current.options !== undefined && current.options.length > 0
                      ? current.options
                      : defaultSelectionOptions(),
                };
              })
            }
          >
            {!PROPERTY_TYPE_CHOICES.includes(visibleDraft.type) ? (
              <option value={visibleDraft.type}>
                {DATABASE_COPY.property.typeLabels[visibleDraft.type]} (actuel)
              </option>
            ) : null}
            {PROPERTY_TYPE_CHOICES.map((type) => (
              <option key={type} value={type}>
                {DATABASE_COPY.property.typeLabels[type]}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>

      {usesOptions ? (
        <fieldset className="property-editor__options">
          <legend>{DATABASE_COPY.property.options}</legend>
          <input
            type="hidden"
            name="option-order"
            value={optionRows.map(({ key }) => key).join(",")}
          />
          <ul className="property-editor__option-list">
            {optionRows.map((option) => (
              <li key={option.key} className="property-editor__option-row">
                <NativeInput
                  density="compact"
                  name={`option-label-${option.key}`}
                  aria-label={DATABASE_COPY.property.optionName}
                  defaultValue={option.label}
                  onChange={(event) =>
                    changeDraft((current) => ({
                      ...current,
                      options: (current.options ?? optionRows).map((candidate) =>
                        candidate.key === option.key
                          ? { ...candidate, label: event.target.value }
                          : candidate,
                      ),
                    }))
                  }
                />
                <div className="property-editor__option-controls">
                  <FormTonePicker
                    name={`option-tone-${option.key}`}
                    tone={option.tone}
                    onChange={(tone) =>
                      changeDraft((current) => ({
                        ...current,
                        options: (current.options ?? optionRows).map((candidate) =>
                          candidate.key === option.key ? { ...candidate, tone } : candidate,
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    size="compact"
                    variant="ghost"
                    className="property-editor__remove-option"
                    aria-label={`${DATABASE_COPY.property.removeOption} ${option.label}`}
                    disabled={submitting}
                    onClick={() =>
                      changeDraft((current) => ({
                        ...current,
                        options: (current.options ?? optionRows).filter(
                          (candidate) => candidate.key !== option.key,
                        ),
                      }))
                    }
                  >
                    <AppIcon name="close" size="small" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            onClick={() =>
              changeDraft((current) => {
                const options = current.options ?? optionRows;
                return {
                  ...current,
                  options: [
                    ...options,
                    {
                      key: generateUuidV7(),
                      label: "",
                      tone: nextOptionTone(options.length),
                    },
                  ],
                };
              })
            }
            disabled={submitting}
          >
            <AppIcon name="add" size="small" />
            {DATABASE_COPY.property.addOption}
          </Button>
        </fieldset>
      ) : null}

      {visibleDraft.type === "date" ? (
        <label className="property-editor__field" htmlFor={`${fieldId}-date-mode`}>
          <span>{DATABASE_COPY.property.dateMode}</span>
          <NativeSelect
            id={`${fieldId}-date-mode`}
            density="compact"
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
          </NativeSelect>
        </label>
      ) : null}

      {visibleDraft.type === "relation" ? (
        <label className="property-editor__field" htmlFor={`${fieldId}-relation-cardinality`}>
          <span>{DATABASE_COPY.property.relationCardinality}</span>
          <NativeSelect
            id={`${fieldId}-relation-cardinality`}
            density="compact"
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
          </NativeSelect>
        </label>
      ) : null}

      {error !== null ? (
        <p className="property-editor__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="property-editor__actions">
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={onCancel}
          disabled={submitting}
        >
          {DATABASE_COPY.common.cancel}
        </Button>
        <StableActionButton
          type="submit"
          variant="primary"
          size="compact"
          disabled={submitting}
          onActivate={submitVisibleDraft}
        >
          {submitting ? DATABASE_COPY.common.savingLocally : DATABASE_COPY.property.save}
        </StableActionButton>
      </div>
    </form>
  );
}
