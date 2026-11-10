import DecimalRuntime, { type Decimal as DecimalValue } from "decimal.js-light";
import { type DomainResult, err, ok } from "../content/types.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { DatabaseProperty, NonRelationPropertyValue, PropertyOption } from "./types.ts";

const DECIMAL_INPUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

// decimal.js-light is CommonJS at Node runtime but declares an ESM default.
// Node exposes the constructor under `default`; this narrow bridge keeps both
// native ESM execution and the published TypeScript declaration honest.
const Decimal = DecimalRuntime as unknown as typeof DecimalValue;

function invalid<T>(field: string, code = "invalid"): DomainResult<T> {
  return err("validation.invalid-payload", "Structured value is invalid", {
    invalidFields: [{ field, code }],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ().-]{3,40}$/;

/** URL values keep a real http(s) address; trimming is the only rewriting. */
export function normalizeUrl(input: string): DomainResult<string> {
  const value = input.trim();
  if (value.length === 0 || value.length > 2048) return invalid("url", "invalid-url");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return invalid("url", "invalid-url");
    }
    return ok(value);
  } catch {
    return invalid("url", "invalid-url");
  }
}

export function normalizeEmail(input: string): DomainResult<string> {
  const value = input.trim();
  if (value.length === 0 || value.length > 254 || !EMAIL.test(value)) {
    return invalid("email", "invalid-email");
  }
  return ok(value);
}

export function normalizePhone(input: string): DomainResult<string> {
  const value = input.trim();
  const digits = value.replace(/\D/g, "");
  if (value.length === 0 || value.length > 40 || digits.length < 3 || !PHONE.test(value)) {
    return invalid("phone", "invalid-phone");
  }
  return ok(value);
}

export function normalizeDecimal(input: string): DomainResult<string> {
  if (input.length === 0 || input.length > 512 || !DECIMAL_INPUT.test(input)) {
    return invalid("decimal", "invalid-decimal");
  }
  try {
    const canonical = new Decimal(input.startsWith("+") ? input.slice(1) : input).toFixed();
    return ok(canonical === "-0" ? "0" : canonical);
  } catch {
    return invalid("decimal", "invalid-decimal");
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function validDateParts(year: number, month: number, day: number): boolean {
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function normalizeCivilDate(input: string): DomainResult<string> {
  const match = CIVIL_DATE.exec(input);
  if (match === null) return invalid("date", "invalid-civil-date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validDateParts(year, month, day) ? ok(input) : invalid("date", "invalid-civil-date");
}

export function normalizeInstant(input: string): DomainResult<string> {
  const match = INSTANT.exec(input);
  if (match === null) return invalid("instant", "offset-required");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8] as string;
  if (
    !validDateParts(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
  ) {
    return invalid("instant", "invalid-instant");
  }
  const millis = Date.parse(input);
  if (!Number.isFinite(millis)) return invalid("instant", "invalid-instant");
  return ok(new Date(millis).toISOString());
}

function findOption(property: DatabaseProperty, optionId: unknown): PropertyOption | undefined {
  if (
    (property.type !== "status" &&
      property.type !== "select" &&
      property.type !== "multi-select") ||
    !isUuid(optionId)
  ) {
    return undefined;
  }
  return property.config.options.find((option) => option.id === optionId);
}

export interface ValueNormalizationOptions {
  readonly intent?: "write" | "decode";
}

export function normalizePropertyValue(
  property: DatabaseProperty,
  input: unknown,
  options: ValueNormalizationOptions = {},
): DomainResult<NonRelationPropertyValue | undefined> {
  if (input === undefined) return ok(undefined);
  const intent = options.intent ?? "write";
  if (property.type === "title" || property.type === "relation") {
    return invalid("value", "separate-storage");
  }
  if (property.state === "retired" && intent === "write") {
    return invalid("propertyId", "retired-property");
  }
  if (!isRecord(input) || typeof input["kind"] !== "string") {
    return invalid("value", "invalid-shape");
  }

  switch (property.type) {
    case "text":
      return input["kind"] === "text" &&
        typeof input["value"] === "string" &&
        hasOnlyKeys(input, ["kind", "value"])
        ? ok({ kind: "text", value: input["value"] })
        : invalid("value", "type-mismatch");
    case "created-time":
    case "last-edited-time":
    case "formula":
    case "rollup":
    case "unique-id":
      return invalid("value", "read-only");
    case "url":
    case "email":
    case "phone": {
      if (
        input["kind"] !== "text" ||
        typeof input["value"] !== "string" ||
        !hasOnlyKeys(input, ["kind", "value"])
      ) {
        return invalid("value", "type-mismatch");
      }
      const text = input["value"];
      if (intent === "decode") return ok({ kind: "text", value: text });
      const normalized =
        property.type === "url"
          ? normalizeUrl(text)
          : property.type === "email"
            ? normalizeEmail(text)
            : normalizePhone(text);
      return normalized.ok ? ok({ kind: "text", value: normalized.value }) : normalized;
    }
    case "number": {
      if (
        input["kind"] !== "number" ||
        typeof input["decimal"] !== "string" ||
        !hasOnlyKeys(input, ["kind", "decimal"])
      ) {
        return invalid("value", "type-mismatch");
      }
      const decimal = normalizeDecimal(input["decimal"]);
      return decimal.ok ? ok({ kind: "number", decimal: decimal.value }) : decimal;
    }
    case "date": {
      if (property.config.mode === "date") {
        if (
          input["kind"] !== "date" ||
          typeof input["date"] !== "string" ||
          !Object.keys(input).every((key) => key === "kind" || key === "date" || key === "endDate")
        ) {
          return invalid("value", "type-mismatch");
        }
        const date = normalizeCivilDate(input["date"]);
        if (input["endDate"] !== undefined && typeof input["endDate"] !== "string") {
          return invalid("endDate", "type-mismatch");
        }
        const endDate =
          input["endDate"] === undefined ? undefined : normalizeCivilDate(input["endDate"]);
        if (!date.ok) return date;
        if (endDate !== undefined && !endDate.ok) return endDate;
        return ok({
          kind: "date",
          date: date.value,
          ...(endDate === undefined ? {} : { endDate: endDate.value }),
        });
      }
      if (
        input["kind"] !== "instant" ||
        typeof input["instant"] !== "string" ||
        !Object.keys(input).every(
          (key) => key === "kind" || key === "instant" || key === "endInstant",
        )
      ) {
        return invalid("value", "type-mismatch");
      }
      const instant = normalizeInstant(input["instant"]);
      if (input["endInstant"] !== undefined && typeof input["endInstant"] !== "string") {
        return invalid("endInstant", "type-mismatch");
      }
      const endInstant =
        input["endInstant"] === undefined ? undefined : normalizeInstant(input["endInstant"]);
      if (!instant.ok) return instant;
      if (endInstant !== undefined && !endInstant.ok) return endInstant;
      return ok({
        kind: "instant",
        instant: instant.value,
        ...(endInstant === undefined ? {} : { endInstant: endInstant.value }),
      });
    }
    case "status":
    case "select": {
      if (input["kind"] !== property.type || !hasOnlyKeys(input, ["kind", "optionId"])) {
        return invalid("value", "type-mismatch");
      }
      const option = findOption(property, input["optionId"]);
      if (option === undefined || (option.state === "retired" && intent === "write")) {
        return invalid("optionId", option === undefined ? "unknown-option" : "retired-option");
      }
      return ok({ kind: property.type, optionId: option.id });
    }
    case "multi-select": {
      if (
        input["kind"] !== "multi-select" ||
        !Array.isArray(input["optionIds"]) ||
        !hasOnlyKeys(input, ["kind", "optionIds"])
      ) {
        return invalid("value", "type-mismatch");
      }
      const optionIds = [...new Set(input["optionIds"])]
        .filter((value): value is string => typeof value === "string")
        .sort();
      if (optionIds.length !== new Set(input["optionIds"]).size) {
        return invalid("optionIds", "invalid-identifier");
      }
      for (const optionId of optionIds) {
        const option = findOption(property, optionId);
        if (option === undefined || (option.state === "retired" && intent === "write")) {
          return invalid("optionIds", option === undefined ? "unknown-option" : "retired-option");
        }
      }
      return ok({ kind: "multi-select", optionIds: optionIds as never });
    }
    case "files": {
      if (
        input["kind"] !== "files" ||
        !Array.isArray(input["fileIds"]) ||
        (input["externalUrls"] !== undefined && !Array.isArray(input["externalUrls"])) ||
        !Object.keys(input).every(
          (key) => key === "kind" || key === "fileIds" || key === "externalUrls",
        )
      ) {
        return invalid("value", "type-mismatch");
      }
      const fileIds = [...new Set(input["fileIds"])];
      if (
        fileIds.length !== input["fileIds"].length ||
        fileIds.length > 20 ||
        !fileIds.every(isUuid)
      ) {
        return invalid("fileIds", "invalid-identifier");
      }
      const rawUrls = (input["externalUrls"] as unknown[] | undefined) ?? [];
      if (!rawUrls.every((url): url is string => typeof url === "string")) {
        return invalid("externalUrls", "invalid-url");
      }
      const externalUrls: string[] = [];
      for (const raw of rawUrls) {
        const normalized = normalizeUrl(raw);
        if (!normalized.ok) return normalized;
        if (!externalUrls.includes(normalized.value)) externalUrls.push(normalized.value);
      }
      if (externalUrls.length !== rawUrls.length || fileIds.length + externalUrls.length > 20) {
        return invalid("externalUrls", "invalid-url");
      }
      return ok({
        kind: "files",
        fileIds: fileIds as never,
        ...(externalUrls.length === 0 ? {} : { externalUrls }),
      });
    }
    case "checkbox":
      return input["kind"] === "checkbox" &&
        typeof input["checked"] === "boolean" &&
        hasOnlyKeys(input, ["kind", "checked"])
        ? ok({ kind: "checkbox", checked: input["checked"] })
        : invalid("value", "type-mismatch");
    case "place": {
      if (
        input["kind"] !== "place" ||
        typeof input["placeId"] !== "string" ||
        input["placeId"].trim().length === 0 ||
        input["placeId"].length > 512 ||
        typeof input["name"] !== "string" ||
        input["name"].trim().length === 0 ||
        input["name"].length > 512 ||
        (input["address"] !== null && typeof input["address"] !== "string") ||
        (typeof input["address"] === "string" && input["address"].length > 1024) ||
        typeof input["latitude"] !== "number" ||
        !Number.isFinite(input["latitude"]) ||
        input["latitude"] < -90 ||
        input["latitude"] > 90 ||
        typeof input["longitude"] !== "number" ||
        !Number.isFinite(input["longitude"]) ||
        input["longitude"] < -180 ||
        input["longitude"] > 180 ||
        !hasOnlyKeys(input, ["kind", "placeId", "name", "address", "latitude", "longitude"])
      ) {
        return invalid("value", "type-mismatch");
      }
      return ok({
        kind: "place",
        placeId: input["placeId"],
        name: input["name"],
        address: input["address"] as string | null,
        latitude: input["latitude"],
        longitude: input["longitude"],
      });
    }
  }
}

export function normalizeRelationTargets(
  property: DatabaseProperty,
  input: unknown,
  options: ValueNormalizationOptions = {},
): DomainResult<readonly Uuid[] | undefined> {
  if (input === undefined) return ok(undefined);
  if (property.type !== "relation") return invalid("relationTargets", "type-mismatch");
  if (property.state === "retired" && (options.intent ?? "write") === "write") {
    return invalid("propertyId", "retired-property");
  }
  if (!Array.isArray(input) || !input.every(isUuid)) {
    return invalid("relationTargets", "invalid-identifier");
  }
  const targets = [...new Set(input)].sort();
  if (property.config.cardinality === "one" && targets.length > 1) {
    return invalid("relationTargets", "cardinality-exceeded");
  }
  return ok(targets);
}

export function isPropertyValueCompatible(
  property: DatabaseProperty,
  value: NonRelationPropertyValue,
): boolean {
  if (property.type === "date") {
    return value.kind === property.config.mode;
  }
  if (property.type === "url" || property.type === "email" || property.type === "phone") {
    return value.kind === "text";
  }
  if (
    property.type === "created-time" ||
    property.type === "last-edited-time" ||
    property.type === "formula" ||
    property.type === "rollup" ||
    property.type === "unique-id"
  )
    return false;
  return property.type !== "title" && property.type !== "relation" && value.kind === property.type;
}

/** Normalize only structured values; relation endpoint availability belongs to adapters. */
export function normalizeEntryValueMap(
  properties: ReadonlyMap<Uuid, DatabaseProperty>,
  input: Readonly<Record<string, unknown>>,
): DomainResult<Readonly<Record<Uuid, NonRelationPropertyValue>>> {
  const values: Record<string, NonRelationPropertyValue> = {};
  for (const [propertyId, rawValue] of Object.entries(input)) {
    const property = properties.get(propertyId as Uuid);
    if (property === undefined || property.type === "title" || property.type === "relation")
      return err("validation.invalid-payload", "Structured value property is unavailable");
    // Existing values survive a replace payload even after their property is
    // retired. The UI never edits a retired field, and rejecting the whole map
    // made every entry save fail once one retired property had a value.
    const normalized = normalizePropertyValue(property, rawValue, {
      intent: property.state === "retired" ? "decode" : "write",
    });
    if (!normalized.ok || normalized.value === undefined)
      return normalized.ok
        ? err("validation.invalid-payload", "Structured value is absent")
        : normalized;
    values[propertyId] = normalized.value;
  }
  return ok(values);
}
