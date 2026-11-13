import type { Uuid } from "../ids/uuid.ts";
import {
  evaluateFormulaProperty,
  type FormulaContext,
  type FormulaResult,
  type FormulaValue,
  formulaText,
  isFormulaDate,
} from "./formula.ts";
import {
  activeRollups,
  type RollupCell,
  type RollupContext,
  rollupResultKind,
  rollupValueOf,
} from "./rollup.ts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  DatabaseQueryEntry,
  NonRelationPropertyValue,
} from "./types.ts";

/** A derived cell as the shared filter and sort comparator understands it. */
export type DerivedComparable = Extract<
  NonRelationPropertyValue,
  { readonly kind: "text" | "number" | "checkbox" | "instant" }
>;

export interface DerivedValueOptions {
  /** Related entries and their properties. Without it only `count` rollups resolve. */
  readonly rollups?: RollupContext | undefined;
  readonly relationTitle?: ((id: Uuid) => string | undefined) | undefined;
  /** One clock for the whole pass keeps `now()` stable across rows and pages. */
  readonly now?: number | undefined;
}

export interface DerivedValues {
  /** Computed rollups of one entry; uncomputable ones are left out. */
  readonly rollups: (entry: DatabaseQueryEntry) => Readonly<Record<string, RollupCell>>;
  readonly formula: (
    property: Extract<DatabaseProperty, { type: "formula" }>,
    entry: DatabaseQueryEntry,
  ) => FormulaResult;
  /** Value used to filter and sort a rollup or formula; `undefined` is empty. */
  readonly comparable: (
    property: DatabaseProperty,
    entry: DatabaseQueryEntry,
  ) => DerivedComparable | undefined;
}

function comparableOf(value: FormulaValue): DerivedComparable | undefined {
  if (value === null) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "number", decimal: String(value) } : undefined;
  }
  if (typeof value === "boolean") return { kind: "checkbox", checked: value };
  if (isFormulaDate(value)) {
    return { kind: "instant", instant: new Date(value.time).toISOString() };
  }
  const text = formulaText(value);
  return text === "" ? undefined : { kind: "text", value: text };
}

function rollupComparable(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  cell: RollupCell | undefined,
): DerivedComparable | undefined {
  if (cell === undefined || cell === null) return undefined;
  if (typeof cell === "number") return comparableOf(cell);
  if (typeof cell === "string") {
    if (rollupResultKind(property.config.aggregate) === "date") {
      const time = Date.parse(cell.length === 10 ? `${cell}T00:00:00.000Z` : cell);
      if (Number.isFinite(time)) return { kind: "instant", instant: new Date(time).toISOString() };
    }
    return cell === "" ? undefined : { kind: "text", value: cell };
  }
  return comparableOf(cell as readonly FormulaValue[]);
}

/**
 * One resolver per projection pass. Rollups and formulas are computed from the
 * same inputs wherever they are shown, filtered or sorted, and memoized per
 * entry so a sort comparator never recomputes them.
 */
export function createDerivedValues(
  definition: DatabaseDefinition,
  options: DerivedValueOptions = {},
): DerivedValues {
  const rollupDefinitions = activeRollups(definition);
  const rollupCache = new WeakMap<DatabaseQueryEntry, Readonly<Record<string, RollupCell>>>();
  const formulaCache = new WeakMap<DatabaseQueryEntry, Map<string, FormulaResult>>();
  const now = options.now ?? Date.now();
  const rollupContext: RollupContext = {
    entries: new Map(),
    ...options.rollups,
    // The current definition is authoritative for its relation's state and
    // target, even if the related-entry cache was prepared before a schema edit.
    propertiesById: new Map([
      ...(options.rollups?.propertiesById ?? []),
      ...definition.properties.map((property) => [property.id, property] as const),
    ]),
  };

  const rollups = (entry: DatabaseQueryEntry): Readonly<Record<string, RollupCell>> => {
    const cached = rollupCache.get(entry);
    if (cached !== undefined) return cached;
    const values: Record<string, RollupCell> = {};
    for (const property of rollupDefinitions) {
      const value = rollupValueOf(property, entry, rollupContext);
      if (value !== undefined) values[property.id] = value;
    }
    rollupCache.set(entry, values);
    return values;
  };

  const formula = (
    property: Extract<DatabaseProperty, { type: "formula" }>,
    entry: DatabaseQueryEntry,
  ): FormulaResult => {
    let cache = formulaCache.get(entry);
    if (cache === undefined) {
      cache = new Map();
      formulaCache.set(entry, cache);
    }
    const cached = cache.get(property.id);
    if (cached !== undefined) return cached;
    const context: FormulaContext = {
      title: entry.title,
      properties: definition.properties,
      values: entry.values,
      relationTargets: entry.relationTargets,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      entryNumber: entry.entryNumber,
      entryId: entry.entryId,
      rollupValues: rollups(entry),
      relationTitle: options.relationTitle,
      now,
    };
    const result = evaluateFormulaProperty(property, context);
    cache.set(property.id, result);
    return result;
  };

  return {
    rollups,
    formula,
    comparable: (property, entry) => {
      if (property.type === "rollup") {
        return rollupComparable(property, rollups(entry)[property.id]);
      }
      if (property.type === "formula") {
        const result = formula(property, entry);
        return result.ok ? comparableOf(result.value) : undefined;
      }
      return undefined;
    },
  };
}
