import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { DomainResult, SafeErrorCode } from "./types.ts";
import { err, ok } from "./types.ts";

export const DATABASE_PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "date",
  "checkbox",
  "relation",
] as const;
export const DATABASE_VIEW_MODES = ["table", "board", "gallery"] as const;
export const DATABASE_SORT_DIRECTIONS = ["asc", "desc"] as const;

export const DATABASE_LIMITS = {
  properties: 20,
  records: 1_000,
  selectOptions: 50,
  relationTargets: 200,
  labelLength: 128,
  titleLength: 512,
  textLength: 10_000,
  queryLength: 512,
} as const;

export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];
export type DatabaseViewMode = (typeof DATABASE_VIEW_MODES)[number];
export type DatabaseSortDirection = (typeof DATABASE_SORT_DIRECTIONS)[number];

export interface DatabaseSelectOption {
  readonly optionId: Uuid;
  readonly name: string;
}

export type DatabaseProperty =
  | {
      readonly propertyId: Uuid;
      readonly name: string;
      readonly type: Exclude<DatabasePropertyType, "select">;
    }
  | {
      readonly propertyId: Uuid;
      readonly name: string;
      readonly type: "select";
      readonly options: readonly DatabaseSelectOption[];
    };

export type DatabaseValue =
  | { readonly propertyId: Uuid; readonly type: "text"; readonly value: string }
  | { readonly propertyId: Uuid; readonly type: "number"; readonly value: number | null }
  | { readonly propertyId: Uuid; readonly type: "select"; readonly value: Uuid | null }
  | { readonly propertyId: Uuid; readonly type: "date"; readonly value: string | null }
  | { readonly propertyId: Uuid; readonly type: "checkbox"; readonly value: boolean }
  | { readonly propertyId: Uuid; readonly type: "relation"; readonly value: readonly Uuid[] };

export interface DatabaseRecord {
  readonly recordId: Uuid;
  readonly title: string;
  readonly values: readonly DatabaseValue[];
}

export interface DatabaseView {
  readonly mode: DatabaseViewMode;
  readonly query: string;
  readonly sortPropertyId: Uuid | null;
  readonly sortDirection: DatabaseSortDirection;
  readonly boardGroupPropertyId: Uuid | null;
}

export interface DatabaseBlockAttributes {
  readonly [key: string]: unknown;
  readonly databaseId: Uuid;
  readonly schemaVersion: 1;
  readonly properties: readonly DatabaseProperty[];
  readonly records: readonly DatabaseRecord[];
  readonly view: DatabaseView;
}

export interface DatabaseBoardGroup {
  readonly groupId: Uuid | null;
  readonly label: string;
  readonly records: readonly DatabaseRecord[];
}

export interface DatabaseRelationDiagnostic {
  readonly sourceRecordId: Uuid;
  readonly propertyId: Uuid;
  readonly targetRecordId: Uuid;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function invalid(
  path: string,
  fieldCode: string,
  code: SafeErrorCode = "validation.invalid-payload",
): DomainResult<never> {
  return err(code, "Invalid database block structure", {
    invalidFields: [{ field: path, code: fieldCode }],
  });
}

function normalizedLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= DATABASE_LIMITS.labelLength ? trimmed : null;
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function validateProperty(value: unknown, path: string): DomainResult<DatabaseProperty> {
  if (!isRecord(value) || !isUuid(value["propertyId"]) || normalizedLabel(value["name"]) === null) {
    return invalid(path, "invalid-property");
  }
  if (!(DATABASE_PROPERTY_TYPES as readonly unknown[]).includes(value["type"])) {
    return invalid(`${path}.type`, "unsupported-property-type", "document.unsupported-content");
  }
  if (value["type"] !== "select") {
    if (!hasOnlyKeys(value, ["propertyId", "name", "type"])) {
      return invalid(path, "invalid-property-fields");
    }
    return ok(value as unknown as DatabaseProperty);
  }
  if (!hasOnlyKeys(value, ["propertyId", "name", "type", "options"])) {
    return invalid(path, "invalid-select-property-fields");
  }
  if (!Array.isArray(value["options"]) || value["options"].length > DATABASE_LIMITS.selectOptions) {
    return invalid(`${path}.options`, "invalid-select-options");
  }
  const optionIds = new Set<string>();
  const optionNames = new Set<string>();
  for (let index = 0; index < value["options"].length; index += 1) {
    const option = value["options"][index];
    const optionPath = `${path}.options[${index}]`;
    if (
      !isRecord(option) ||
      !hasOnlyKeys(option, ["optionId", "name"]) ||
      !isUuid(option["optionId"]) ||
      normalizedLabel(option["name"]) === null
    ) {
      return invalid(optionPath, "invalid-select-option");
    }
    const normalizedName = (option["name"] as string).trim().toLocaleLowerCase();
    if (optionIds.has(option["optionId"]) || optionNames.has(normalizedName)) {
      return invalid(optionPath, "duplicate-select-option");
    }
    optionIds.add(option["optionId"]);
    optionNames.add(normalizedName);
  }
  return ok(value as unknown as DatabaseProperty);
}

function validateValue(
  value: unknown,
  property: DatabaseProperty,
  path: string,
): DomainResult<DatabaseValue> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["propertyId", "type", "value"]) ||
    value["propertyId"] !== property.propertyId ||
    value["type"] !== property.type
  ) {
    return invalid(path, "property-value-mismatch");
  }
  const cell = value["value"];
  switch (property.type) {
    case "text":
      if (typeof cell !== "string" || cell.length > DATABASE_LIMITS.textLength) {
        return invalid(`${path}.value`, "invalid-text-value");
      }
      break;
    case "number":
      if (!(cell === null || (typeof cell === "number" && Number.isFinite(cell)))) {
        return invalid(`${path}.value`, "invalid-number-value");
      }
      break;
    case "select":
      if (
        !(
          cell === null ||
          (isUuid(cell) && property.options.some((option) => option.optionId === cell))
        )
      ) {
        return invalid(`${path}.value`, "unknown-select-option");
      }
      break;
    case "date":
      if (!(cell === null || (typeof cell === "string" && isRealCalendarDate(cell)))) {
        return invalid(`${path}.value`, "invalid-date-value");
      }
      break;
    case "checkbox":
      if (typeof cell !== "boolean") return invalid(`${path}.value`, "invalid-checkbox-value");
      break;
    case "relation": {
      if (!Array.isArray(cell) || cell.length > DATABASE_LIMITS.relationTargets) {
        return invalid(`${path}.value`, "invalid-relation-value");
      }
      const targets = new Set<string>();
      for (const target of cell) {
        if (!isUuid(target) || targets.has(target)) {
          return invalid(`${path}.value`, "invalid-relation-target");
        }
        targets.add(target);
      }
      break;
    }
  }
  return ok(value as unknown as DatabaseValue);
}

function validateView(
  value: unknown,
  properties: readonly DatabaseProperty[],
  path: string,
): DomainResult<DatabaseView> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "mode",
      "query",
      "sortPropertyId",
      "sortDirection",
      "boardGroupPropertyId",
    ]) ||
    !(DATABASE_VIEW_MODES as readonly unknown[]).includes(value["mode"]) ||
    typeof value["query"] !== "string" ||
    value["query"].length > DATABASE_LIMITS.queryLength ||
    !(DATABASE_SORT_DIRECTIONS as readonly unknown[]).includes(value["sortDirection"])
  ) {
    return invalid(path, "invalid-view");
  }
  const sortPropertyId = value["sortPropertyId"];
  if (
    !(
      sortPropertyId === null ||
      (isUuid(sortPropertyId) &&
        properties.some((property) => property.propertyId === sortPropertyId))
    )
  ) {
    return invalid(`${path}.sortPropertyId`, "unknown-sort-property");
  }
  const groupPropertyId = value["boardGroupPropertyId"];
  if (
    !(
      groupPropertyId === null ||
      (isUuid(groupPropertyId) &&
        properties.some(
          (property) => property.propertyId === groupPropertyId && property.type === "select",
        ))
    )
  ) {
    return invalid(`${path}.boardGroupPropertyId`, "invalid-board-group-property");
  }
  return ok(value as unknown as DatabaseView);
}

export function validateDatabaseBlockAttributes(
  value: unknown,
  path = "attrs",
): DomainResult<DatabaseBlockAttributes> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["databaseId", "schemaVersion", "properties", "records", "view"]) ||
    !isUuid(value["databaseId"]) ||
    value["schemaVersion"] !== 1 ||
    !Array.isArray(value["properties"]) ||
    value["properties"].length > DATABASE_LIMITS.properties ||
    !Array.isArray(value["records"]) ||
    value["records"].length > DATABASE_LIMITS.records
  ) {
    return invalid(path, "invalid-database-attributes");
  }

  const properties: DatabaseProperty[] = [];
  const propertyIds = new Set<string>();
  const propertyNames = new Set<string>();
  for (let index = 0; index < value["properties"].length; index += 1) {
    const result = validateProperty(value["properties"][index], `${path}.properties[${index}]`);
    if (!result.ok) return result;
    const normalizedName = result.value.name.trim().toLocaleLowerCase();
    if (propertyIds.has(result.value.propertyId) || propertyNames.has(normalizedName)) {
      return invalid(`${path}.properties[${index}]`, "duplicate-property");
    }
    propertyIds.add(result.value.propertyId);
    propertyNames.add(normalizedName);
    properties.push(result.value);
  }

  const records: DatabaseRecord[] = [];
  const recordIds = new Set<string>();
  for (let index = 0; index < value["records"].length; index += 1) {
    const record = value["records"][index];
    const recordPath = `${path}.records[${index}]`;
    if (
      !isRecord(record) ||
      !hasOnlyKeys(record, ["recordId", "title", "values"]) ||
      !isUuid(record["recordId"]) ||
      typeof record["title"] !== "string" ||
      record["title"].length > DATABASE_LIMITS.titleLength ||
      !Array.isArray(record["values"])
    ) {
      return invalid(recordPath, "invalid-record");
    }
    if (recordIds.has(record["recordId"])) return invalid(recordPath, "duplicate-record");
    recordIds.add(record["recordId"]);
    const values: DatabaseValue[] = [];
    const valuedProperties = new Set<string>();
    for (let valueIndex = 0; valueIndex < record["values"].length; valueIndex += 1) {
      const rawValue = record["values"][valueIndex];
      const valuePath = `${recordPath}.values[${valueIndex}]`;
      if (!isRecord(rawValue) || !isUuid(rawValue["propertyId"])) {
        return invalid(valuePath, "invalid-value");
      }
      const property = properties.find((entry) => entry.propertyId === rawValue["propertyId"]);
      if (property === undefined) return invalid(valuePath, "unknown-property");
      if (valuedProperties.has(property.propertyId)) return invalid(valuePath, "duplicate-value");
      const result = validateValue(rawValue, property, valuePath);
      if (!result.ok) return result;
      valuedProperties.add(property.propertyId);
      values.push(result.value);
    }
    records.push({ recordId: record["recordId"], title: record["title"], values });
  }

  const view = validateView(value["view"], properties, `${path}.view`);
  if (!view.ok) return view;
  return ok({
    databaseId: value["databaseId"],
    schemaVersion: 1,
    properties,
    records,
    view: view.value,
  });
}

export function createEmptyDatabaseAttributes(databaseId: Uuid): DatabaseBlockAttributes {
  return {
    databaseId,
    schemaVersion: 1,
    properties: [],
    records: [],
    view: {
      mode: "table",
      query: "",
      sortPropertyId: null,
      sortDirection: "asc",
      boardGroupPropertyId: null,
    },
  };
}

function valueFor(record: DatabaseRecord, propertyId: Uuid): DatabaseValue | undefined {
  return record.values.find((value) => value.propertyId === propertyId);
}

export function readableDatabaseValue(
  database: DatabaseBlockAttributes,
  record: DatabaseRecord,
  property: DatabaseProperty,
): string {
  const entry = valueFor(record, property.propertyId);
  if (entry === undefined) return "";
  switch (entry.type) {
    case "text":
      return entry.value;
    case "number":
      return entry.value === null ? "" : String(entry.value);
    case "select":
      return entry.value === null
        ? ""
        : ((property.type === "select"
            ? property.options.find((option) => option.optionId === entry.value)?.name
            : undefined) ?? "Unavailable option");
    case "date":
      return entry.value ?? "";
    case "checkbox":
      return entry.value ? "Checked" : "Unchecked";
    case "relation":
      return entry.value
        .map(
          (targetId) =>
            database.records.find((candidate) => candidate.recordId === targetId)?.title ||
            "Unavailable record",
        )
        .join(", ");
  }
}

function normalized(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase();
}

function compareText(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparableValue(
  database: DatabaseBlockAttributes,
  record: DatabaseRecord,
  property: DatabaseProperty | undefined,
): string | number | boolean | null {
  if (property === undefined) return record.title;
  const entry = valueFor(record, property.propertyId);
  if (entry === undefined) return null;
  switch (entry.type) {
    case "text":
    case "date":
      return entry.value === "" ? null : entry.value;
    case "number":
    case "select":
      if (entry.value === null) return null;
      return entry.type === "select"
        ? readableDatabaseValue(database, record, property)
        : entry.value;
    case "checkbox":
      return entry.value;
    case "relation": {
      const readable = readableDatabaseValue(database, record, property);
      return readable === "" ? null : readable;
    }
  }
}

function compareComparable(
  left: string | number | boolean | null,
  right: string | number | boolean | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return compareText(String(left), String(right));
}

export function projectDatabaseRecords(
  database: DatabaseBlockAttributes,
  view: DatabaseView = database.view,
): DatabaseRecord[] {
  const query = normalized(view.query.trim());
  const property =
    view.sortPropertyId === null
      ? undefined
      : database.properties.find((entry) => entry.propertyId === view.sortPropertyId);
  return database.records
    .filter((record) => {
      if (query === "") return true;
      return normalized(
        [
          record.title,
          ...database.properties.map((entry) => readableDatabaseValue(database, record, entry)),
        ].join("\n"),
      ).includes(query);
    })
    .sort((left, right) => {
      const leftValue = comparableValue(database, left, property);
      const rightValue = comparableValue(database, right, property);
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      const compared = compareComparable(leftValue, rightValue);
      if (compared !== 0) return view.sortDirection === "asc" ? compared : -compared;
      return left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0;
    });
}

export function groupDatabaseRecords(
  database: DatabaseBlockAttributes,
  records: readonly DatabaseRecord[] = projectDatabaseRecords(database),
): DatabaseBoardGroup[] {
  const property = database.properties.find(
    (entry) => entry.propertyId === database.view.boardGroupPropertyId && entry.type === "select",
  );
  if (property === undefined || property.type !== "select") {
    return [{ groupId: null, label: "Unassigned", records: [...records] }];
  }
  const groups: DatabaseBoardGroup[] = property.options.map((option) => ({
    groupId: option.optionId,
    label: option.name,
    records: records.filter(
      (record) => valueFor(record, property.propertyId)?.value === option.optionId,
    ),
  }));
  groups.push({
    groupId: null,
    label: "Unassigned",
    records: records.filter((record) => {
      const value = valueFor(record, property.propertyId);
      return value === undefined || value.type !== "select" || value.value === null;
    }),
  });
  return groups;
}

export function databaseRelationDiagnostics(
  database: DatabaseBlockAttributes,
): DatabaseRelationDiagnostic[] {
  const recordIds = new Set(database.records.map((record) => record.recordId));
  return database.records.flatMap((record) =>
    record.values.flatMap((value) =>
      value.type === "relation"
        ? value.value
            .filter((targetRecordId) => !recordIds.has(targetRecordId))
            .map((targetRecordId) => ({
              sourceRecordId: record.recordId,
              propertyId: value.propertyId,
              targetRecordId,
            }))
        : [],
    ),
  );
}
