import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type { DatabaseProperty } from "@myownnotion/domain";

export function displayDatabaseValue(
  row: DatabaseQueryPageDto["rows"][number],
  property: DatabaseProperty,
): string {
  if (property.type === "title") return row.title;
  if (property.type === "relation") {
    const targets = row.relationTargets[property.id] ?? [];
    return targets.length === 0 ? "—" : `${targets.length} linked`;
  }
  const value = row.values[property.id];
  if (value === undefined) return "—";
  switch (value.kind) {
    case "text":
      return value.value || "Empty text";
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value.instant));
    case "checkbox":
      return value.checked ? "Yes" : "No";
    case "status":
    case "select":
      return property.type === "status" || property.type === "select"
        ? (property.config.options.find(({ id }) => id === value.optionId)?.label ??
            "Unavailable option")
        : "Unavailable option";
    case "multi-select":
      return property.type === "multi-select"
        ? value.optionIds
            .map((id) => property.config.options.find((option) => option.id === id)?.label)
            .filter(Boolean)
            .join(", ") || "—"
        : "—";
  }
}
