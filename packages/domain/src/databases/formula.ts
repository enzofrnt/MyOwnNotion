import type { Uuid } from "../ids/uuid.ts";
import { type RollupCell, rollupResultKind } from "./rollup.ts";
import { type DatabaseProperty, type NonRelationPropertyValue, uniqueIdPrefixOf } from "./types.ts";

/**
 * Side-effect-free expression language of the "Formule" property, shared by
 * every surface (table, entry panel, editor preview, server and local
 * filters). It only reads the current row: no network, no storage, no write.
 * Anything it cannot prove is an error, never a guessed value.
 */
export interface FormulaDate {
  readonly kind: "date";
  /** Epoch milliseconds. Civil dates sit at UTC midnight. */
  readonly time: number;
  readonly end?: number;
  readonly hasTime: boolean;
}

export type FormulaValue = string | number | boolean | null | FormulaDate | readonly FormulaValue[];

export type FormulaType = "text" | "number" | "boolean" | "date" | "list" | "empty";

export interface FormulaContext {
  readonly title: string;
  readonly properties: readonly DatabaseProperty[];
  readonly values: Readonly<Record<string, NonRelationPropertyValue>>;
  readonly relationTargets: Readonly<Record<string, readonly Uuid[]>>;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly revisionId?: string | undefined;
  readonly entryNumber?: number | undefined;
  readonly entryId?: string | undefined;
  /** Computed rollups of this row. A missing key is an unavailable rollup. */
  readonly rollupValues?: Readonly<Record<string, RollupCell>> | undefined;
  /** Titles of related pages, when the surface knows them. */
  readonly relationTitle?: ((id: Uuid) => string | undefined) | undefined;
  /** Fixed clock for one evaluation pass (tests, consistent pages). */
  readonly now?: number | undefined;
}

export type FormulaResult =
  | { readonly ok: true; readonly value: FormulaValue }
  | {
      readonly ok: false;
      readonly error: string;
      /** Character range of the fault in the expression, when known. */
      readonly start?: number;
      readonly end?: number;
    };

/** Formulas and rollups may reference each other up to this depth, as in Notion. */
export const FORMULA_MAX_DEPTH = 15;
const MAX_STEPS = 200_000;
const MAX_TEXT = 20_000;
const MAX_LIST = 10_000;

class FormulaError extends Error {
  constructor(
    message: string,
    readonly start?: number,
    readonly end?: number,
  ) {
    super(message);
  }
}

type TokenKind = "number" | "string" | "identifier" | "operator" | "eof";
interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: number | string;
  readonly start: number;
  readonly end: number;
}

const OPERATORS = [
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "<",
  ">",
  "!",
  "?",
  ":",
  ".",
  ",",
  "(",
  ")",
  "[",
  "]",
] as const;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < input.length) {
    const character = input[offset] as string;
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    if (input.startsWith("/*", offset)) {
      const close = input.indexOf("*/", offset + 2);
      if (close < 0) throw new FormulaError("Commentaire non terminé.", offset, input.length);
      offset = close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const start = offset;
      let value = "";
      offset += 1;
      while (offset < input.length && input[offset] !== character) {
        const current = input[offset] as string;
        if (current === "\\" && offset + 1 < input.length) {
          const escaped = input[offset + 1] as string;
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
          offset += 2;
          continue;
        }
        value += current;
        offset += 1;
      }
      if (input[offset] !== character) {
        throw new FormulaError("Chaîne non terminée.", start, input.length);
      }
      offset += 1;
      tokens.push({ kind: "string", text: input.slice(start, offset), value, start, end: offset });
      continue;
    }
    const rest = input.slice(offset);
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(rest);
    if (number !== null) {
      const text = number[0];
      tokens.push({
        kind: "number",
        text,
        value: Number(text),
        start: offset,
        end: offset + text.length,
      });
      offset += text.length;
      continue;
    }
    const identifier = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(rest);
    if (identifier !== null) {
      const text = identifier[0];
      tokens.push({ kind: "identifier", text, start: offset, end: offset + text.length });
      offset += text.length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (operator !== undefined) {
      tokens.push({
        kind: "operator",
        text: operator,
        start: offset,
        end: offset + operator.length,
      });
      offset += operator.length;
      continue;
    }
    throw new FormulaError(`Caractère inattendu « ${character} ».`, offset, offset + 1);
  }
  tokens.push({ kind: "eof", text: "", start: input.length, end: input.length });
  return tokens;
}

type Node =
  | { readonly t: "literal"; readonly value: FormulaValue }
  | { readonly t: "list"; readonly items: readonly Node[] }
  | {
      readonly t: "identifier";
      readonly name: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly t: "call";
      readonly name: string;
      readonly args: readonly Node[];
      readonly start: number;
      readonly end: number;
    }
  | { readonly t: "unary"; readonly op: "-" | "!"; readonly arg: Node }
  | {
      readonly t: "binary";
      readonly op: string;
      readonly left: Node;
      readonly right: Node;
      readonly start: number;
      readonly end: number;
    }
  | { readonly t: "conditional"; readonly test: Node; readonly then: Node; readonly else: Node };

class Parser {
  #index = 0;
  constructor(readonly tokens: readonly Token[]) {}

  #peek(): Token {
    return this.tokens[this.#index] as Token;
  }

  #next(): Token {
    const token = this.#peek();
    if (token.kind !== "eof") this.#index += 1;
    return token;
  }

  #isOperator(text: string): boolean {
    const token = this.#peek();
    return token.kind === "operator" && token.text === text;
  }

  #isWord(text: string): boolean {
    const token = this.#peek();
    return token.kind === "identifier" && token.text.toLowerCase() === text;
  }

  #accept(text: string): Token | null {
    if (!this.#isOperator(text)) return null;
    return this.#next();
  }

  #expect(text: string, message: string): Token {
    const token = this.#accept(text);
    if (token === null) {
      const found = this.#peek();
      throw new FormulaError(message, found.start, Math.max(found.end, found.start + 1));
    }
    return token;
  }

  parse(): Node {
    if (this.#peek().kind === "eof") throw new FormulaError("Expression attendue.", 0, 0);
    const node = this.#conditional();
    const rest = this.#peek();
    if (rest.kind !== "eof") {
      throw new FormulaError(`Élément inattendu « ${rest.text} ».`, rest.start, rest.end);
    }
    return node;
  }

  #conditional(): Node {
    const test = this.#or();
    if (this.#accept("?") === null) return test;
    const then = this.#conditional();
    this.#expect(":", "« : » attendu.");
    return { t: "conditional", test, then, else: this.#conditional() };
  }

  #binary(next: () => Node, matches: () => string | null): Node {
    let left = next();
    for (;;) {
      const start = this.#peek().start;
      const op = matches();
      if (op === null) return left;
      const operator = this.#next();
      const right = this.#operand(next, operator);
      left = { t: "binary", op, left, right, start, end: operator.end };
    }
  }

  #operand(next: () => Node, operator: Token): Node {
    const token = this.#peek();
    if (token.kind === "eof") {
      throw new FormulaError("Expression attendue.", operator.start, operator.end);
    }
    return next();
  }

  #or(): Node {
    return this.#binary(
      () => this.#and(),
      () => (this.#isOperator("||") || this.#isWord("or") ? "||" : null),
    );
  }

  #and(): Node {
    return this.#binary(
      () => this.#equality(),
      () => (this.#isOperator("&&") || this.#isWord("and") ? "&&" : null),
    );
  }

  #equality(): Node {
    return this.#binary(
      () => this.#comparison(),
      () => (this.#isOperator("==") ? "==" : this.#isOperator("!=") ? "!=" : null),
    );
  }

  #comparison(): Node {
    return this.#binary(
      () => this.#additive(),
      () => {
        for (const op of ["<=", ">=", "<", ">"]) if (this.#isOperator(op)) return op;
        return null;
      },
    );
  }

  #additive(): Node {
    return this.#binary(
      () => this.#multiplicative(),
      () => (this.#isOperator("+") ? "+" : this.#isOperator("-") ? "-" : null),
    );
  }

  #multiplicative(): Node {
    return this.#binary(
      () => this.#unary(),
      () => {
        for (const op of ["*", "/", "%"]) if (this.#isOperator(op)) return op;
        return null;
      },
    );
  }

  #unary(): Node {
    const minus = this.#accept("-");
    if (minus !== null)
      return { t: "unary", op: "-", arg: this.#operand(() => this.#unary(), minus) };
    const plus = this.#accept("+");
    if (plus !== null) return this.#operand(() => this.#unary(), plus);
    const bang = this.#accept("!");
    if (bang !== null)
      return { t: "unary", op: "!", arg: this.#operand(() => this.#unary(), bang) };
    if (this.#isWord("not")) {
      const following = this.tokens[this.#index + 1] as Token;
      // `not(x)` stays a call; `not x` is the prefix operator.
      if (!(following.kind === "operator" && following.text === "(")) {
        const word = this.#next();
        return { t: "unary", op: "!", arg: this.#operand(() => this.#unary(), word) };
      }
    }
    return this.#power();
  }

  #power(): Node {
    const base = this.#postfix();
    const start = this.#peek().start;
    const operator = this.#accept("^");
    if (operator === null) return base;
    const right = this.#operand(() => this.#unary(), operator);
    return { t: "binary", op: "^", left: base, right, start, end: operator.end };
  }

  #postfix(): Node {
    let node = this.#primary();
    while (this.#accept(".") !== null) {
      const name = this.#next();
      if (name.kind !== "identifier") {
        throw new FormulaError("Nom de fonction attendu après « . ».", name.start, name.end + 1);
      }
      const args = this.#isOperator("(") ? this.#arguments() : [];
      node = {
        t: "call",
        name: name.text,
        args: [node, ...args],
        start: name.start,
        end: name.end,
      };
    }
    return node;
  }

  #arguments(): Node[] {
    this.#expect("(", "« ( » attendu.");
    const args: Node[] = [];
    if (this.#accept(")") !== null) return args;
    for (;;) {
      args.push(this.#conditional());
      if (this.#accept(")") !== null) return args;
      this.#expect(",", "« , » ou « ) » attendu.");
    }
  }

  #primary(): Node {
    const token = this.#next();
    if (token.kind === "number" || token.kind === "string") {
      return { t: "literal", value: token.value as number | string };
    }
    if (token.kind === "operator" && token.text === "(") {
      const node = this.#conditional();
      this.#expect(")", "« ) » attendu.");
      return node;
    }
    if (token.kind === "operator" && token.text === "[") {
      const items: Node[] = [];
      if (this.#accept("]") !== null) return { t: "list", items };
      for (;;) {
        items.push(this.#conditional());
        if (this.#accept("]") !== null) return { t: "list", items };
        this.#expect(",", "« , » ou « ] » attendu.");
      }
    }
    if (token.kind === "identifier") {
      const lower = token.text.toLowerCase();
      if (this.#isOperator("(")) {
        return {
          t: "call",
          name: token.text,
          args: this.#arguments(),
          start: token.start,
          end: token.end,
        };
      }
      if (lower === "true") return { t: "literal", value: true };
      if (lower === "false") return { t: "literal", value: false };
      if (lower === "null") return { t: "literal", value: null };
      return { t: "identifier", name: token.text, start: token.start, end: token.end };
    }
    throw new FormulaError(
      "Expression attendue.",
      token.start,
      Math.max(token.end, token.start + 1),
    );
  }
}

const parseCache = new Map<string, Node | FormulaError>();

function parse(expression: string): Node {
  const cached = parseCache.get(expression);
  if (cached !== undefined) {
    if (cached instanceof FormulaError) throw cached;
    return cached;
  }
  let outcome: Node | FormulaError;
  try {
    outcome = new Parser(tokenize(expression)).parse();
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    outcome = error;
  }
  if (parseCache.size >= 500) parseCache.clear();
  parseCache.set(expression, outcome);
  if (outcome instanceof FormulaError) throw outcome;
  return outcome;
}

export function isFormulaDate(value: FormulaValue): value is FormulaDate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: FormulaValue): value is readonly FormulaValue[] {
  return Array.isArray(value);
}

export function formulaTypeOf(value: FormulaValue): FormulaType {
  if (value === null) return "empty";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return isList(value) ? "list" : "date";
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: number;
}

/** Civil dates read in UTC; instants read in the runtime zone, like the cells. */
function partsOf(time: number, hasTime: boolean): DateParts {
  const date = new Date(time);
  return hasTime
    ? {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
        weekday: date.getDay(),
      }
    : {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
        weekday: date.getUTCDay(),
      };
}

function isoOf(time: number, hasTime: boolean): string {
  const parts = partsOf(time, hasTime);
  const day = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  return hasTime ? `${day} ${pad(parts.hour)}:${pad(parts.minute)}` : day;
}

/** Neutral text form used by concatenation, `format()` and comparisons. */
export function formulaText(value: FormulaValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isList(value)) return value.map(formulaText).join(", ");
  const start = isoOf(value.time, value.hasTime);
  return value.end === undefined ? start : `${start} → ${isoOf(value.end, value.hasTime)}`;
}

function toNumber(value: FormulaValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : 0;
  }
  if (value === null) return 0;
  // A relation used to read as its number of pages: keep `prop("Rel") * 2` valid.
  if (isList(value)) return value.length;
  return value.time;
}

function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim() !== "";
  if (isList(value)) return value.length > 0;
  return true;
}

function isEmpty(value: FormulaValue): boolean {
  if (value === null || value === false || value === 0) return true;
  if (typeof value === "string") return value.trim() === "";
  return isList(value) && value.length === 0;
}

function parseDateText(text: string): FormulaDate | null {
  const trimmed = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    const time = Date.parse(`${trimmed}T00:00:00.000Z`);
    return Number.isFinite(time) ? { kind: "date", time, hasTime: false } : null;
  }
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? { kind: "date", time, hasTime: true } : null;
}

function toDate(value: FormulaValue): FormulaDate | null {
  if (value === null) return null;
  if (isFormulaDate(value)) return value;
  if (typeof value === "string") return parseDateText(value);
  return null;
}

function compare(left: FormulaValue, right: FormulaValue): number {
  if (isFormulaDate(left) || isFormulaDate(right)) {
    const a = toDate(left);
    const b = toDate(right);
    if (a !== null && b !== null) return a.time - b.time;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
  }
  return toNumber(left) - toNumber(right);
}

function equal(left: FormulaValue, right: FormulaValue): boolean {
  if (isList(left) && isList(right)) {
    return (
      left.length === right.length && left.every((item, index) => equal(item, right[index] ?? null))
    );
  }
  if (isFormulaDate(left) && isFormulaDate(right)) {
    return left.time === right.time && left.end === right.end;
  }
  if (typeof left === typeof right && !isList(left) && !isFormulaDate(left)) return left === right;
  if (left === null || right === null) return isEmpty(left) && isEmpty(right);
  return formulaText(left) === formulaText(right);
}

const UNITS: Readonly<Record<string, string>> = {
  year: "years",
  years: "years",
  quarter: "quarters",
  quarters: "quarters",
  month: "months",
  months: "months",
  week: "weeks",
  weeks: "weeks",
  day: "days",
  days: "days",
  hour: "hours",
  hours: "hours",
  minute: "minutes",
  minutes: "minutes",
  second: "seconds",
  seconds: "seconds",
  millisecond: "milliseconds",
  milliseconds: "milliseconds",
};

function unitOf(value: FormulaValue): string {
  const unit = UNITS[formulaText(value).trim().toLowerCase()];
  if (unit === undefined) {
    throw new FormulaError(`Unité de date inconnue « ${formulaText(value)} ».`);
  }
  return unit;
}

function shiftTime(time: number, hasTime: boolean, amount: number, unit: string): number {
  const date = new Date(time);
  const months = (count: number): void => {
    if (hasTime) date.setMonth(date.getMonth() + count);
    else date.setUTCMonth(date.getUTCMonth() + count);
  };
  switch (unit) {
    case "years":
      months(amount * 12);
      break;
    case "quarters":
      months(amount * 3);
      break;
    case "months":
      months(amount);
      break;
    case "weeks":
      return time + amount * 604_800_000;
    case "days":
      if (hasTime) date.setDate(date.getDate() + amount);
      else date.setUTCDate(date.getUTCDate() + amount);
      break;
    case "hours":
      return time + amount * 3_600_000;
    case "minutes":
      return time + amount * 60_000;
    case "seconds":
      return time + amount * 1000;
    default:
      return time + amount;
  }
  return date.getTime();
}

function shiftDate(date: FormulaDate, amount: number, unit: string): FormulaDate {
  const subDay = ["hours", "minutes", "seconds", "milliseconds"].includes(unit);
  const hasTime = date.hasTime || subDay;
  return {
    kind: "date",
    hasTime,
    time: shiftTime(date.time, hasTime, amount, unit),
    ...(date.end === undefined ? {} : { end: shiftTime(date.end, hasTime, amount, unit) }),
  };
}

function monthsBetween(left: FormulaDate, right: FormulaDate): number {
  const a = partsOf(left.time, left.hasTime);
  const b = partsOf(right.time, right.hasTime);
  let months = (a.year - b.year) * 12 + (a.month - b.month);
  const behind =
    a.day < b.day || (a.day === b.day && a.hour * 60 + a.minute < b.hour * 60 + b.minute);
  const ahead =
    a.day > b.day || (a.day === b.day && a.hour * 60 + a.minute > b.hour * 60 + b.minute);
  if (months > 0 && behind) months -= 1;
  if (months < 0 && ahead) months += 1;
  return months;
}

function between(left: FormulaDate, right: FormulaDate, unit: string): number {
  const ms = left.time - right.time;
  const whole = (value: number): number => Math.trunc(value) + 0;
  switch (unit) {
    case "years":
      return whole(monthsBetween(left, right) / 12);
    case "quarters":
      return whole(monthsBetween(left, right) / 3);
    case "months":
      return monthsBetween(left, right);
    case "weeks":
      return whole(ms / 604_800_000);
    case "days":
      return whole(ms / 86_400_000);
    case "hours":
      return whole(ms / 3_600_000);
    case "minutes":
      return whole(ms / 60_000);
    case "seconds":
      return whole(ms / 1000);
    default:
      return ms;
  }
}

function isoWeek(date: FormulaDate): number {
  const parts = partsOf(date.time, date.hasTime);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const SHORT_MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function formatDatePattern(date: FormulaDate, pattern: string): string {
  const parts = partsOf(date.time, date.hasTime);
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const month = MONTHS[parts.month - 1] as string;
  const weekday = WEEKDAYS[parts.weekday] as string;
  const tokens: Readonly<Record<string, string>> = {
    YYYY: pad(parts.year, 4),
    YY: pad(parts.year % 100),
    MMMM: month,
    MMM: SHORT_MONTHS[parts.month - 1] as string,
    MM: pad(parts.month),
    M: String(parts.month),
    DD: pad(parts.day),
    D: String(parts.day),
    dddd: weekday,
    ddd: `${weekday.slice(0, 3)}.`,
    HH: pad(parts.hour),
    H: String(parts.hour),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(parts.minute),
    ss: pad(parts.second),
    A: parts.hour < 12 ? "AM" : "PM",
    a: parts.hour < 12 ? "am" : "pm",
  };
  return pattern.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/gu,
    (match, literal: string | undefined) => literal ?? tokens[match] ?? match,
  );
}

function regex(pattern: FormulaValue, flags: string): RegExp {
  try {
    return new RegExp(formulaText(pattern), flags);
  } catch {
    throw new FormulaError(`Motif invalide « ${formulaText(pattern)} ».`);
  }
}

function bounded(text: string): string {
  if (text.length > MAX_TEXT) throw new FormulaError("Le texte produit est trop long.");
  return text;
}

function boundedList(list: readonly FormulaValue[]): readonly FormulaValue[] {
  if (list.length > MAX_LIST) throw new FormulaError("La liste produite est trop longue.");
  return list;
}

function numbers(args: readonly FormulaValue[]): number[] {
  const values: number[] = [];
  const visit = (value: FormulaValue): void => {
    if (isList(value)) for (const item of value) visit(item);
    else if (value !== null) values.push(toNumber(value));
  };
  for (const value of args) visit(value);
  return values;
}

function listOf(value: FormulaValue): readonly FormulaValue[] {
  if (isList(value)) return value;
  return value === null ? [] : [value];
}

function roundTo(value: number, digits: number): number {
  const places = Math.max(-15, Math.min(15, Math.trunc(digits)));
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

interface Scope {
  readonly context: FormulaContext;
  readonly variables: ReadonlyMap<string, FormulaValue>;
  readonly state: EvaluationState;
}

interface EvaluationState {
  steps: number;
  readonly depth: number;
  readonly stack: ReadonlySet<string>;
  readonly now: number;
}

type Eager = (args: readonly FormulaValue[], scope: Scope) => FormulaValue;

interface FunctionSpec {
  readonly min: number;
  readonly max: number;
  readonly run: Eager;
}

function fn(min: number, max: number, run: Eager): FunctionSpec {
  return { min, max, run };
}

const arg = (args: readonly FormulaValue[], index: number): FormulaValue => args[index] ?? null;
const text = (args: readonly FormulaValue[], index: number): string =>
  formulaText(arg(args, index));
const num = (args: readonly FormulaValue[], index: number): number => toNumber(arg(args, index));
const MANY = 1000;

function dateArg(args: readonly FormulaValue[], index: number): FormulaDate | null {
  return toDate(arg(args, index));
}

function part(pick: (date: FormulaDate) => number): Eager {
  return (args) => {
    const date = dateArg(args, 0);
    return date === null ? null : pick(date);
  };
}

const EAGER: Readonly<Record<string, FunctionSpec>> = {
  // General
  empty: fn(0, 1, (args) => isEmpty(arg(args, 0))),
  length: fn(1, 1, (args) => {
    const value = arg(args, 0);
    return isList(value) ? value.length : [...formulaText(value)].length;
  }),
  format: fn(1, 1, (args) => text(args, 0)),
  text: fn(1, 1, (args) => text(args, 0)),
  equal: fn(2, 2, (args) => equal(arg(args, 0), arg(args, 1))),
  unequal: fn(2, 2, (args) => !equal(arg(args, 0), arg(args, 1))),
  not: fn(1, 1, (args) => !truthy(arg(args, 0))),
  id: fn(0, 0, (_args, scope) => scope.context.entryId ?? null),
  // Text
  substring: fn(2, 3, (args) =>
    [...text(args, 0)]
      .slice(Math.trunc(num(args, 1)), args.length > 2 ? Math.trunc(num(args, 2)) : undefined)
      .join(""),
  ),
  contains: fn(2, 2, (args) => text(args, 0).includes(text(args, 1))),
  test: fn(2, 2, (args) => regex(arg(args, 1), "u").test(text(args, 0))),
  match: fn(2, 2, (args) => text(args, 0).match(regex(arg(args, 1), "gu")) ?? []),
  replace: fn(3, 3, (args) =>
    bounded(text(args, 0).replace(regex(arg(args, 1), "u"), text(args, 2))),
  ),
  replaceall: fn(3, 3, (args) =>
    bounded(text(args, 0).replace(regex(arg(args, 1), "gu"), text(args, 2))),
  ),
  lower: fn(1, 1, (args) => text(args, 0).toLocaleLowerCase("fr")),
  upper: fn(1, 1, (args) => text(args, 0).toLocaleUpperCase("fr")),
  trim: fn(1, 1, (args) => text(args, 0).trim()),
  repeat: fn(2, 2, (args) => {
    const count = Math.max(0, Math.trunc(num(args, 1)));
    if (text(args, 0).length * count > MAX_TEXT) {
      throw new FormulaError("Le texte produit est trop long.");
    }
    return text(args, 0).repeat(count);
  }),
  padstart: fn(3, 3, (args) => {
    const size = Math.min(MAX_TEXT, Math.max(0, Math.trunc(num(args, 1))));
    return text(args, 0).padStart(size, text(args, 2));
  }),
  padend: fn(3, 3, (args) => {
    const size = Math.min(MAX_TEXT, Math.max(0, Math.trunc(num(args, 1))));
    return text(args, 0).padEnd(size, text(args, 2));
  }),
  concat: fn(0, MANY, (args) =>
    args.some(isList)
      ? boundedList(args.flatMap((value) => listOf(value)))
      : bounded(args.map(formulaText).join("")),
  ),
  join: fn(2, 2, (args) => bounded(listOf(arg(args, 0)).map(formulaText).join(text(args, 1)))),
  split: fn(1, 2, (args) =>
    boundedList(args.length > 1 ? text(args, 0).split(text(args, 1)) : text(args, 0).split(",")),
  ),
  // Numbers
  add: fn(2, 2, (args) => num(args, 0) + num(args, 1)),
  subtract: fn(2, 2, (args) => num(args, 0) - num(args, 1)),
  multiply: fn(2, 2, (args) => num(args, 0) * num(args, 1)),
  divide: fn(2, 2, (args) => (num(args, 1) === 0 ? null : num(args, 0) / num(args, 1))),
  mod: fn(2, 2, (args) => (num(args, 1) === 0 ? null : num(args, 0) % num(args, 1))),
  pow: fn(2, 2, (args) => num(args, 0) ** num(args, 1)),
  min: fn(1, MANY, (args) => {
    const values = numbers(args);
    return values.length === 0 ? null : Math.min(...values);
  }),
  max: fn(1, MANY, (args) => {
    const values = numbers(args);
    return values.length === 0 ? null : Math.max(...values);
  }),
  sum: fn(0, MANY, (args) => numbers(args).reduce((total, value) => total + value, 0)),
  mean: fn(1, MANY, (args) => {
    const values = numbers(args);
    return values.length === 0
      ? null
      : values.reduce((total, value) => total + value, 0) / values.length;
  }),
  median: fn(1, MANY, (args) => {
    const values = numbers(args).sort((left, right) => left - right);
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? ((values[middle - 1] as number) + (values[middle] as number)) / 2
      : (values[middle] as number);
  }),
  abs: fn(1, 1, (args) => Math.abs(num(args, 0))),
  round: fn(1, 2, (args) => roundTo(num(args, 0), args.length > 1 ? num(args, 1) : 0)),
  ceil: fn(1, 1, (args) => Math.ceil(num(args, 0))),
  floor: fn(1, 1, (args) => Math.floor(num(args, 0))),
  sqrt: fn(1, 1, (args) => (num(args, 0) < 0 ? null : Math.sqrt(num(args, 0)))),
  cbrt: fn(1, 1, (args) => Math.cbrt(num(args, 0))),
  exp: fn(1, 1, (args) => Math.exp(num(args, 0))),
  ln: fn(1, 1, (args) => (num(args, 0) <= 0 ? null : Math.log(num(args, 0)))),
  log10: fn(1, 1, (args) => (num(args, 0) <= 0 ? null : Math.log10(num(args, 0)))),
  log2: fn(1, 1, (args) => (num(args, 0) <= 0 ? null : Math.log2(num(args, 0)))),
  sign: fn(1, 1, (args) => Math.sign(num(args, 0))),
  pi: fn(0, 0, () => Math.PI),
  e: fn(0, 0, () => Math.E),
  tonumber: fn(1, 1, (args) => {
    const value = arg(args, 0);
    if (value === null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
    }
    return toNumber(value);
  }),
  number: fn(1, 1, (args) => num(args, 0)),
  // Dates
  now: fn(0, 0, (_args, scope) => ({ kind: "date", time: scope.state.now, hasTime: true })),
  today: fn(0, 0, (_args, scope) => {
    const parts = partsOf(scope.state.now, true);
    return {
      kind: "date",
      time: Date.UTC(parts.year, parts.month - 1, parts.day),
      hasTime: false,
    };
  }),
  minute: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).minute),
  ),
  hour: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).hour),
  ),
  day: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).weekday || 7),
  ),
  date: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).day),
  ),
  week: fn(1, 1, part(isoWeek)),
  month: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).month),
  ),
  year: fn(
    1,
    1,
    part((date) => partsOf(date.time, date.hasTime).year),
  ),
  dateadd: fn(3, 3, (args) => {
    const date = dateArg(args, 0);
    return date === null ? null : shiftDate(date, Math.trunc(num(args, 1)), unitOf(arg(args, 2)));
  }),
  datesubtract: fn(3, 3, (args) => {
    const date = dateArg(args, 0);
    return date === null ? null : shiftDate(date, -Math.trunc(num(args, 1)), unitOf(arg(args, 2)));
  }),
  datebetween: fn(3, 3, (args) => {
    const left = dateArg(args, 0);
    const right = dateArg(args, 1);
    return left === null || right === null ? null : between(left, right, unitOf(arg(args, 2)));
  }),
  daterange: fn(2, 2, (args) => {
    const start = dateArg(args, 0);
    const end = dateArg(args, 1);
    if (start === null || end === null) return null;
    return { kind: "date", time: start.time, end: end.time, hasTime: start.hasTime || end.hasTime };
  }),
  datestart: fn(1, 1, (args) => {
    const date = dateArg(args, 0);
    return date === null ? null : { kind: "date", time: date.time, hasTime: date.hasTime };
  }),
  dateend: fn(1, 1, (args) => {
    const date = dateArg(args, 0);
    return date === null
      ? null
      : { kind: "date", time: date.end ?? date.time, hasTime: date.hasTime };
  }),
  timestamp: fn(
    1,
    1,
    part((date) => date.time),
  ),
  fromtimestamp: fn(1, 1, (args) => {
    const time = num(args, 0);
    return Number.isFinite(time) ? { kind: "date", time, hasTime: true } : null;
  }),
  formatdate: fn(2, 2, (args) => {
    const date = dateArg(args, 0);
    return date === null ? null : formatDatePattern(date, text(args, 1));
  }),
  parsedate: fn(1, 1, (args) => parseDateText(text(args, 0))),
  // Lists
  at: fn(2, 2, (args) => listOf(arg(args, 0)).at(Math.trunc(num(args, 1))) ?? null),
  first: fn(1, 1, (args) => listOf(arg(args, 0))[0] ?? null),
  last: fn(1, 1, (args) => listOf(arg(args, 0)).at(-1) ?? null),
  slice: fn(2, 3, (args) =>
    listOf(arg(args, 0)).slice(
      Math.trunc(num(args, 1)),
      args.length > 2 ? Math.trunc(num(args, 2)) : undefined,
    ),
  ),
  reverse: fn(1, 1, (args) => [...listOf(arg(args, 0))].reverse()),
  unique: fn(1, 1, (args) => {
    const seen: FormulaValue[] = [];
    for (const item of listOf(arg(args, 0))) {
      if (!seen.some((candidate) => equal(candidate, item))) seen.push(item);
    }
    return seen;
  }),
  includes: fn(2, 2, (args) => listOf(arg(args, 0)).some((item) => equal(item, arg(args, 1)))),
  flat: fn(1, 1, (args) => boundedList(listOf(arg(args, 0)).flatMap((item) => listOf(item)))),
};

/** Functions whose arguments are evaluated on demand or per list item. */
const LAZY = new Set([
  "if",
  "ifs",
  "and",
  "or",
  "let",
  "lets",
  "map",
  "filter",
  "find",
  "findindex",
  "some",
  "every",
  "sort",
  "prop",
]);

/** Every callable name, lower-cased. Editors must not advertise anything else. */
export const FORMULA_FUNCTION_NAMES: readonly string[] = [...Object.keys(EAGER), ...LAZY].sort();

function findProperty(context: FormulaContext, name: string): DatabaseProperty | undefined {
  const active = context.properties.filter((candidate) => candidate.state === "active");
  return (
    active.find((candidate) => candidate.name === name) ??
    active.find(
      (candidate) => candidate.name.localeCompare(name, "fr", { sensitivity: "base" }) === 0,
    )
  );
}

function dateValue(textValue: string | undefined, end?: string): FormulaValue {
  if (textValue === undefined) return null;
  const start = parseDateText(textValue);
  if (start === null) return null;
  const endDate = end === undefined ? null : parseDateText(end);
  return endDate === null ? start : { ...start, end: endDate.time };
}

function optionLabel(property: DatabaseProperty, optionId: string): string | null {
  return property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
    ? (property.config.options.find((option) => option.id === optionId)?.label ?? null)
    : null;
}

function rollupValue(
  property: Extract<DatabaseProperty, { type: "rollup" }>,
  scope: Scope,
): FormulaValue {
  const { context } = scope;
  const computed = context.rollupValues?.[property.id];
  if (computed === undefined) {
    throw new FormulaError(`L’agrégation « ${property.name} » est indisponible.`);
  }
  if (computed === null || typeof computed === "number") return computed;
  if (typeof computed !== "string") return computed as readonly FormulaValue[];
  return rollupResultKind(property.config.aggregate) === "date"
    ? (parseDateText(computed) ?? computed)
    : computed;
}

function propertyValue(property: DatabaseProperty, scope: Scope): FormulaValue {
  const { context, state } = scope;
  switch (property.type) {
    case "title":
      return context.title;
    case "created-time":
      return dateValue(context.createdAt);
    case "last-edited-time":
      return dateValue(context.updatedAt);
    case "unique-id": {
      if (context.entryNumber === undefined) return null;
      const prefix = uniqueIdPrefixOf(property);
      return prefix === "" ? String(context.entryNumber) : `${prefix}-${context.entryNumber}`;
    }
    case "relation":
      return (context.relationTargets[property.id] ?? []).map(
        (id) => context.relationTitle?.(id) ?? id,
      );
    case "rollup":
      if (state.depth >= FORMULA_MAX_DEPTH) {
        throw new FormulaError("Trop de niveaux de formules et d’agrégations imbriquées.");
      }
      return rollupValue(property, scope);
    case "formula": {
      if (state.stack.has(property.id)) {
        throw new FormulaError(`Référence circulaire vers « ${property.name} ».`);
      }
      if (state.depth >= FORMULA_MAX_DEPTH) {
        throw new FormulaError("Trop de niveaux de formules et d’agrégations imbriquées.");
      }
      const nested: EvaluationState = {
        steps: state.steps,
        depth: state.depth + 1,
        stack: new Set([...state.stack, property.id]),
        now: state.now,
      };
      const node = parseNested(property);
      const value = evaluate(node, { context, variables: new Map(), state: nested });
      state.steps = nested.steps;
      return value;
    }
    default:
      break;
  }
  const value = context.values[property.id];
  if (value === undefined) return property.type === "checkbox" ? false : null;
  switch (value.kind) {
    case "text":
      return value.value;
    case "number": {
      const number = Number(value.decimal);
      return Number.isFinite(number) ? number : null;
    }
    case "date":
      return dateValue(value.date, value.endDate);
    case "instant":
      return dateValue(value.instant);
    case "checkbox":
      return value.checked;
    case "files":
      return [...value.fileIds, ...(value.externalUrls ?? [])];
    case "place":
      return value.name;
    case "status":
    case "select":
      return optionLabel(property, value.optionId);
    case "multi-select":
      return value.optionIds
        .map((id) => optionLabel(property, id))
        .filter((label): label is string => label !== null);
  }
}

function parseNested(property: Extract<DatabaseProperty, { type: "formula" }>): Node {
  try {
    return parse(property.config.expression);
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new FormulaError(`La formule « ${property.name} » est invalide.`);
    }
    throw error;
  }
}

function step(scope: Scope): void {
  scope.state.steps += 1;
  if (scope.state.steps > MAX_STEPS)
    throw new FormulaError("La formule est trop coûteuse à calculer.");
}

function withVariables(scope: Scope, entries: readonly (readonly [string, FormulaValue])[]): Scope {
  const variables = new Map(scope.variables);
  for (const [name, value] of entries) variables.set(name, value);
  return { ...scope, variables };
}

function arity(node: Extract<Node, { t: "call" }>, min: number, max: number): void {
  if (node.args.length < min || node.args.length > max) {
    const expected =
      min === max ? String(min) : max >= MANY ? `au moins ${min}` : `${min} à ${max}`;
    throw new FormulaError(
      `${node.name}() attend ${expected} argument${max > 1 ? "s" : ""}.`,
      node.start,
      node.end,
    );
  }
}

function variableName(node: Node | undefined, call: Extract<Node, { t: "call" }>): string {
  if (node?.t !== "identifier") {
    throw new FormulaError(`${call.name}() attend un nom de variable.`, call.start, call.end);
  }
  return node.name;
}

function each(
  node: Extract<Node, { t: "call" }>,
  scope: Scope,
): {
  readonly list: readonly FormulaValue[];
  readonly run: (item: FormulaValue, index: number) => FormulaValue;
} {
  arity(node, 2, 2);
  const list = listOf(evaluate(node.args[0] as Node, scope));
  const body = node.args[1] as Node;
  return {
    list,
    run: (item, index) =>
      evaluate(
        body,
        withVariables(scope, [
          ["current", item],
          ["index", index],
        ]),
      ),
  };
}

function callLazy(name: string, node: Extract<Node, { t: "call" }>, scope: Scope): FormulaValue {
  const value = (index: number): FormulaValue => evaluate(node.args[index] as Node, scope);
  switch (name) {
    case "prop": {
      arity(node, 1, 1);
      const target = node.args[0] as Node;
      if (target.t !== "literal" || typeof target.value !== "string") {
        throw new FormulaError(
          "prop() attend un nom de propriété entre guillemets.",
          node.start,
          node.end,
        );
      }
      const property = findProperty(scope.context, target.value);
      if (property === undefined) {
        throw new FormulaError(`Propriété inconnue « ${target.value} ».`, node.start, node.end);
      }
      return propertyValue(property, scope);
    }
    case "if":
      arity(node, 3, 3);
      return truthy(value(0)) ? value(1) : value(2);
    case "ifs": {
      arity(node, 2, MANY);
      for (let index = 0; index + 1 < node.args.length; index += 2) {
        if (truthy(value(index))) return value(index + 1);
      }
      return node.args.length % 2 === 1 ? value(node.args.length - 1) : null;
    }
    case "and":
      arity(node, 1, MANY);
      return node.args.every((_arg, index) => truthy(value(index)));
    case "or":
      arity(node, 1, MANY);
      return node.args.some((_arg, index) => truthy(value(index)));
    case "let": {
      arity(node, 3, 3);
      const variable = variableName(node.args[0], node);
      return evaluate(node.args[2] as Node, withVariables(scope, [[variable, value(1)]]));
    }
    case "lets": {
      arity(node, 3, MANY);
      if (node.args.length % 2 === 0) {
        throw new FormulaError(
          "lets() attend des paires nom/valeur puis une expression.",
          node.start,
          node.end,
        );
      }
      let current = scope;
      for (let index = 0; index + 1 < node.args.length; index += 2) {
        const variable = variableName(node.args[index], node);
        current = withVariables(current, [
          [variable, evaluate(node.args[index + 1] as Node, current)],
        ]);
      }
      return evaluate(node.args.at(-1) as Node, current);
    }
    case "map": {
      const { list, run } = each(node, scope);
      return list.map(run);
    }
    case "filter": {
      const { list, run } = each(node, scope);
      return list.filter((item, index) => truthy(run(item, index)));
    }
    case "find": {
      const { list, run } = each(node, scope);
      return list.find((item, index) => truthy(run(item, index))) ?? null;
    }
    case "findindex": {
      const { list, run } = each(node, scope);
      return list.findIndex((item, index) => truthy(run(item, index)));
    }
    case "some": {
      const { list, run } = each(node, scope);
      return list.some((item, index) => truthy(run(item, index)));
    }
    case "every": {
      const { list, run } = each(node, scope);
      return list.every((item, index) => truthy(run(item, index)));
    }
    case "sort": {
      arity(node, 1, 2);
      const list = listOf(value(0));
      const body = node.args[1];
      const keyed = list.map((item, index) => ({
        item,
        key:
          body === undefined
            ? item
            : evaluate(
                body,
                withVariables(scope, [
                  ["current", item],
                  ["index", index],
                ]),
              ),
      }));
      return keyed.sort((left, right) => compare(left.key, right.key)).map(({ item }) => item);
    }
    default:
      throw new FormulaError(`Fonction inconnue « ${node.name} ».`, node.start, node.end);
  }
}

function binary(node: Extract<Node, { t: "binary" }>, scope: Scope): FormulaValue {
  if (node.op === "&&")
    return truthy(evaluate(node.left, scope)) && truthy(evaluate(node.right, scope));
  if (node.op === "||")
    return truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope));
  const left = evaluate(node.left, scope);
  const right = evaluate(node.right, scope);
  switch (node.op) {
    case "==":
      return equal(left, right);
    case "!=":
      return !equal(left, right);
    case "<":
      return compare(left, right) < 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">":
      return compare(left, right) > 0;
    case ">=":
      return compare(left, right) >= 0;
    case "+":
      if (isList(left) && isList(right)) return boundedList([...left, ...right]);
      return typeof left === "string" || typeof right === "string"
        ? bounded(formulaText(left) + formulaText(right))
        : toNumber(left) + toNumber(right);
    case "-":
      return toNumber(left) - toNumber(right);
    case "*":
      return toNumber(left) * toNumber(right);
    case "/":
      return toNumber(right) === 0 ? null : toNumber(left) / toNumber(right);
    case "%":
      return toNumber(right) === 0 ? null : toNumber(left) % toNumber(right);
    case "^":
      return toNumber(left) ** toNumber(right);
    default:
      throw new FormulaError(`Opérateur inconnu « ${node.op} ».`, node.start, node.end);
  }
}

function evaluate(node: Node, scope: Scope): FormulaValue {
  step(scope);
  switch (node.t) {
    case "literal":
      return node.value;
    case "list":
      return node.items.map((item) => evaluate(item, scope));
    case "unary": {
      const value = evaluate(node.arg, scope);
      return node.op === "-" ? -toNumber(value) : !truthy(value);
    }
    case "conditional":
      return truthy(evaluate(node.test, scope))
        ? evaluate(node.then, scope)
        : evaluate(node.else, scope);
    case "binary":
      return binary(node, scope);
    case "identifier": {
      if (scope.variables.has(node.name)) return scope.variables.get(node.name) ?? null;
      const property = findProperty(scope.context, node.name);
      if (property !== undefined) return propertyValue(property, scope);
      throw new FormulaError(
        `« ${node.name} » n’est ni une propriété ni une variable.`,
        node.start,
        node.end,
      );
    }
    case "call": {
      const name = node.name.toLowerCase();
      if (LAZY.has(name)) return callLazy(name, node, scope);
      const spec = EAGER[name];
      if (spec === undefined) {
        throw new FormulaError(`Fonction inconnue « ${node.name} ».`, node.start, node.end);
      }
      arity(node, spec.min, spec.max);
      const args = node.args.map((item) => evaluate(item, scope));
      try {
        return spec.run(args, scope);
      } catch (error) {
        if (error instanceof FormulaError && error.start === undefined) {
          throw new FormulaError(error.message, node.start, node.end);
        }
        throw error;
      }
    }
  }
}

function failure(error: unknown): FormulaResult {
  if (error instanceof FormulaError) {
    return {
      ok: false,
      error: error.message,
      ...(error.start === undefined ? {} : { start: error.start, end: error.end ?? error.start }),
    };
  }
  if (error instanceof RangeError) return { ok: false, error: "La formule est trop imbriquée." };
  throw error;
}

/** Syntax check only: says whether the expression can be saved. */
export function checkFormulaSyntax(expression: string): FormulaResult {
  try {
    parse(expression);
    return { ok: true, value: null };
  } catch (error) {
    return failure(error);
  }
}

export function evaluateFormula(expression: string, context: FormulaContext): FormulaResult {
  try {
    const node = parse(expression);
    const state: EvaluationState = {
      steps: 0,
      depth: 0,
      stack: new Set(),
      now: context.now ?? Date.now(),
    };
    const value = evaluate(node, { context, variables: new Map(), state });
    if (typeof value === "number" && !Number.isFinite(value)) return { ok: true, value: null };
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/** Evaluates a formula property, guarding against a reference to itself. */
export function evaluateFormulaProperty(
  property: Extract<DatabaseProperty, { type: "formula" }>,
  context: FormulaContext,
): FormulaResult {
  try {
    const node = parse(property.config.expression);
    const state: EvaluationState = {
      steps: 0,
      depth: 0,
      stack: new Set([property.id]),
      now: context.now ?? Date.now(),
    };
    const value = evaluate(node, { context, variables: new Map(), state });
    if (typeof value === "number" && !Number.isFinite(value)) return { ok: true, value: null };
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}
