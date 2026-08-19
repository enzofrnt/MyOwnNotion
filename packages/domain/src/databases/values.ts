import { Decimal } from "decimal.js-light";
import { type DomainResult, err, ok } from "../content/types.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { DatabaseProperty, NonRelationPropertyValue, PropertyOption } from "./types.ts";

const DECIMAL_INPUT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

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
          !hasOnlyKeys(input, ["kind", "date"])
        ) {
          return invalid("value", "type-mismatch");
        }
        const date = normalizeCivilDate(input["date"]);
        return date.ok ? ok({ kind: "date", date: date.value }) : date;
      }
      if (
        input["kind"] !== "instant" ||
        typeof input["instant"] !== "string" ||
        !hasOnlyKeys(input, ["kind", "instant"])
      ) {
        return invalid("value", "type-mismatch");
      }
      const instant = normalizeInstant(input["instant"]);
      return instant.ok ? ok({ kind: "instant", instant: instant.value }) : instant;
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
    case "checkbox":
      return input["kind"] === "checkbox" &&
        typeof input["checked"] === "boolean" &&
        hasOnlyKeys(input, ["kind", "checked"])
        ? ok({ kind: "checkbox", checked: input["checked"] })
        : invalid("value", "type-mismatch");
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
  return property.type !== "title" && property.type !== "relation" && value.kind === property.type;
}
