import {
  type DatabaseProperty,
  type FormulaContext,
  type FormulaType,
  type FormulaValue,
  formulaTypeOf,
  isFormulaDate,
  type RollupCell,
} from "@myownnotion/domain";
import { formatDatabaseDate } from "./date-format.ts";

/**
 * The formula language lives in the domain so every surface, the server
 * projection and the local one compute the same result. This module only
 * adds what is specific to the web client: French presentation and the
 * mapping from a displayed row to an evaluation context.
 */
export {
  checkFormulaSyntax,
  evaluateFormula,
  evaluateFormulaProperty,
  FORMULA_FUNCTION_NAMES,
  type FormulaContext,
  type FormulaResult,
  type FormulaType,
  type FormulaValue,
  formulaText,
  formulaTypeOf,
} from "@myownnotion/domain";

const DATE_DISPLAY = { dateFormat: "full", timeFormat: "24h" } as const;

function formatDate(time: number, hasTime: boolean): string {
  const iso = new Date(time).toISOString();
  return formatDatabaseDate(
    hasTime ? { kind: "instant", instant: iso } : { kind: "date", date: iso.slice(0, 10) },
    DATE_DISPLAY,
  );
}

export function formatFormulaValue(value: FormulaValue): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(value);
  }
  if (typeof value === "string") return value === "" ? "—" : value;
  if (isFormulaDate(value)) {
    const start = formatDate(value.time, value.hasTime);
    return value.end === undefined ? start : `${start} → ${formatDate(value.end, value.hasTime)}`;
  }
  return value.length === 0 ? "—" : value.map(formatFormulaValue).join(", ");
}

const TYPE_LABELS: Readonly<Record<FormulaType, string>> = {
  text: "texte",
  number: "numéro",
  boolean: "case à cocher",
  date: "date",
  list: "liste",
  empty: "vide",
};

export function formulaTypeLabel(value: FormulaValue): string {
  return TYPE_LABELS[formulaTypeOf(value)];
}

/** The fields of a displayed row a formula can read. */
export interface FormulaRow {
  readonly entryId?: string | undefined;
  readonly title: string;
  readonly values: unknown;
  readonly relationTargets: unknown;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly revisionId?: string | undefined;
  readonly entryNumber?: number | undefined;
  readonly rollupValues?: Readonly<Record<string, RollupCell>> | undefined;
}

/**
 * One context builder for the table, the entry panel and the editor preview,
 * so a row never yields a different result depending on where it is shown.
 */
export function formulaContextOf(
  row: FormulaRow,
  properties: readonly DatabaseProperty[],
): FormulaContext {
  return {
    title: row.title,
    properties,
    values: row.values as FormulaContext["values"],
    relationTargets: row.relationTargets as FormulaContext["relationTargets"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revisionId: row.revisionId,
    entryNumber: row.entryNumber,
    entryId: row.entryId,
    // An absent map means "not computed": only count rollups stay readable.
    rollupValues: row.rollupValues ?? countRollups(row, properties),
  };
}

function countRollups(
  row: FormulaRow,
  properties: readonly DatabaseProperty[],
): Readonly<Record<string, RollupCell>> {
  const targets = row.relationTargets as Readonly<Record<string, readonly string[]>>;
  const values: Record<string, RollupCell> = {};
  for (const property of properties) {
    if (
      property.type === "rollup" &&
      property.state === "active" &&
      property.config.aggregate === "count"
    ) {
      values[property.id] = (targets[property.config.relationPropertyId] ?? []).length;
    }
  }
  return values;
}
