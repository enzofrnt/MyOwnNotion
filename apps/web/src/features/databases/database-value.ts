import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import {
  type DatabaseProperty,
  dateDisplayConfigOf,
  numberConfigOf,
  type RollupCell,
  rollupResultKind,
  statusDefaultOptionId,
  uniqueIdPrefixOf,
} from "@myownnotion/domain";
import { DATABASE_COPY } from "./database-copy.ts";
import { uuidV7Timestamp } from "./database-time.ts";
import { formatDatabaseDate, formatDatabaseDateForProperty } from "./date-format.ts";
import { evaluateFormulaProperty, formatFormulaValue, formulaContextOf } from "./formula.ts";
import { formatDatabaseNumber } from "./number-format.ts";

const ROLLUP_DATE_DISPLAY = { dateFormat: "full", timeFormat: "24h" } as const;
const rollupNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });

/**
 * Text of a rollup cell. `undefined` means the rollup could not be computed:
 * it reads as "—". Even `count` can be unavailable when its configured source
 * is missing or its retained historical links are outside that source.
 */
export function displayRollupCell(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  cell: RollupCell | undefined,
): string {
  if (cell === undefined) return "—";
  if (cell === null) return "—";
  const kind = rollupResultKind(property.config.aggregate);
  if (typeof cell === "number") {
    const text = rollupNumber.format(cell);
    return kind === "percent" ? `${text} %` : text;
  }
  if (typeof cell === "string") {
    if (kind !== "date") return cell === "" ? "—" : cell;
    return formatDatabaseDate(
      cell.length === 10 ? { kind: "date", date: cell } : { kind: "instant", instant: cell },
      ROLLUP_DATE_DISPLAY,
    );
  }
  if (cell.length === 0) return "—";
  return cell
    .map((item) =>
      typeof item === "boolean"
        ? item
          ? DATABASE_COPY.value.yes
          : DATABASE_COPY.value.no
        : typeof item === "number"
          ? rollupNumber.format(item)
          : item,
    )
    .join(", ");
}

export function displayDatabaseValue(
  row: DatabaseQueryPageDto["rows"][number],
  property: DatabaseProperty,
  properties?: readonly DatabaseProperty[],
): string {
  if (property.type === "title") return row.title;
  if (property.type === "unique-id") {
    if (row.entryNumber === undefined) return "—";
    const prefix = uniqueIdPrefixOf(property);
    return prefix === "" ? String(row.entryNumber) : `${prefix}-${row.entryNumber}`;
  }
  if (property.type === "rollup") {
    return displayRollupCell(property, row.rollupValues?.[property.id]);
  }
  if (property.type === "formula") {
    const result = evaluateFormulaProperty(
      property,
      formulaContextOf(row, properties ?? [property]),
    );
    return result.ok ? formatFormulaValue(result.value) : "—";
  }
  if (property.type === "created-time") {
    return row.createdAt === undefined
      ? "—"
      : formatDatabaseDate(
          { kind: "instant", instant: row.createdAt },
          dateDisplayConfigOf(property),
        );
  }
  if (property.type === "last-edited-time") {
    const instant = row.updatedAt ?? uuidV7Timestamp(row.revisionId);
    return instant === null || instant === undefined
      ? "—"
      : formatDatabaseDate({ kind: "instant", instant }, dateDisplayConfigOf(property));
  }
  if (property.type === "relation") {
    const targets = row.relationTargets[property.id] ?? [];
    return targets.length === 0 ? "—" : DATABASE_COPY.value.linked(targets.length);
  }
  const value = row.values[property.id];
  if (value === undefined) {
    if (property.type === "status") {
      const defaultId = statusDefaultOptionId(property);
      const option = property.config.options.find(
        (candidate) => candidate.id === defaultId && candidate.state === "active",
      );
      if (option !== undefined) return option.label;
    }
    return "—";
  }
  switch (value.kind) {
    case "text":
      return value.value || DATABASE_COPY.value.emptyText;
    case "number":
      return formatDatabaseNumber(value.decimal, numberConfigOf(property));
    case "date":
    case "instant":
      return formatDatabaseDateForProperty(value, property);
    case "checkbox":
      return value.checked ? DATABASE_COPY.value.yes : DATABASE_COPY.value.no;
    case "files": {
      const count = value.fileIds.length + (value.externalUrls?.length ?? 0);
      return count === 0 ? "—" : `${count} fichier${count === 1 ? "" : "s"}`;
    }
    case "place":
      return value.name;
    case "status":
    case "select":
      return property.type === "status" || property.type === "select"
        ? (property.config.options.find(({ id }) => id === value.optionId)?.label ??
            DATABASE_COPY.common.unavailableOption)
        : DATABASE_COPY.common.unavailableOption;
    case "multi-select":
      return property.type === "multi-select"
        ? value.optionIds
            .map((id) => property.config.options.find((option) => option.id === id)?.label)
            .filter(Boolean)
            .join(", ") || "—"
        : "—";
  }
}
