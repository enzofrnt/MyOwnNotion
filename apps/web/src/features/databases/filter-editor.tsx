import {
  type DatabaseFilterOperand,
  type DatabaseProperty,
  type DatabaseView,
  type FilterCriterion,
  type FilterOperator,
  type FilterSet,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";
import { DATABASE_COPY } from "./database-copy.ts";

function operators(property: DatabaseProperty): readonly FilterOperator[] {
  const common: FilterOperator[] = ["equals", "not-equals", "is-empty", "is-not-empty"];
  if (
    property.type === "title" ||
    property.type === "text" ||
    property.type === "multi-select" ||
    property.type === "relation"
  ) {
    common.push("contains", "not-contains");
  }
  if (property.type === "date") common.push("before", "after", "between");
  if (property.type === "number") common.push("less-than", "greater-than");
  return common;
}

function defaultOperator(property: DatabaseProperty): FilterOperator {
  return property.type === "title" || property.type === "text" ? "contains" : "is-not-empty";
}

function instantFromControl(value: string): string {
  if (value === "") return "";
  const instant = new Date(`${value}:00.000Z`);
  return Number.isNaN(instant.getTime()) ? value : instant.toISOString();
}

function instantToControl(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : instant.toISOString().slice(0, 16);
}

function operandFromInput(
  property: DatabaseProperty,
  operator: FilterOperator,
  value: string,
): DatabaseFilterOperand | undefined {
  if (operator === "is-empty" || operator === "is-not-empty") return undefined;
  switch (property.type) {
    case "title":
    case "text":
      return { kind: "text", value };
    case "number":
      return { kind: "number", decimal: value || "0" };
    case "date":
      return property.config.mode === "date"
        ? { kind: "date", date: value }
        : { kind: "instant", instant: instantFromControl(value) };
    case "status":
      return { kind: "status", optionId: value as Uuid };
    case "select":
      return { kind: "select", optionId: value as Uuid };
    case "multi-select":
      return { kind: "multi-select", optionIds: value === "" ? [] : [value as Uuid] };
    case "checkbox":
      return { kind: "checkbox", checked: value === "true" };
    case "relation":
      return { kind: "relation", targetIds: value === "" ? [] : [value as Uuid] };
  }
}

function inputValue(operand: DatabaseFilterOperand | undefined): string {
  if (operand === undefined) return "";
  switch (operand.kind) {
    case "text":
      return operand.value;
    case "number":
      return operand.decimal;
    case "date":
      return operand.date;
    case "instant":
      return instantToControl(operand.instant);
    case "status":
    case "select":
      return operand.optionId;
    case "multi-select":
      return operand.optionIds[0] ?? "";
    case "checkbox":
      return String(operand.checked);
    case "relation":
      return operand.targetIds[0] ?? "";
    case "date-range":
    case "instant-range":
      return "";
  }
}

function rangeInputValues(
  property: Extract<DatabaseProperty, { readonly type: "date" }>,
  operand: DatabaseFilterOperand | undefined,
): readonly [string, string] {
  if (property.config.mode === "date" && operand?.kind === "date-range") {
    return [operand.from.date, operand.to.date];
  }
  if (property.config.mode === "instant" && operand?.kind === "instant-range") {
    return [instantToControl(operand.from.instant), instantToControl(operand.to.instant)];
  }
  return ["", ""];
}

function rangeOperandFromInputs(
  property: Extract<DatabaseProperty, { readonly type: "date" }>,
  from: string,
  to: string,
): DatabaseFilterOperand {
  return property.config.mode === "date"
    ? {
        kind: "date-range",
        from: { kind: "date", date: from },
        to: { kind: "date", date: to },
      }
    : {
        kind: "instant-range",
        from: { kind: "instant", instant: instantFromControl(from) },
        to: { kind: "instant", instant: instantFromControl(to) },
      };
}

function OperandEditor({
  property,
  criterion,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly criterion: FilterCriterion;
  readonly onChange: (operand: DatabaseFilterOperand | undefined) => void;
}) {
  if (criterion.operator === "is-empty" || criterion.operator === "is-not-empty") return null;
  if (property.type === "date" && criterion.operator === "between") {
    const [from, to] = rangeInputValues(property, criterion.operand);
    const inputType = property.config.mode === "date" ? "date" : "datetime-local";
    const timezone = property.config.mode === "instant" ? " (UTC)" : "";
    return (
      <fieldset className="database-filter-period">
        <legend>{DATABASE_COPY.filter.periodFor(property.name)}</legend>
        <label>
          {DATABASE_COPY.filter.from}
          {timezone}
          <input
            aria-label={DATABASE_COPY.filter.fromFor(property.name, timezone)}
            type={inputType}
            value={from}
            max={to || undefined}
            onChange={(event) => onChange(rangeOperandFromInputs(property, event.target.value, to))}
          />
        </label>
        <label>
          {DATABASE_COPY.filter.to}
          {timezone}
          <input
            aria-label={DATABASE_COPY.filter.toFor(property.name, timezone)}
            type={inputType}
            value={to}
            min={from || undefined}
            onChange={(event) =>
              onChange(rangeOperandFromInputs(property, from, event.target.value))
            }
          />
        </label>
      </fieldset>
    );
  }
  const value = inputValue(criterion.operand);
  if (
    property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
  ) {
    return (
      <select
        aria-label={DATABASE_COPY.filter.valueFor(property.name)}
        value={value}
        onChange={(event) =>
          onChange(operandFromInput(property, criterion.operator, event.target.value))
        }
      >
        <option value="">{DATABASE_COPY.filter.chooseOption}</option>
        {property.config.options
          .filter(({ state }) => state === "active")
          .map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </select>
    );
  }
  if (property.type === "checkbox") {
    return (
      <select
        aria-label={DATABASE_COPY.filter.valueFor(property.name)}
        value={value || "false"}
        onChange={(event) =>
          onChange(operandFromInput(property, criterion.operator, event.target.value))
        }
      >
        <option value="false">{DATABASE_COPY.filter.notChecked}</option>
        <option value="true">{DATABASE_COPY.filter.checked}</option>
      </select>
    );
  }
  return (
    <input
      aria-label={DATABASE_COPY.filter.valueFor(property.name)}
      type={
        property.type === "number"
          ? "text"
          : property.type === "date" && property.config.mode === "instant"
            ? "datetime-local"
            : property.type === "date"
              ? "date"
              : "text"
      }
      value={value}
      placeholder={
        property.type === "relation"
          ? DATABASE_COPY.filter.pageIdentity
          : DATABASE_COPY.filter.value
      }
      onChange={(event) =>
        onChange(operandFromInput(property, criterion.operator, event.target.value))
      }
    />
  );
}

export function FilterEditor({
  properties,
  view,
  onChange,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly onChange: (view: DatabaseView) => void | Promise<void>;
}) {
  const activeProperties = properties.filter(({ state }) => state === "active");
  const [draft, setDraft] = useState<FilterSet>(view.filter);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const pendingSignature = useRef<string | null>(null);
  const updateDraft = (update: (current: FilterSet) => FilterSet): void => {
    setDraft((current) => {
      const next = update(current);
      draftRef.current = next;
      dirty.current = true;
      return next;
    });
  };
  useEffect(() => {
    const incomingSignature = JSON.stringify(view.filter);
    if (pendingSignature.current !== null) {
      if (pendingSignature.current === incomingSignature) {
        pendingSignature.current = null;
        if (JSON.stringify(draftRef.current) === incomingSignature) dirty.current = false;
      }
      return;
    }
    if (dirty.current) return;
    draftRef.current = view.filter;
    setDraft(view.filter);
  }, [view.filter]);
  const update = (
    criterionId: Uuid,
    change: Partial<Omit<FilterCriterion, "operand">> & {
      readonly operand?: DatabaseFilterOperand | undefined;
    },
  ): void => {
    updateDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) => {
        if (criterion.id !== criterionId) return criterion;
        const merged = { ...criterion, ...change };
        if ("operand" in change && change.operand === undefined) {
          const { operand: _removed, ...withoutOperand } = merged;
          return withoutOperand;
        }
        return merged as FilterCriterion;
      }),
    }));
  };

  return (
    <details className="database-rule-editor">
      <summary>
        {DATABASE_COPY.filter.filters} · {draft.criteria.length} ·{" "}
        {draft.mode === "all"
          ? DATABASE_COPY.filter.allRulesShort
          : DATABASE_COPY.filter.anyRuleShort}
      </summary>
      <fieldset className="database-rule-controls" disabled={saving} aria-busy={saving}>
        <label>
          {DATABASE_COPY.filter.match}
          <select
            aria-label={DATABASE_COPY.filter.combination}
            value={draft.mode}
            onChange={(event) =>
              updateDraft((current) => ({
                ...current,
                mode: event.target.value as "all" | "any",
              }))
            }
          >
            <option value="all">{DATABASE_COPY.filter.allRules}</option>
            <option value="any">{DATABASE_COPY.filter.anyRules}</option>
          </select>
        </label>
        <ol className="database-rules">
          {draft.criteria.map((criterion) => {
            const property = properties.find(({ id }) => id === criterion.propertyId);
            if (property === undefined || property.state !== "active") {
              return (
                <li
                  key={criterion.id}
                  className="database-rule database-rule--invalid"
                  role="alert"
                >
                  {DATABASE_COPY.filter.unavailable}
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        criteria: current.criteria.filter(({ id }) => id !== criterion.id),
                      }))
                    }
                  >
                    {DATABASE_COPY.filter.removeRule}
                  </button>
                </li>
              );
            }
            return (
              <li key={criterion.id} className="database-rule">
                <label>
                  {DATABASE_COPY.filter.property}
                  <select
                    value={property.id}
                    onChange={(event) => {
                      const next = activeProperties.find(({ id }) => id === event.target.value);
                      if (next !== undefined) {
                        update(criterion.id, {
                          propertyId: next.id,
                          operator: defaultOperator(next),
                          operand: undefined,
                        });
                      }
                    }}
                  >
                    {activeProperties.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {DATABASE_COPY.filter.operator}
                  <select
                    value={criterion.operator}
                    onChange={(event) =>
                      update(criterion.id, {
                        operator: event.target.value as FilterOperator,
                        operand: undefined,
                      })
                    }
                  >
                    {operators(property).map((operator) => (
                      <option key={operator} value={operator}>
                        {DATABASE_COPY.filter.operatorLabels[operator]}
                      </option>
                    ))}
                  </select>
                </label>
                <OperandEditor
                  property={property}
                  criterion={criterion}
                  onChange={(operand) => update(criterion.id, { operand })}
                />
                <button
                  type="button"
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      criteria: current.criteria.filter(({ id }) => id !== criterion.id),
                    }))
                  }
                >
                  {DATABASE_COPY.filter.removeRule}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          disabled={activeProperties.length === 0}
          onClick={() => {
            const property = activeProperties[0];
            if (property === undefined) return;
            updateDraft((current) => ({
              ...current,
              criteria: [
                ...current.criteria,
                {
                  id: generateUuidV7(),
                  propertyId: property.id,
                  operator: defaultOperator(property),
                },
              ],
            }));
          }}
        >
          {DATABASE_COPY.filter.add}
        </button>
        {draft.criteria.length > 0 ? (
          <button
            type="button"
            onClick={() => updateDraft((current) => ({ ...current, criteria: [] }))}
          >
            {DATABASE_COPY.filter.clear}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            pendingSignature.current = JSON.stringify(draft);
            setSaving(true);
            void Promise.resolve(onChange({ ...view, filter: draft }))
              .catch(() => {
                pendingSignature.current = null;
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? DATABASE_COPY.filter.saving : DATABASE_COPY.filter.save}
        </button>
      </fieldset>
    </details>
  );
}
