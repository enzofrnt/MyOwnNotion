import type { Uuid } from "../ids/uuid.ts";
import {
  type DatabaseProperty,
  type NonRelationPropertyValue,
  type RelationTargets,
  type RollupFunction,
  uniqueIdPrefixOf,
} from "./types.ts";

/** The value a rollup cell can render. */
export type RollupCell = string | number | null;

/** The fields a rollup needs from one related entry. */
export interface RollupEntry {
  readonly entryNumber?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly title: string;
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly relationTargets: RelationTargets;
}

function propertyValueText(property: DatabaseProperty, entry: RollupEntry): string | null {
  if (property.type === "title") return entry.title;
  if (property.type === "created-time") return entry.createdAt ?? null;
  if (property.type === "last-edited-time") return entry.updatedAt ?? null;
  if (property.type === "unique-id") {
    if (entry.entryNumber === undefined) return null;
    const prefix = uniqueIdPrefixOf(property);
    return prefix === "" ? String(entry.entryNumber) : `${prefix}-${entry.entryNumber}`;
  }
  const value = entry.values[property.id];
  if (value === undefined) return null;
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "checkbox":
      return value.checked ? "true" : "false";
    case "place":
      return value.name;
    case "status":
    case "select":
      return property.type === "status" || property.type === "select"
        ? (property.config.options.find((option) => option.id === value.optionId)?.label ?? null)
        : null;
    case "multi-select":
      return property.type === "multi-select"
        ? value.optionIds
            .map((id) => property.config.options.find((option) => option.id === id)?.label)
            .filter((label): label is string => label !== undefined)
            .join(", ")
        : null;
    case "files":
      return String(value.fileIds.length + (value.externalUrls?.length ?? 0));
  }
}

function propertyValueNumber(property: DatabaseProperty, entry: RollupEntry): number | null {
  const text = propertyValueText(property, entry);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function propertyValueDate(property: DatabaseProperty, entry: RollupEntry): number | null {
  if (
    property.type !== "date" &&
    property.type !== "created-time" &&
    property.type !== "last-edited-time"
  ) {
    return null;
  }
  const text = propertyValueText(property, entry);
  if (text === null) return null;
  const time = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : text).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Pure Notion-style rollup evaluation shared by the API and the local projection. */
export function computeRollupValue(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  entry: RollupEntry,
  targetProperty: DatabaseProperty | undefined,
  entries: ReadonlyMap<Uuid, RollupEntry>,
): RollupCell {
  const targetIds = entry.relationTargets[property.config.relationPropertyId] ?? [];
  const functionName: RollupFunction = property.config.aggregate;
  const targets = targetIds.map((id) => entries.get(id));
  if (functionName === "count") return targetIds.length;
  if (targetProperty === undefined) return null;
  const values = targets.map((target) =>
    target === undefined ? null : propertyValueText(targetProperty, target),
  );
  const present = values.filter((value): value is string => value !== null && value !== "");
  const total = values.length;
  const percent = (count: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));
  const numbers = targets
    .map((target) => (target === undefined ? null : propertyValueNumber(targetProperty, target)))
    .filter((value): value is number => value !== null);
  const dates = targets
    .map((target) => (target === undefined ? null : propertyValueDate(targetProperty, target)))
    .filter((value): value is number => value !== null);
  const bools = targets.map((target) => {
    if (target === undefined) return null;
    const value = target.values[targetProperty.id];
    return value?.kind === "checkbox" ? value.checked : null;
  });
  switch (functionName) {
    case "count_values":
      return present.length;
    case "empty":
      return total - present.length;
    case "not_empty":
      return present.length;
    case "unique":
      return new Set(present).size;
    case "show_unique":
      return [...new Set(present)].join(", ") || null;
    case "percent_empty":
      return percent(total - present.length);
    case "percent_not_empty":
      return percent(present.length);
    case "sum":
      return numbers.reduce((sum, value) => sum + value, 0);
    case "average":
      return numbers.length === 0
        ? null
        : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "median": {
      if (numbers.length === 0) return null;
      const sorted = [...numbers].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? null);
    }
    case "min":
      return numbers.length === 0 ? null : Math.min(...numbers);
    case "max":
      return numbers.length === 0 ? null : Math.max(...numbers);
    case "range":
      return numbers.length === 0 ? null : Math.max(...numbers) - Math.min(...numbers);
    case "earliest_date":
      return dates.length === 0 ? null : new Date(Math.min(...dates)).toISOString();
    case "latest_date":
      return dates.length === 0 ? null : new Date(Math.max(...dates)).toISOString();
    case "date_range":
      return dates.length === 0 ? null : (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
    case "checked":
      return bools.filter((value) => value === true).length;
    case "unchecked":
      return bools.filter((value) => value === false).length;
    case "percent_checked":
      return percent(bools.filter((value) => value === true).length);
    case "percent_unchecked":
      return percent(bools.filter((value) => value === false).length);
    case "show_original":
      return values.map((value) => value ?? "").join(", ") || null;
    case "count_per_group":
    case "percent_per_group": {
      const groups = new Map<string, number>();
      for (const value of values) {
        if (value === null || value === "") continue;
        groups.set(value, (groups.get(value) ?? 0) + 1);
      }
      const parts = [...groups.entries()].map(([label, count]) =>
        functionName === "percent_per_group"
          ? `${label}: ${percent(count)}%`
          : `${label}: ${count}`,
      );
      return parts.join(", ") || null;
    }
  }
}
