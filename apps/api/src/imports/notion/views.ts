import type {
  DatabaseProperty,
  DatabaseView,
  FilterCriterion,
  FilterOperator,
  FilterSet,
  SortCriterion,
  Uuid,
} from "@myownnotion/domain";
import { type NotionObject, object, objects, string } from "./api-client.ts";
import { type ImportIssue, importId } from "./model.ts";
import { convertValue, position } from "./properties.ts";

function viewFilter(
  raw: unknown,
  propertyMap: Map<string, DatabaseProperty>,
  id: Uuid,
): FilterSet | null {
  if (raw === null || raw === undefined) return { mode: "all", criteria: [] };
  const filter = object(raw);
  const mode = Array.isArray(filter["or"]) ? "any" : "all";
  const entries = Array.isArray(filter["or"])
    ? objects(filter["or"])
    : Array.isArray(filter["and"])
      ? objects(filter["and"])
      : [filter];
  const operators: Record<string, FilterOperator> = {
    equals: "equals",
    does_not_equal: "not-equals",
    contains: "contains",
    does_not_contain: "not-contains",
    is_empty: "is-empty",
    is_not_empty: "is-not-empty",
    before: "before",
    after: "after",
    less_than: "less-than",
    greater_than: "greater-than",
  };
  const criteria: FilterCriterion[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry["or"] || entry["and"]) return null;
    const prop = propertyMap.get(string(entry["property"]));
    const kind = [
      "title",
      "rich_text",
      "number",
      "checkbox",
      "select",
      "status",
      "multi_select",
      "date",
    ].find((kind) => entry[kind] !== undefined);
    if (!prop || !kind) return null;
    const condition = Object.entries(object(entry[kind]));
    if (condition.length !== 1) return null;
    const [sourceOperator, value] = condition[0] as [string, unknown];
    const operator = operators[sourceOperator];
    if (!operator) return null;
    const base = { id: importId(id, `filter:${index}`), propertyId: prop.id, operator };
    if (operator === "is-empty" || operator === "is-not-empty") {
      criteria.push(base);
      continue;
    }
    const converted =
      kind === "title" || kind === "rich_text"
        ? { kind: "text" as const, value: string(value) }
        : convertValue(
            prop,
            {
              type: kind,
              [kind]:
                kind === "multi_select"
                  ? [{ name: value }]
                  : kind === "select" || kind === "status"
                    ? { name: value }
                    : kind === "date"
                      ? { start: value }
                      : value,
            },
            [],
            "view",
          );
    if (!converted) return null;
    criteria.push({ ...base, operand: converted });
  }
  return { mode, criteria };
}

export function convertViews(
  jobId: Uuid,
  sid: string,
  properties: readonly DatabaseProperty[],
  propertyMap: Map<string, DatabaseProperty>,
  rawViews: readonly NotionObject[],
  issues: ImportIssue[],
): DatabaseView[] {
  const fallback = (id: Uuid, name: string, index: number): DatabaseView => ({
    id,
    name,
    type: "table",
    positionKey: position(index),
    state: "active",
    properties: properties.map((p, i) => ({
      propertyId: p.id,
      visible: true,
      positionKey: position(i),
    })),
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: null,
    options: { density: "comfortable", freezeTitle: true },
  });
  if (!rawViews.length) {
    issues.push({ code: "import.default-table-view", sourcePath: sid });
    return [fallback(importId(jobId, `view:${sid}:default`), "Import — table par défaut", 0)];
  }
  return rawViews.map((raw, index): DatabaseView => {
    const id = importId(jobId, `view:${string(raw["id"])}`),
      name = string(raw["name"]).slice(0, 170) || "Vue Notion";
    const base = fallback(id, name, index),
      type = string(raw["type"]),
      config = object(raw["configuration"]);
    // A missing filter/sort must never masquerade as the original view.
    const filter = viewFilter(raw["filter"], propertyMap, id);
    const rawSorts = objects(raw["sorts"]);
    const sorts: SortCriterion[] = rawSorts.flatMap((sort): SortCriterion[] => {
      const property = propertyMap.get(string(sort["property"]));
      const direction = sort["direction"];
      return property && (direction === "ascending" || direction === "descending")
        ? [{ propertyId: property.id, direction, missing: "last" as const }]
        : [];
    });
    const incompatible =
      filter === null ||
      Object.values(object(raw["quick_filters"])).some(
        (value) => Object.keys(object(value)).length > 0,
      ) ||
      sorts.length !== rawSorts.length ||
      config["sub_group_by"] != null ||
      config["subtasks"] != null;
    if (incompatible) {
      issues.push({
        code: "import.view-query-preserved-as-fallback",
        sourcePath: string(raw["id"]),
      });
      return { ...base, name: `${name} — table sans filtre (import)` };
    }
    const display = objects(config["properties"]);
    const presented = display.flatMap((entry, i) => {
      const prop = propertyMap.get(string(entry["property_id"]));
      return prop
        ? [
            {
              propertyId: prop.id,
              visible: entry["visible"] !== false,
              positionKey: position(i),
              ...(typeof entry["width"] === "number" && Number.isFinite(entry["width"])
                ? { width: Math.max(80, Math.min(800, Math.round(entry["width"]))) }
                : {}),
            },
          ]
        : [];
    });
    if (presented.length !== display.length)
      issues.push({
        code: "import.view-property-presentation-partial",
        sourcePath: string(raw["id"]),
      });
    if (
      display.some(
        (entry) =>
          typeof entry["width"] === "number" &&
          (!Number.isInteger(entry["width"]) || entry["width"] < 80 || entry["width"] > 800),
      )
    )
      issues.push({ code: "import.view-width-adjusted", sourcePath: string(raw["id"]) });
    if (sorts.length)
      issues.push({ code: "import.sort-empty-order-default", sourcePath: string(raw["id"]) });
    const presentation = {
      ...base,
      filter: filter ?? base.filter,
      sorts,
      properties: presented.length ? presented : base.properties,
    };
    const groupConfig = object(config["group_by"]);
    const group = propertyMap.get(string(groupConfig["property_id"]));
    // Query grouping and the board renderer support different property types.
    // Never persist a view that the native query rejects or displays on another axis.
    if (
      (type === "board" || (type === "table" && Object.keys(groupConfig).length > 0)) &&
      (group?.state !== "active" ||
        !(
          type === "board"
            ? ["status", "select", "multi-select"]
            : ["status", "select", "multi-select", "checkbox"]
        ).includes(group.type))
    ) {
      issues.push({
        code: "import.view-grouping-preserved-as-table",
        sourcePath: string(raw["id"]),
      });
      return { ...presentation, name: `${name} — table sans regroupement (import)` };
    }
    if (
      Object.keys(object(raw["quick_filters"])).length ||
      Object.keys(object(config["group_by"])).some((key) => !["type", "property_id"].includes(key))
    )
      issues.push({
        code: "import.view-grouping-or-controls-partial",
        sourcePath: string(raw["id"]),
      });
    // Preserve supported layout; detailed Notion presentation stays original.
    if (
      Object.keys(config).some(
        (key) => !["type", "properties", "group_by", "date_property_id"].includes(key),
      )
    )
      issues.push({ code: "import.view-presentation-partial", sourcePath: string(raw["id"]) });
    if (type === "list")
      return {
        ...presentation,
        type,
        options: {
          density: "comfortable",
          secondaryPropertyIds: presentation.properties
            .filter(
              (p) =>
                p.visible && properties.find((prop) => prop.id === p.propertyId)?.type !== "title",
            )
            .map((p) => p.propertyId),
        },
      };
    if (type === "gallery")
      return {
        ...presentation,
        type,
        options: {
          cardPropertyIds: presentation.properties
            .filter((p) => p.visible)
            .map((p) => p.propertyId),
          preview: "none",
        },
      };
    if (type === "board" && group && ["status", "select", "multi-select"].includes(group.type))
      return {
        ...presentation,
        type,
        group: { propertyId: group.id },
        options: {
          axisPropertyId: group.id,
          columnOrder:
            "options" in group.config ? group.config.options.map((option) => option.id) : [],
          collapsedColumnIds: [],
        },
      };
    const date = propertyMap.get(string(config["date_property_id"]));
    if (type === "calendar" && date?.type === "date")
      return { ...presentation, type, options: { datePropertyId: date.id, initialMode: "month" } };
    if (type === "table")
      return { ...presentation, group: group ? { propertyId: group.id } : null };
    issues.push({ code: "import.view-layout-preserved-as-table", sourcePath: string(raw["id"]) });
    return { ...presentation, name: `${name} — table (import)` };
  });
}
