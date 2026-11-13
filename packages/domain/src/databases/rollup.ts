import type { Uuid } from "../ids/uuid.ts";
import {
  type DatabaseDefinition,
  type DatabaseProperty,
  type DatabasePropertyType,
  type NonRelationPropertyValue,
  type RelationTargets,
  type RollupFunction,
  uniqueIdPrefixOf,
} from "./types.ts";

/** One value read from a related entry. */
export type RollupItem = string | number | boolean;

/**
 * The value a rollup cell can render.
 *
 * `null` is a computed, empty result (no data to aggregate). A rollup that
 * could not be computed at all is `undefined` and is never sent as a value:
 * callers must not replace it with another figure such as the relation count.
 */
export type RollupCell = string | number | null | RollupItem[];

export type RollupResultKind = "number" | "percent" | "date" | "list" | "text";

/** The fields a rollup needs from one related entry. */
export interface RollupEntry {
  readonly entryNumber?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly title: string;
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly relationTargets: RelationTargets;
}

export interface RollupComputeOptions {
  /**
   * `skip` treats an unknown target as removed (complete server projection).
   * `unavailable` refuses to compute from a partial local corpus.
   */
  readonly missing?: "skip" | "unavailable";
  /** Targets known to be removed or archived: always skipped. */
  readonly inactiveEntryIds?: ReadonlySet<Uuid>;
}

const ALWAYS: readonly RollupFunction[] = [
  "show_original",
  "show_unique",
  "count",
  "count_values",
  "unique",
  "empty",
  "not_empty",
  "percent_empty",
  "percent_not_empty",
];
const NUMERIC: readonly RollupFunction[] = ["sum", "average", "median", "min", "max", "range"];
const DATES: readonly RollupFunction[] = ["earliest_date", "latest_date", "date_range"];
const CHECKS: readonly RollupFunction[] = [
  "checked",
  "unchecked",
  "percent_checked",
  "percent_unchecked",
];
const GROUPS: readonly RollupFunction[] = ["count_per_group", "percent_per_group"];

/** Calculations Notion offers for a target of this type, in menu order. */
export function rollupFunctionsForType(type: DatabasePropertyType): readonly RollupFunction[] {
  switch (type) {
    case "number":
      return [...ALWAYS, ...NUMERIC];
    case "date":
    case "created-time":
    case "last-edited-time":
      return [...ALWAYS, ...DATES];
    case "checkbox":
      return [...ALWAYS, ...CHECKS];
    case "status":
    case "select":
    case "multi-select":
      return [...ALWAYS, ...GROUPS];
    default:
      return ALWAYS;
  }
}

export function rollupResultKind(aggregate: RollupFunction): RollupResultKind {
  switch (aggregate) {
    case "show_original":
    case "show_unique":
      return "list";
    case "percent_empty":
    case "percent_not_empty":
    case "percent_checked":
    case "percent_unchecked":
      return "percent";
    case "earliest_date":
    case "latest_date":
      return "date";
    case "count_per_group":
    case "percent_per_group":
      return "text";
    default:
      return "number";
  }
}

export type RollupConfigIssue = "relation-missing" | "target-missing" | "function-incompatible";

/** Why a rollup configuration cannot produce a trustworthy value, if at all. */
export function rollupConfigIssue(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  relation: DatabaseProperty | undefined,
  target: { readonly type: DatabasePropertyType } | undefined,
): RollupConfigIssue | null {
  if (relation === undefined || relation.type !== "relation" || relation.state !== "active") {
    return "relation-missing";
  }
  if (property.config.targetPropertyId === undefined) {
    return property.config.aggregate === "count" ? null : "target-missing";
  }
  if (target === undefined) return "target-missing";
  return rollupFunctionsForType(target.type).includes(property.config.aggregate)
    ? null
    : "function-incompatible";
}

function optionLabel(property: DatabaseProperty, optionId: string): string | undefined {
  return property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
    ? property.config.options.find((option) => option.id === optionId)?.label
    : undefined;
}

/** Values of one related entry; an empty list is an empty cell. */
function itemsOf(property: DatabaseProperty, entry: RollupEntry): readonly RollupItem[] {
  if (property.type === "title") return entry.title === "" ? [] : [entry.title];
  if (property.type === "created-time")
    return entry.createdAt === undefined ? [] : [entry.createdAt];
  if (property.type === "last-edited-time") {
    return entry.updatedAt === undefined ? [] : [entry.updatedAt];
  }
  if (property.type === "unique-id") {
    if (entry.entryNumber === undefined) return [];
    const prefix = uniqueIdPrefixOf(property);
    return [prefix === "" ? String(entry.entryNumber) : `${prefix}-${entry.entryNumber}`];
  }
  const value = entry.values[property.id];
  if (value === undefined) return property.type === "checkbox" ? [false] : [];
  switch (value.kind) {
    case "text":
      return value.value === "" ? [] : [value.value];
    case "number": {
      const number = Number(value.decimal);
      return Number.isFinite(number) ? [number] : [];
    }
    case "date":
      return [value.date];
    case "instant":
      return [value.instant];
    case "checkbox":
      return [value.checked];
    case "place":
      return value.name === "" ? [] : [value.name];
    case "status":
    case "select": {
      const label = optionLabel(property, value.optionId);
      return label === undefined ? [] : [label];
    }
    case "multi-select":
      return value.optionIds
        .map((id) => optionLabel(property, id))
        .filter((label): label is string => label !== undefined);
    case "files": {
      const count = value.fileIds.length + (value.externalUrls?.length ?? 0);
      return count === 0 ? [] : [count];
    }
  }
}

function dateTime(item: RollupItem): number | null {
  if (typeof item !== "string") return null;
  const time = new Date(item.length === 10 ? `${item}T00:00:00.000Z` : item).getTime();
  return Number.isFinite(time) ? time : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Pure Notion-style rollup evaluation shared by the API, the local projection
 * and formulas. Returns `undefined` when the value cannot be trusted.
 */
export function computeRollupValue(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  entry: RollupEntry,
  targetProperty: DatabaseProperty | undefined,
  entries: ReadonlyMap<Uuid, RollupEntry>,
  options: RollupComputeOptions = {},
): RollupCell | undefined {
  const targetIds = entry.relationTargets[property.config.relationPropertyId] ?? [];
  const aggregate: RollupFunction = property.config.aggregate;
  if (aggregate === "count") return targetIds.length;
  if (targetProperty === undefined || targetProperty.state !== "active") return undefined;
  if (!rollupFunctionsForType(targetProperty.type).includes(aggregate)) return undefined;

  const cells: (readonly RollupItem[])[] = [];
  for (const id of targetIds) {
    const target = entries.get(id);
    if (target === undefined) {
      if (options.missing === "unavailable" && options.inactiveEntryIds?.has(id) !== true) {
        return undefined;
      }
      continue;
    }
    cells.push(itemsOf(targetProperty, target));
  }
  const items = cells.flat();
  const total = cells.length;
  const filled = cells.filter((cell) => cell.length > 0).length;
  const percent = (count: number): number | null =>
    total === 0 ? null : round((count / total) * 100, 1);
  const numbers = items.filter((item): item is number => typeof item === "number");
  const dated = items
    .map((item) => ({ item, time: dateTime(item) }))
    .filter((entry): entry is { item: string; time: number } => entry.time !== null)
    .sort((left, right) => left.time - right.time);
  const checked = items.filter((item) => item === true).length;
  const unchecked = items.filter((item) => item === false).length;

  switch (aggregate) {
    case "show_original":
      return items.length === 0 ? null : [...items];
    case "show_unique":
      return items.length === 0 ? null : [...new Set(items)];
    case "count_values":
      return items.length;
    case "unique":
      return new Set(items).size;
    case "empty":
      return total - filled;
    case "not_empty":
      return filled;
    case "percent_empty":
      return percent(total - filled);
    case "percent_not_empty":
      return percent(filled);
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
        ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
        : (sorted[middle] as number);
    }
    case "min":
      return numbers.length === 0 ? null : Math.min(...numbers);
    case "max":
      return numbers.length === 0 ? null : Math.max(...numbers);
    case "range":
      return numbers.length === 0 ? null : Math.max(...numbers) - Math.min(...numbers);
    case "earliest_date":
      return dated[0]?.item ?? null;
    case "latest_date":
      return dated.at(-1)?.item ?? null;
    case "date_range": {
      const first = dated[0];
      const last = dated.at(-1);
      return first === undefined || last === undefined
        ? null
        : round((last.time - first.time) / 86_400_000, 2);
    }
    case "checked":
      return checked;
    case "unchecked":
      return unchecked;
    case "percent_checked":
      return percent(checked);
    case "percent_unchecked":
      return percent(unchecked);
    case "count_per_group":
    case "percent_per_group": {
      const groups = new Map<string, number>();
      for (const item of items) {
        const label = String(item);
        groups.set(label, (groups.get(label) ?? 0) + 1);
      }
      if (groups.size === 0) return null;
      return [...groups.entries()]
        .map(([label, count]) =>
          aggregate === "percent_per_group"
            ? `${label} : ${round((count / items.length) * 100, 1)} %`
            : `${label} : ${count}`,
        )
        .join(", ");
    }
  }
}

/** Everything a projection needs to compute the rollups of any entry. */
export interface RollupContext extends RollupComputeOptions {
  readonly entries: ReadonlyMap<Uuid, RollupEntry>;
  /** Membership-specific values and automatic numbers must not be overwritten by another source. */
  readonly entriesBySource?: ReadonlyMap<Uuid, ReadonlyMap<Uuid, RollupEntry>>;
  readonly propertiesById: ReadonlyMap<Uuid, DatabaseProperty>;
  /** Source identities used to validate configured relations, including empty sources. */
  readonly propertySources?: ReadonlyMap<Uuid, Uuid>;
  readonly entrySources?: ReadonlyMap<Uuid, ReadonlySet<Uuid>>;
  readonly sourceIds?: ReadonlySet<Uuid>;
}

export function activeRollups(
  definition: DatabaseDefinition,
): readonly Extract<DatabaseProperty, { type: "rollup" }>[] {
  return definition.properties.filter(
    (property): property is Extract<DatabaseProperty, { type: "rollup" }> =>
      property.state === "active" && property.type === "rollup",
  );
}

/** One rollup of one entry; `undefined` means it could not be computed. */
export function rollupValueOf(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  entry: RollupEntry,
  context: RollupContext,
): RollupCell | undefined {
  const target =
    property.config.targetPropertyId === undefined
      ? undefined
      : context.propertiesById.get(property.config.targetPropertyId);
  const relation = context.propertiesById.get(property.config.relationPropertyId);
  const targetSourceId = relation?.type === "relation" ? relation.config.targetSourceId : undefined;
  const valueSourceId =
    targetSourceId ?? (target === undefined ? undefined : context.propertySources?.get(target.id));
  const relatedEntries =
    valueSourceId === undefined
      ? context.entries
      : (context.entriesBySource?.get(valueSourceId) ?? context.entries);
  if (targetSourceId !== undefined) {
    if (context.sourceIds?.has(targetSourceId) !== true) return undefined;
    if (property.config.targetPropertyId !== undefined && target === undefined) return undefined;
    if (
      target !== undefined &&
      context.propertySources !== undefined &&
      context.propertySources.get(target.id) !== targetSourceId
    )
      return undefined;
    // Retained historical edges outside the new source must not silently become
    // empty numeric cells (or be counted as valid members of that source).
    if (context.entrySources !== undefined) {
      for (const targetId of entry.relationTargets[property.config.relationPropertyId] ?? []) {
        const sources = context.entrySources.get(targetId);
        if (sources !== undefined && !sources.has(targetSourceId)) return undefined;
      }
    }
    if (property.config.aggregate === "count") {
      let count = 0;
      for (const targetId of entry.relationTargets[property.config.relationPropertyId] ?? []) {
        if (context.inactiveEntryIds?.has(targetId)) continue;
        if (relatedEntries.has(targetId)) count += 1;
        else if (context.missing === "unavailable") return undefined;
      }
      return count;
    }
  }
  return computeRollupValue(property, entry, target, relatedEntries, context);
}

/** Computed rollups of one entry. Uncomputable rollups are left out, never guessed. */
export function rollupValuesOf(
  definition: DatabaseDefinition,
  entry: RollupEntry,
  context: RollupContext,
): Record<string, RollupCell> {
  const values: Record<string, RollupCell> = {};
  for (const property of activeRollups(definition)) {
    const value = rollupValueOf(property, entry, context);
    if (value !== undefined) values[property.id] = value;
  }
  return values;
}
