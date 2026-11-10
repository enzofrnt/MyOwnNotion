import {
  type DatabaseProperty,
  type NonRelationPropertyValue,
  type Uuid,
  uniqueIdPrefixOf,
} from "@myownnotion/domain";

/**
 * A deliberately small, side-effect-free expression language for the
 * "Formule" property. It only reads the current row: no network, no storage,
 * no implicit writes. Anything the parser cannot prove is reported as an error
 * and rendered as "—" instead of being guessed.
 */
export type FormulaValue = string | number | boolean | null;

export interface FormulaContext {
  readonly title: string;
  readonly properties: readonly DatabaseProperty[];
  readonly values: Readonly<Record<string, NonRelationPropertyValue>>;
  readonly relationTargets: Readonly<Record<string, readonly Uuid[]>>;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly revisionId?: string | undefined;
  readonly entryNumber?: number | undefined;
}

export type FormulaResult =
  | { readonly ok: true; readonly value: FormulaValue }
  | { readonly ok: false; readonly error: string };

type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "operator"; readonly value: string }
  | { readonly kind: "paren"; readonly value: "(" | ")" }
  | { readonly kind: "comma" }
  | { readonly kind: "eof" };

class FormulaError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < input.length) {
    const character = input[offset] as string;
    if (/\s/.test(character)) {
      offset += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", value: character });
      offset += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ kind: "comma" });
      offset += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      offset += 1;
      while (offset < input.length && input[offset] !== quote) {
        const current = input[offset] as string;
        if (current === "\\" && offset + 1 < input.length) {
          value += input[offset + 1];
          offset += 2;
          continue;
        }
        value += current;
        offset += 1;
      }
      if (input[offset] !== quote) throw new FormulaError("Chaîne non terminée");
      offset += 1;
      tokens.push({ kind: "string", value });
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(input.slice(offset));
    if (number !== null) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      offset += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(offset));
    if (identifier !== null) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      offset += identifier[0].length;
      continue;
    }
    const two = input.slice(offset, offset + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      tokens.push({ kind: "operator", value: two });
      offset += 2;
      continue;
    }
    if (["+", "-", "*", "/", "%", "<", ">", "!"].includes(character)) {
      tokens.push({ kind: "operator", value: character });
      offset += 1;
      continue;
    }
    throw new FormulaError(`Caractère inattendu « ${character} »`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

function toNumber(value: FormulaValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function toText(value: FormulaValue): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  return String(value);
}

function parseDate(value: FormulaValue): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDateUnit(date: Date, amount: number, unit: string): Date {
  const next = new Date(date.getTime());
  switch (unit) {
    case "years":
      next.setUTCFullYear(next.getUTCFullYear() + amount);
      break;
    case "quarters":
      next.setUTCMonth(next.getUTCMonth() + amount * 3);
      break;
    case "months":
      next.setUTCMonth(next.getUTCMonth() + amount);
      break;
    case "weeks":
      next.setUTCDate(next.getUTCDate() + amount * 7);
      break;
    case "days":
      next.setUTCDate(next.getUTCDate() + amount);
      break;
    case "hours":
      next.setUTCHours(next.getUTCHours() + amount);
      break;
    case "minutes":
      next.setUTCMinutes(next.getUTCMinutes() + amount);
      break;
    default:
      return date;
  }
  return next;
}

function dateDifference(left: Date, right: Date, unit: string): number {
  const ms = right.getTime() - left.getTime();
  switch (unit) {
    case "minutes":
      return ms / 60_000;
    case "hours":
      return ms / 3_600_000;
    case "days":
      return ms / 86_400_000;
    case "weeks":
      return ms / 604_800_000;
    case "months":
      return (
        (right.getUTCFullYear() - left.getUTCFullYear()) * 12 +
        (right.getUTCMonth() - left.getUTCMonth()) +
        (right.getUTCDate() - left.getUTCDate()) / 31
      );
    case "years":
      return dateDifference(left, right, "months") / 12;
    default:
      return ms / 86_400_000;
  }
}

function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.trim() !== "";
}

function propertyValue(
  property: DatabaseProperty,
  context: FormulaContext,
  depth: number,
): FormulaValue {
  if (property.state !== "active") return null;
  if (property.type === "title") return context.title;
  if (property.type === "created-time") return context.createdAt ?? null;
  if (property.type === "last-edited-time") return context.updatedAt ?? null;
  if (property.type === "formula") {
    if (depth > 8) throw new FormulaError("Formule imbriquée trop profonde");
    const result = evaluateFormula(property.config.expression, context, depth + 1);
    return result.ok ? result.value : null;
  }
  if (property.type === "relation") return (context.relationTargets[property.id] ?? []).length;
  if (property.type === "unique-id") {
    if (context.entryNumber === undefined) return null;
    const prefix = uniqueIdPrefixOf(property);
    return prefix === "" ? String(context.entryNumber) : `${prefix}-${context.entryNumber}`;
  }
  if (property.type === "rollup")
    return (context.relationTargets[property.config.relationPropertyId] ?? []).length;
  const value = context.values[property.id];
  if (value === undefined) return null;
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return Number(value.decimal);
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "checkbox":
      return value.checked;
    case "files":
      return value.fileIds.length + (value.externalUrls?.length ?? 0);
    case "place":
      return value.name;
    case "status":
    case "select":
      return property.type === "status" || property.type === "select"
        ? (property.config.options.find((option) => option.id === value.optionId)?.label ?? null)
        : null;
    case "multi-select":
      return property.type === "multi-select"
        ? value.optionIds
            .map((id) => property.config.options.find((option) => option.id === id)?.label)
            .filter((label): label is string => label !== undefined)
            .join(", ")
        : null;
  }
}

class Parser {
  #index = 0;
  constructor(
    readonly tokens: readonly Token[],
    readonly context: FormulaContext,
    readonly depth: number,
  ) {}

  #peek(): Token {
    return this.tokens[this.#index] as Token;
  }

  #next(): Token {
    const token = this.#peek();
    this.#index += 1;
    return token;
  }

  #acceptOperator(value: string): boolean {
    const token = this.#peek();
    if (token.kind === "operator" && token.value === value) {
      this.#index += 1;
      return true;
    }
    return false;
  }

  parse(): FormulaValue {
    const value = this.#or();
    if (this.#peek().kind !== "eof") throw new FormulaError("Expression incomplète");
    return value;
  }

  #or(): FormulaValue {
    let left = this.#and();
    while (this.#acceptOperator("||")) {
      const right = this.#and();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  #and(): FormulaValue {
    let left = this.#equality();
    while (this.#acceptOperator("&&")) {
      const right = this.#equality();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  #equality(): FormulaValue {
    let left = this.#comparison();
    for (;;) {
      if (this.#acceptOperator("==")) left = toText(left) === toText(this.#comparison());
      else if (this.#acceptOperator("!=")) left = toText(left) !== toText(this.#comparison());
      else return left;
    }
  }

  #comparison(): FormulaValue {
    let left = this.#additive();
    for (;;) {
      if (this.#acceptOperator("<")) left = toNumber(left) < toNumber(this.#additive());
      else if (this.#acceptOperator("<=")) left = toNumber(left) <= toNumber(this.#additive());
      else if (this.#acceptOperator(">")) left = toNumber(left) > toNumber(this.#additive());
      else if (this.#acceptOperator(">=")) left = toNumber(left) >= toNumber(this.#additive());
      else return left;
    }
  }

  #additive(): FormulaValue {
    let left = this.#multiplicative();
    for (;;) {
      if (this.#acceptOperator("+")) {
        const right = this.#multiplicative();
        left =
          typeof left === "string" || typeof right === "string"
            ? toText(left) + toText(right)
            : toNumber(left) + toNumber(right);
      } else if (this.#acceptOperator("-")) {
        left = toNumber(left) - toNumber(this.#multiplicative());
      } else return left;
    }
  }

  #multiplicative(): FormulaValue {
    let left = this.#unary();
    for (;;) {
      if (this.#acceptOperator("*")) left = toNumber(left) * toNumber(this.#unary());
      else if (this.#acceptOperator("/")) {
        const divisor = toNumber(this.#unary());
        left = divisor === 0 ? null : toNumber(left) / divisor;
      } else if (this.#acceptOperator("%")) {
        const divisor = toNumber(this.#unary());
        left = divisor === 0 ? null : toNumber(left) % divisor;
      } else return left;
    }
  }

  #unary(): FormulaValue {
    if (this.#acceptOperator("-")) return -toNumber(this.#unary());
    if (this.#acceptOperator("!")) return !truthy(this.#unary());
    return this.#primary();
  }

  #primary(): FormulaValue {
    const token = this.#next();
    if (token.kind === "number" || token.kind === "string") return token.value;
    if (token.kind === "paren") {
      if (token.value !== "(") throw new FormulaError("Parenthèse inattendue");
      const value = this.#or();
      const close = this.#next();
      if (close.kind !== "paren" || close.value !== ")") {
        throw new FormulaError("Parenthèse fermante attendue");
      }
      return value;
    }
    if (token.kind === "identifier") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      const next = this.#peek();
      if (next.kind === "paren" && next.value === "(") {
        this.#index += 1;
        return this.#call(token.value.toLowerCase());
      }
      throw new FormulaError(`Fonction inconnue « ${token.value} »`);
    }
    throw new FormulaError("Valeur attendue");
  }

  #arguments(): FormulaValue[] {
    const args: FormulaValue[] = [];
    if (this.#peek().kind === "paren" && this.#peek().kind === "paren") {
      const token = this.#peek() as { kind: "paren"; value: string };
      if (token.value === ")") {
        this.#index += 1;
        return args;
      }
    }
    for (;;) {
      args.push(this.#or());
      const token = this.#next();
      if (token.kind === "paren" && token.value === ")") return args;
      if (token.kind !== "comma") throw new FormulaError("Virgule ou parenthèse attendue");
    }
  }

  #call(name: string): FormulaValue {
    if (name === "prop") {
      const token = this.#next();
      if (token.kind !== "string") throw new FormulaError("prop() attend un nom de propriété");
      const close = this.#next();
      if (close.kind !== "paren" || close.value !== ")") {
        throw new FormulaError("prop() attend un seul argument");
      }
      const property = this.context.properties.find(
        (candidate) =>
          candidate.state === "active" &&
          candidate.name.localeCompare(token.value, "fr", { sensitivity: "base" }) === 0,
      );
      if (property === undefined) throw new FormulaError(`Propriété inconnue « ${token.value} »`);
      return propertyValue(property, this.context, this.depth);
    }
    const args = this.#arguments();
    switch (name) {
      case "if":
        return args.length === 3
          ? truthy(args[0] ?? null)
            ? (args[1] ?? null)
            : (args[2] ?? null)
          : null;
      case "round": {
        const value = toNumber(args[0] ?? null);
        const digits =
          args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(toNumber(args[1] ?? 0)))) : 0;
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
      }
      case "abs":
        return Math.abs(toNumber(args[0] ?? null));
      case "concat":
        return args.map(toText).join("");
      case "length":
        return toText(args[0] ?? null).length;
      case "lower":
        return toText(args[0] ?? null).toLowerCase();
      case "upper":
        return toText(args[0] ?? null).toUpperCase();
      case "number":
        return toNumber(args[0] ?? null);
      case "text":
      case "format":
        return toText(args[0] ?? null);
      case "and":
        return args.every(truthy);
      case "or":
        return args.some(truthy);
      case "not":
        return !truthy(args[0] ?? null);
      case "empty": {
        const value = args[0] ?? null;
        return value === null || (typeof value === "string" && value.trim() === "");
      }
      case "equal":
        return args[0] === args[1];
      case "unequal":
        return args[0] !== args[1];
      case "contains":
        return toText(args[0] ?? null).includes(toText(args[1] ?? null));
      case "substring":
        return toText(args[0] ?? null).slice(
          Math.trunc(toNumber(args[1] ?? 0)),
          args[2] === undefined ? undefined : Math.trunc(toNumber(args[2])),
        );
      case "replace":
        return toText(args[0] ?? null).replace(toText(args[1] ?? null), toText(args[2] ?? null));
      case "replaceall":
        return toText(args[0] ?? null)
          .split(toText(args[1] ?? null))
          .join(toText(args[2] ?? null));
      case "trim":
        return toText(args[0] ?? null).trim();
      case "repeat":
        return toText(args[0] ?? null).repeat(Math.max(0, Math.trunc(toNumber(args[1] ?? 0))));
      case "padstart":
        return toText(args[0] ?? null).padStart(
          Math.max(0, Math.trunc(toNumber(args[1] ?? 0))),
          toText(args[2] ?? " "),
        );
      case "padend":
        return toText(args[0] ?? null).padEnd(
          Math.max(0, Math.trunc(toNumber(args[1] ?? 0))),
          toText(args[2] ?? " "),
        );
      case "min":
        return Math.min(...args.map(toNumber));
      case "max":
        return Math.max(...args.map(toNumber));
      case "sum": {
        let total = 0;
        for (const value of args) total += toNumber(value);
        return total;
      }
      case "ceil":
        return Math.ceil(toNumber(args[0] ?? null));
      case "floor":
        return Math.floor(toNumber(args[0] ?? null));
      case "now":
        return new Date().toISOString();
      case "dateadd": {
        const date = parseDate(args[0] ?? null);
        if (date === null) return null;
        return addDateUnit(
          date,
          Math.trunc(toNumber(args[1] ?? 0)),
          toText(args[2] ?? "days").toLowerCase(),
        ).toISOString();
      }
      case "datebetween": {
        const left = parseDate(args[0] ?? null);
        const right = parseDate(args[1] ?? null);
        if (left === null || right === null) return null;
        return dateDifference(left, right, toText(args[2] ?? "days").toLowerCase());
      }
      default:
        throw new FormulaError(`Fonction inconnue « ${name} »`);
    }
  }
}

export function evaluateFormula(
  expression: string,
  context: FormulaContext,
  depth = 0,
): FormulaResult {
  try {
    const tokens = tokenize(expression);
    const value = new Parser(tokens, context, depth).parse();
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Formule invalide",
    };
  }
}

export function formatFormulaValue(value: FormulaValue): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(value);
  }
  return value === "" ? "—" : value;
}
