import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty } from "@myownnotion/domain";
import { DATABASE_COPY, DATABASE_LOCALE, formatDatabaseDecimal } from "./database-copy.ts";

export function displayDatabaseValue(
  row: DatabaseQueryPageDto["rows"][number],
  property: DatabaseProperty,
): string {
  if (property.type === "title") return row.title;
  if (property.type === "relation") {
    const targets = row.relationTargets[property.id] ?? [];
    return targets.length === 0 ? "—" : DATABASE_COPY.value.linked(targets.length);
  }
  const value = row.values[property.id];
  if (value === undefined) return "—";
  switch (value.kind) {
    case "text":
      return value.value || DATABASE_COPY.value.emptyText;
    case "number":
      return formatDatabaseDecimal(value.decimal);
    case "date":
      return value.date;
    case "instant":
      return new Intl.DateTimeFormat(DATABASE_LOCALE, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value.instant));
    case "checkbox":
      return value.checked ? DATABASE_COPY.value.yes : DATABASE_COPY.value.no;
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
