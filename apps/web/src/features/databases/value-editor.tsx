import {
  type DatabaseProperty,
  isUuid,
  type NonRelationPropertyValue,
  normalizeCivilDate,
  normalizeDecimal,
  normalizeInstant,
  type PropertyOption,
  type Uuid,
} from "@myownnotion/domain";
import { type InputHTMLAttributes, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui/primitives/button.tsx";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { EntryChoicePicker } from "./entry-choice-picker.tsx";
import { isChoiceProperty } from "./option-appearance.tsx";
import { DatabasePropertyIcon } from "./property-icon.tsx";
import { RelationDraftMenu } from "./relation-value-menu.tsx";

export type ValueDraft = string | boolean | readonly string[];
export type ValueDraftValidation =
  | {
      readonly ok: true;
      readonly input: ValueDraft;
      readonly value?: NonRelationPropertyValue;
      readonly relationTargets?: readonly Uuid[];
    }
  | { readonly ok: false; readonly input: ValueDraft; readonly error: string };

export function validateValueDraft(
  property: DatabaseProperty,
  input: ValueDraft,
): ValueDraftValidation {
  if (property.type === "title") {
    return { ok: false, input, error: DATABASE_COPY.value.titleOnPage };
  }
  if (property.type === "checkbox") {
    return typeof input === "boolean"
      ? { ok: true, input, value: { kind: "checkbox", checked: input } }
      : { ok: false, input, error: DATABASE_COPY.value.chooseChecked };
  }
  if (property.type === "multi-select") {
    if (!Array.isArray(input)) {
      return { ok: false, input, error: DATABASE_COPY.value.chooseOptions };
    }
    const active = new Set(
      property.config.options
        .filter((option) => option.state === "active")
        .map((option) => option.id),
    );
    if (!input.every((optionId) => isUuid(optionId) && active.has(optionId))) {
      return { ok: false, input, error: DATABASE_COPY.value.staleOption };
    }
    return {
      ok: true,
      input,
      value: { kind: "multi-select", optionIds: [...input].sort() as Uuid[] },
    };
  }
  if (property.type === "relation") {
    if (!Array.isArray(input) || !input.every(isUuid)) {
      return { ok: false, input, error: DATABASE_COPY.value.choosePage };
    }
    if (property.config.cardinality === "one" && input.length > 1) {
      return { ok: false, input, error: DATABASE_COPY.value.onePageOnly };
    }
    return { ok: true, input, relationTargets: [...new Set(input)].sort() as Uuid[] };
  }
  if (typeof input !== "string") {
    return { ok: false, input, error: DATABASE_COPY.value.enter };
  }
  if (input.length === 0 && property.type !== "text") return { ok: true, input };
  if (property.type === "text") return { ok: true, input, value: { kind: "text", value: input } };
  if (property.type === "number") {
    if (input.includes(",")) {
      return { ok: false, input, error: DATABASE_COPY.value.decimalDot };
    }
    const result = normalizeDecimal(input);
    return result.ok
      ? { ok: true, input, value: { kind: "number", decimal: result.value } }
      : { ok: false, input, error: DATABASE_COPY.value.decimalExample };
  }
  if (property.type === "date") {
    const result =
      property.config.mode === "date" ? normalizeCivilDate(input) : normalizeInstant(input);
    if (!result.ok) {
      return {
        ok: false,
        input,
        error:
          property.config.mode === "date"
            ? DATABASE_COPY.value.realDate
            : DATABASE_COPY.value.zonedDate,
      };
    }
    return property.config.mode === "date"
      ? { ok: true, input, value: { kind: "date", date: result.value } }
      : { ok: true, input, value: { kind: "instant", instant: result.value } };
  }
  if (property.type === "status" || property.type === "select") {
    if (input === "") return { ok: true, input };
    if (!isUuid(input)) {
      return { ok: false, input, error: DATABASE_COPY.value.chooseOption };
    }
    const option = property.config.options.find(
      (candidate) => candidate.id === input && candidate.state === "active",
    );
    return option === undefined
      ? { ok: false, input, error: DATABASE_COPY.value.unavailableOption }
      : { ok: true, input, value: { kind: property.type, optionId: option.id } };
  }
  return { ok: false, input, error: DATABASE_COPY.value.unsupported };
}

export interface RelationOption {
  readonly id: Uuid;
  readonly label: string;
}

/** Native date-time controls show local time; persistence keeps a zoned instant. */
function localDateTimeInput(instant: string): string {
  if (instant === "") return "";
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, -1);
}

/** Preserve a native edit that arrives just before React receives its input event. */
function DraftTextInput({
  value,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & {
  readonly value: string;
}) {
  const elementRef = useRef<HTMLInputElement>(null);
  const projectedValue = useRef(value);
  const caretPlaced = useRef(false);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element !== null && element.value === projectedValue.current) element.value = value;
    projectedValue.current = value;
  }, [value]);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element === null || props.autoFocus !== true || caretPlaced.current) return;
    caretPlaced.current = true;
    // Place the initial caret once. A later frame would undo a selection
    // or native edit made before React receives the next input event.
    element.focus();
    if (element.selectionStart !== null) {
      const end = element.value.length;
      element.setSelectionRange(end, end);
    }
  }, [props.autoFocus]);
  return <input {...props} ref={elementRef} defaultValue={value} />;
}

export function ValueEditor({
  property,
  input,
  error,
  relationOptions = [],
  idSuffix,
  presentation = "field",
  onBlur,
  labelContent,
  onChangeOptions,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly input: ValueDraft;
  readonly error: string | null;
  readonly relationOptions?: readonly RelationOption[];
  readonly idSuffix?: string;
  readonly presentation?: "field" | "inline" | "entry" | "card";
  readonly onBlur?: () => void;
  readonly labelContent?: React.ReactNode;
  readonly onChangeOptions?: ((options: readonly PropertyOption[]) => Promise<void>) | undefined;
  readonly onChange: (input: ValueDraft) => void;
}) {
  const entryPresentation = presentation === "entry" || presentation === "card";
  const [editingCardDate, setEditingCardDate] = useState(false);
  const suffix = idSuffix === undefined ? "" : `-${idSuffix}`;
  const errorId = `database-value-error-${property.id}${suffix}`;
  const controlId = `database-value-${property.id}${suffix}`;
  const describedBy = error === null ? undefined : errorId;
  const inlineLabel =
    presentation === "inline" || presentation === "card" || labelContent !== undefined
      ? property.name
      : undefined;
  let control: React.ReactNode;

  if (presentation === "card" && property.type === "date" && input === "" && !editingCardDate) {
    control = (
      <Button
        id={controlId}
        className="option-menu__trigger"
        size="compact"
        variant="ghost"
        aria-label={property.name}
        aria-describedby={describedBy}
        onClick={() => setEditingCardDate(true)}
      >
        <span className="option-menu__empty">Ajouter {property.name}</span>
      </Button>
    );
  } else if (property.type === "checkbox") {
    const checkbox = (
      <input
        id={controlId}
        type="checkbox"
        checked={typeof input === "boolean" && input}
        aria-label={entryPresentation ? property.name : inlineLabel}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
    control = entryPresentation ? (
      <label className="entry-checkbox-control" htmlFor={controlId}>
        {checkbox}
      </label>
    ) : (
      checkbox
    );
  } else if (entryPresentation && isChoiceProperty(property)) {
    control = (
      <EntryChoicePicker
        property={property}
        input={input}
        id={controlId}
        describedBy={describedBy}
        emptyLabel={presentation === "card" ? `Ajouter ${property.name}` : undefined}
        invalid={error !== null}
        onChange={onChange}
        onOptions={onChangeOptions}
      />
    );
  } else if (
    property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
  ) {
    control = (
      <NativeSelect
        density="compact"
        id={controlId}
        multiple={property.type === "multi-select"}
        value={property.type === "multi-select" ? (input as readonly string[]) : String(input)}
        aria-label={inlineLabel}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) =>
          onChange(
            property.type === "multi-select"
              ? [...event.target.selectedOptions].map((option) => option.value)
              : event.target.value,
          )
        }
      >
        {property.type !== "multi-select" ? (
          <option value="">{DATABASE_COPY.common.noValue}</option>
        ) : null}
        {property.config.options
          .filter((option) => option.state === "active")
          .map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </NativeSelect>
    );
  } else if (property.type === "relation" && entryPresentation) {
    control = (
      <RelationDraftMenu
        property={property}
        input={input}
        options={relationOptions}
        emptyLabel={presentation === "card" ? `Ajouter ${property.name}` : undefined}
        id={controlId}
        {...(describedBy === undefined ? {} : { describedBy })}
        onChange={onChange}
      />
    );
  } else if (property.type === "relation") {
    control = (
      <NativeSelect
        density="compact"
        id={controlId}
        multiple={property.config.cardinality === "many"}
        value={
          property.config.cardinality === "many" ? (input as readonly string[]) : String(input)
        }
        aria-label={inlineLabel}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) => {
          const selected = [...event.target.selectedOptions].map((option) => option.value);
          onChange(property.config.cardinality === "one" ? selected.slice(0, 1) : selected);
        }}
      >
        {property.config.cardinality === "one" ? (
          <option value="">{DATABASE_COPY.common.noPage}</option>
        ) : null}
        {relationOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    );
  } else {
    const localInstant =
      entryPresentation && property.type === "date" && property.config.mode === "instant";
    control = (
      <DraftTextInput
        id={controlId}
        type={
          property.type === "date" && property.config.mode === "date"
            ? "date"
            : localInstant
              ? "datetime-local"
              : "text"
        }
        step={localInstant ? "any" : undefined}
        autoFocus={presentation === "inline" || editingCardDate}
        className={presentation === "inline" ? "database-cell-inline-input" : "ui-native-input"}
        data-size={presentation !== "inline" ? "compact" : undefined}
        inputMode={property.type === "number" ? "decimal" : undefined}
        value={typeof input === "string" ? (localInstant ? localDateTimeInput(input) : input) : ""}
        placeholder={
          presentation !== "field" && property.type !== "date"
            ? presentation === "card"
              ? `Ajouter ${property.name}`
              : DATABASE_COPY.value.emptyPlaceholder
            : undefined
        }
        aria-label={inlineLabel}
        aria-describedby={describedBy}
        onBlur={() => {
          if (input === "") setEditingCardDate(false);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.currentTarget.blur();
          }
        }}
        onInput={(event) => {
          // Read every native input event, including a date-picker edit after
          // a projected value was written to this uncontrolled control.
          const value = event.currentTarget.value;
          onChange(localInstant && value !== "" ? new Date(value).toISOString() : value);
        }}
      />
    );
  }

  return (
    <div
      className={
        presentation === "inline"
          ? "database-cell-inline-field"
          : entryPresentation
            ? `database-field database-field--entry${presentation === "card" ? " database-field--card" : ""}`
            : "database-field"
      }
    >
      {presentation === "inline"
        ? null
        : (labelContent ?? (
            <label htmlFor={controlId}>
              {entryPresentation ? (
                <DatabasePropertyIcon type={property.type} icon={property.icon} />
              ) : null}
              {presentation === "card" ? (
                <span className="sr-only">{property.name}</span>
              ) : (
                property.name
              )}
            </label>
          ))}
      {control}
      {presentation === "card" && property.type === "checkbox" ? (
        <label htmlFor={controlId} className="database-card-editor__checkbox-name">
          {property.name}
        </label>
      ) : null}
      {error !== null ? (
        <span id={errorId} className="database-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
