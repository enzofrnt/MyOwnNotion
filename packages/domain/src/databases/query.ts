import DecimalRuntime, { type Decimal as DecimalValue } from "decimal.js-light";
import { type DomainResult, err, ok } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";
import type {
  DatabaseDefinition,
  DatabaseFilterOperand,
  DatabaseProperty,
  DatabaseQueryEntry,
  EvaluatedDatabaseGroup,
  EvaluatedDatabaseView,
  FilterCriterion,
  NonRelationPropertyValue,
  SortCriterion,
} from "./types.ts";
import { normalizePropertyValue } from "./values.ts";

const Decimal = DecimalRuntime as unknown as typeof DecimalValue;

type ComparableValue =
  | NonRelationPropertyValue
  | { readonly kind: "relation"; readonly targetIds: readonly Uuid[] };
type RangeOperand = Extract<
  DatabaseFilterOperand,
  { readonly kind: "date-range" | "instant-range" }
>;
type PreparedOperand = ComparableValue | RangeOperand;

function queryError(field: string, code: string): DomainResult<never> {
  return err("validation.invalid-payload", "Saved database view is invalid", {
    invalidFields: [{ field, code }],
  });
}

function textKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("und");
}

function compareText(left: string, right: string): number {
  const normalized = textKey(left).localeCompare(textKey(right), "und");
  if (normalized !== 0) return normalized;
  return left < right ? -1 : left > right ? 1 : 0;
}

function valueFor(
  property: DatabaseProperty,
  entry: DatabaseQueryEntry,
): ComparableValue | undefined {
  if (property.type === "title") return { kind: "text", value: entry.title };
  if (property.type === "relation") {
    const targets = entry.relationTargets[property.id];
    return targets === undefined ? undefined : { kind: "relation", targetIds: [...targets].sort() };
  }
  return entry.values[property.id];
}

function comparableScalar(
  property: DatabaseProperty,
  value: ComparableValue,
): string | boolean | DecimalValue {
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return new Decimal(value.decimal);
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "checkbox":
      return value.checked;
    case "status":
    case "select": {
      if (
        property.type !== "status" &&
        property.type !== "select" &&
        property.type !== "multi-select"
      ) {
        return value.optionId;
      }
      return (
        property.config.options.find((option) => option.id === value.optionId)?.positionKey ??
        value.optionId
      );
    }
    case "multi-select":
      if (property.type !== "multi-select") return [...value.optionIds].sort().join("\u001f");
      return [...value.optionIds]
        .sort((left, right) => {
          const leftKey =
            property.config.options.find((option) => option.id === left)?.positionKey ?? left;
          const rightKey =
            property.config.options.find((option) => option.id === right)?.positionKey ?? right;
          return leftKey.localeCompare(rightKey) || left.localeCompare(right);
        })
        .join("\u001f");
    case "relation":
      return [...value.targetIds].sort().join("\u001f");
  }
}

function comparePresent(
  property: DatabaseProperty,
  left: ComparableValue,
  right: ComparableValue,
): number {
  const a = comparableScalar(property, left);
  const b = comparableScalar(property, right);
  if (a instanceof Decimal && b instanceof Decimal) return a.comparedTo(b);
  if (typeof a === "string" && typeof b === "string") {
    return left.kind === "text" && right.kind === "text" ? compareText(a, b) : a.localeCompare(b);
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

function sameValue(left: ComparableValue, right: ComparableValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operandFor(
  property: DatabaseProperty,
  criterion: FilterCriterion,
): DomainResult<PreparedOperand | undefined> {
  if (criterion.operator === "is-empty" || criterion.operator === "is-not-empty")
    return ok(undefined);
  if (criterion.operator === "between") {
    if (
      property.type !== "date" ||
      typeof criterion.operand !== "object" ||
      criterion.operand === null ||
      (criterion.operand.kind !== "date-range" && criterion.operand.kind !== "instant-range")
    ) {
      return queryError(`filter.${criterion.id}`, "invalid-range");
    }
    const expectedKind = property.config.mode === "date" ? "date-range" : "instant-range";
    if (criterion.operand.kind !== expectedKind) {
      return queryError(`filter.${criterion.id}`, "invalid-range");
    }
    const from = normalizePropertyValue(property, criterion.operand.from, { intent: "decode" });
    const to = normalizePropertyValue(property, criterion.operand.to, { intent: "decode" });
    if (!from.ok || !to.ok || from.value === undefined || to.value === undefined) {
      return queryError(`filter.${criterion.id}`, "invalid-range");
    }
    const range = { ...criterion.operand, from: from.value, to: to.value } as RangeOperand;
    if (comparePresent(property, range.from, range.to) > 0) {
      return queryError(`filter.${criterion.id}`, "invalid-range");
    }
    return ok(range);
  }
  if (property.type === "relation") {
    const operand = criterion.operand;
    if (operand?.kind === "relation" && Array.isArray(operand.targetIds)) {
      const targetIds = operand.targetIds;
      if (targetIds.every((target): target is Uuid => typeof target === "string")) {
        return ok({ kind: "relation", targetIds: [...new Set(targetIds)].sort() });
      }
    }
    return queryError(`filter.${criterion.id}`, "invalid-operand");
  }
  const normalized = normalizePropertyValue(property, criterion.operand, { intent: "decode" });
  if (!normalized.ok || normalized.value === undefined) {
    return queryError(`filter.${criterion.id}`, "invalid-operand");
  }
  return ok(normalized.value);
}

function validOperator(property: DatabaseProperty, operator: FilterCriterion["operator"]): boolean {
  if (["equals", "not-equals", "is-empty", "is-not-empty"].includes(operator)) return true;
  if (operator === "contains" || operator === "not-contains") {
    return (
      property.type === "text" || property.type === "multi-select" || property.type === "relation"
    );
  }
  if (operator === "before" || operator === "after" || operator === "between")
    return property.type === "date";
  if (operator === "less-than" || operator === "greater-than") return property.type === "number";
  return false;
}

function contains(value: ComparableValue, operand: ComparableValue): boolean {
  if (value.kind === "text" && operand.kind === "text") {
    return textKey(value.value).includes(textKey(operand.value));
  }
  if (value.kind === "multi-select" && operand.kind === "multi-select") {
    return operand.optionIds.every((optionId) => value.optionIds.includes(optionId));
  }
  if (value.kind === "relation" && operand.kind === "relation") {
    return operand.targetIds.every((targetId) => value.targetIds.includes(targetId));
  }
  return false;
}

function matchesCriterion(
  property: DatabaseProperty,
  entry: DatabaseQueryEntry,
  criterion: FilterCriterion,
  operand: PreparedOperand | undefined,
): boolean {
  const value = valueFor(property, entry);
  if (criterion.operator === "is-empty") return value === undefined;
  if (criterion.operator === "is-not-empty") return value !== undefined;
  if (value === undefined || operand === undefined) return false;
  if (operand.kind === "date-range" || operand.kind === "instant-range") {
    return (
      criterion.operator === "between" &&
      comparePresent(property, value, operand.from) >= 0 &&
      comparePresent(property, value, operand.to) <= 0
    );
  }
  switch (criterion.operator) {
    case "equals":
      return sameValue(value, operand);
    case "not-equals":
      return !sameValue(value, operand);
    case "contains":
      return contains(value, operand);
    case "not-contains":
      return !contains(value, operand);
    case "before":
    case "less-than":
      return comparePresent(property, value, operand) < 0;
    case "after":
    case "greater-than":
      return comparePresent(property, value, operand) > 0;
    case "between":
      return false;
  }
}

function compareByCriterion(
  properties: ReadonlyMap<Uuid, DatabaseProperty>,
  criterion: SortCriterion,
  left: DatabaseQueryEntry,
  right: DatabaseQueryEntry,
): number {
  const property = properties.get(criterion.propertyId);
  if (property === undefined) return 0;
  const a = valueFor(property, left);
  const b = valueFor(property, right);
  if (a === undefined || b === undefined) {
    if (a === b) return 0;
    return a === undefined
      ? criterion.missing === "first"
        ? -1
        : 1
      : criterion.missing === "first"
        ? 1
        : -1;
  }
  const comparison = comparePresent(property, a, b);
  return criterion.direction === "ascending" ? comparison : -comparison;
}

function groupId(property: DatabaseProperty, entry: DatabaseQueryEntry): string {
  const value = valueFor(property, entry);
  if (value === undefined) return "missing";
  if (value.kind === "status" || value.kind === "select") return value.optionId;
  if (value.kind === "checkbox") return value.checked ? "checked" : "unchecked";
  return "missing";
}

function orderedGroups(
  property: DatabaseProperty,
  rows: readonly DatabaseQueryEntry[],
): readonly EvaluatedDatabaseGroup[] {
  const grouped = new Map<string, Uuid[]>();
  for (const row of rows) {
    const id = groupId(property, row);
    grouped.set(id, [...(grouped.get(id) ?? []), row.entryId]);
  }
  const order =
    property.type === "status" || property.type === "select"
      ? property.config.options
          .filter((option) => option.state === "active")
          .sort(
            (left, right) =>
              left.positionKey.localeCompare(right.positionKey) || left.id.localeCompare(right.id),
          )
          .map((option) => option.id)
      : property.type === "checkbox"
        ? ["unchecked", "checked"]
        : [];
  const ids = [
    ...order.filter((id) => grouped.has(id)),
    ...(grouped.has("missing") ? ["missing"] : []),
  ];
  return ids.map((id) => ({ id, entryIds: grouped.get(id) ?? [] }));
}

export function evaluateDatabaseView(
  definition: DatabaseDefinition,
  viewId: Uuid,
  entries: readonly DatabaseQueryEntry[],
): DomainResult<EvaluatedDatabaseView> {
  const view = definition.views.find(
    (candidate) => candidate.id === viewId && candidate.state === "active",
  );
  if (view === undefined) return queryError("viewId", "view-unavailable");
  const properties = new Map(definition.properties.map((property) => [property.id, property]));

  const preparedCriteria: Array<{
    criterion: FilterCriterion;
    property: DatabaseProperty;
    operand: PreparedOperand | undefined;
  }> = [];
  for (const criterion of view.filter.criteria) {
    const property = properties.get(criterion.propertyId);
    if (
      property === undefined ||
      property.state !== "active" ||
      !validOperator(property, criterion.operator)
    ) {
      return queryError(`filter.${criterion.id}`, "property-or-operator-unavailable");
    }
    const operand = operandFor(property, criterion);
    if (!operand.ok) return operand;
    preparedCriteria.push({ criterion, property, operand: operand.value });
  }
  for (const sort of view.sorts) {
    const property = properties.get(sort.propertyId);
    if (property === undefined || property.state !== "active") {
      return queryError(`sort.${sort.propertyId}`, "property-unavailable");
    }
  }

  const filtered =
    preparedCriteria.length === 0
      ? [...entries]
      : entries.filter((entry) => {
          const outcomes = preparedCriteria.map(({ property, criterion, operand }) =>
            matchesCriterion(property, entry, criterion, operand),
          );
          return view.filter.mode === "all" ? outcomes.every(Boolean) : outcomes.some(Boolean);
        });
  const rows = filtered.sort((left, right) => {
    for (const criterion of view.sorts) {
      const comparison = compareByCriterion(properties, criterion, left, right);
      if (comparison !== 0) return comparison;
    }
    return compareText(left.title, right.title) || left.entryId.localeCompare(right.entryId);
  });

  if (view.group === null) return ok({ rows, groups: [] });
  const groupingProperty = properties.get(view.group.propertyId);
  if (
    groupingProperty === undefined ||
    groupingProperty.state !== "active" ||
    (groupingProperty.type !== "status" &&
      groupingProperty.type !== "select" &&
      groupingProperty.type !== "checkbox")
  ) {
    return queryError("group.propertyId", "property-unavailable");
  }
  return ok({ rows, groups: orderedGroups(groupingProperty, rows) });
}
