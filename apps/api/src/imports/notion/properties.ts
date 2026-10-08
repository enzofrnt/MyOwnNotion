import {
  type DatabaseProperty,
  type NonRelationPropertyValue,
  normalizeCivilDate,
  normalizeInstant,
  type Uuid,
} from "@myownnotion/domain";
import { type NotionObject, object, objects, plainText, sourceId, string } from "./api-client.ts";
import { type ImportIssue, importId } from "./model.ts";

export const position = (index: number) => `a${index.toString(36).padStart(5, "0")}a`;
export function convertProperty(
  jobId: Uuid,
  sid: string,
  name: string,
  raw: NotionObject,
  index: number,
  rows: readonly NotionObject[],
  issues: ImportIssue[],
): DatabaseProperty {
  const type = string(raw["type"]),
    key = string(raw["id"]);
  if (
    name.length > 200 ||
    objects(object(raw[type])["options"]).some((option) => string(option["name"]).length > 200)
  )
    issues.push({ code: "import.name-shortened", sourcePath: sid });
  const base = {
    id: importId(jobId, `property:${sid}:${key}`),
    name: name.slice(0, 200) || "Propriété",
    positionKey: position(index),
    state: "active" as const,
  };
  if (
    (type === "number" && !["", "number"].includes(string(object(raw[type])["format"]))) ||
    (type === "status" && objects(object(raw[type])["groups"]).length > 0)
  )
    issues.push({ code: "import.property-configuration-partial", sourcePath: sid });
  if (type === "title" || type === "number" || type === "checkbox")
    return { ...base, type, config: {} };
  if (type === "rich_text") return { ...base, type: "text", config: {} };
  if (["select", "status", "multi_select"].includes(type)) {
    const options = objects(object(raw[type])["options"]).map((option, i) => ({
      id: importId(jobId, `option:${sid}:${key}:${string(option["id"]) || string(option["name"])}`),
      label: string(option["name"]).slice(0, 200),
      positionKey: position(i),
      tone: string(option["color"]) || "default",
      state: "active" as const,
    }));
    return {
      ...base,
      type: type === "multi_select" ? "multi-select" : (type as "select" | "status"),
      config: { options },
    };
  }
  if (type === "relation") return { ...base, type, config: { cardinality: "many" } };
  if (type === "date") {
    const instant = rows.some((row) => {
      const p = Object.values(object(row["properties"]))
        .map(object)
        .find((p) => p["id"] === key);
      return string(object(p?.["date"])["start"]).includes("T");
    });
    return { ...base, type, config: { mode: instant ? "instant" : "date" } };
  }
  issues.push({ code: "import.property-static-text", sourcePath: sid, detail: `${name}: ${type}` });
  return { ...base, type: "text", config: {} };
}
function readable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(readable).join(", ");
  const entry = object(value);
  return (
    string(entry["name"]) || string(entry["url"]) || string(entry["id"]) || JSON.stringify(value)
  );
}
export function convertValue(
  prop: DatabaseProperty,
  raw: NotionObject,
  issues: ImportIssue[],
  path: string,
): NonRelationPropertyValue | undefined {
  const type = string(raw["type"]),
    value = raw[type];
  if (value === undefined || value === null || prop.type === "title" || prop.type === "relation")
    return undefined;
  if (prop.type === "text") {
    if (
      type === "rich_text" &&
      objects(value).some((part) => {
        const annotations = object(part["annotations"]);
        return (
          part["href"] ||
          part["type"] !== "text" ||
          Object.entries(annotations).some(([key, value]) =>
            key === "color" ? value !== "default" : value === true,
          )
        );
      })
    )
      issues.push({ code: "import.property-rich-text-formatting-preserved", sourcePath: path });
    const text =
      type === "rich_text"
        ? plainText(value)
        : type === "formula" || type === "rollup"
          ? readable(object(value)[string(object(value)["type"])])
          : readable(value);
    return { kind: "text", value: text };
  }
  if (prop.type === "number")
    return typeof value === "number" && Number.isFinite(value)
      ? { kind: "number", decimal: String(value) }
      : undefined;
  if (prop.type === "checkbox") return { kind: "checkbox", checked: value === true };
  if (prop.type === "date") {
    const start = string(object(value)["start"]);
    if (object(value)["end"] || object(value)["time_zone"])
      issues.push({ code: "import.date-range-or-zone-preserved", sourcePath: path });
    if (prop.config.mode === "instant") {
      if (start && !start.includes("T"))
        issues.push({ code: "import.date-only-as-instant", sourcePath: path });
      const parsed = normalizeInstant(start.includes("T") ? start : `${start}T00:00:00.000Z`);
      if (parsed.ok) return { kind: "instant", instant: parsed.value };
    } else {
      const parsed = normalizeCivilDate(start);
      if (parsed.ok) return { kind: "date", date: parsed.value };
    }
    issues.push({ code: "import.date-value-preserved", sourcePath: path });
    return undefined;
  }
  if (prop.type === "multi-select") {
    const ids = objects(value).flatMap((option) => {
      const match = prop.config.options.find((entry) => entry.label === string(option["name"]));
      if (!match) issues.push({ code: "import.option-value-preserved", sourcePath: path });
      return match ? [match.id] : [];
    });
    return { kind: "multi-select", optionIds: ids };
  }
  const option = prop.config.options.find((entry) => entry.label === string(object(value)["name"]));
  if (!option) {
    issues.push({ code: "import.option-value-preserved", sourcePath: path });
    return undefined;
  }
  return { kind: prop.type, optionId: option.id };
}
export function relationIds(
  raw: NotionObject,
  identities: Map<string, Uuid>,
  issues: ImportIssue[],
  path: string,
): Uuid[] {
  return objects(raw["relation"]).flatMap((relation) => {
    const target = identities.get(sourceId(relation["id"]));
    if (!target) issues.push({ code: "import.relation-outside-selection", sourcePath: path });
    return target ? [target] : [];
  });
}
