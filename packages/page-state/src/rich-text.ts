import {
  COLOR_TOKENS,
  type ColorToken,
  type InlineV3,
  isUuid,
  type JsonObject,
  type JsonValue,
  type MarkV3,
  normaliseInlineV3,
  normaliseMarksV3,
  type Uuid,
} from "@myownnotion/domain";
import { Cursor, type Delta, type LoroDoc, type LoroText, type Side, type Value } from "loro-crdt";

const UNKNOWN_MARKS_ATTRIBUTE = "unknownMarks";

export class RichTextOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichTextOperationError";
  }
}

/** Configures the exact boundary behavior owned by the canonical v3 contract. */
export function configureRichText(doc: LoroDoc): void {
  doc.configTextStyle({
    bold: { expand: "both" },
    italic: { expand: "both" },
    underline: { expand: "both" },
    strike: { expand: "both" },
    textColor: { expand: "both" },
    backgroundColor: { expand: "both" },
    code: { expand: "before" },
    link: { expand: "before" },
    pageLink: { expand: "before" },
    [UNKNOWN_MARKS_ATTRIBUTE]: { expand: "none" },
  });
}

function attributesForMarks(
  marks: readonly MarkV3[] | undefined,
): Record<string, Value> | undefined {
  if (marks === undefined || marks.length === 0) return undefined;
  const attributes: Record<string, Value> = {};
  const unknown: JsonObject[] = [];
  for (const mark of normaliseMarksV3(marks) ?? []) {
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
      case "code":
        attributes[mark.type] = true;
        break;
      case "strikethrough":
        attributes["strike"] = true;
        break;
      case "link":
        attributes["link"] = { href: mark.href };
        break;
      case "pageLink":
        attributes["pageLink"] = { itemId: mark.targetItemId };
        break;
      case "textColor":
      case "backgroundColor":
        attributes[mark.type] = mark.color;
        break;
      case "unknown":
        unknown.push(mark.raw);
        break;
    }
  }
  if (unknown.length > 0) attributes[UNKNOWN_MARKS_ATTRIBUTE] = unknown;
  return Object.keys(attributes).length === 0 ? undefined : attributes;
}

export function initialiseRichText(text: LoroText, content: readonly InlineV3[]): void {
  const delta: Delta<string>[] = normaliseInlineV3(content).map((inline) => {
    const attributes = attributesForMarks(inline.marks);
    return attributes === undefined ? { insert: inline.text } : { insert: inline.text, attributes };
  });
  if (delta.length > 0) text.applyDelta(delta);
}

function jsonFromLoroValue(value: Value, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new RichTextOperationError(`${path} contains a non-finite number`);
  }
  if (value === undefined || value instanceof Uint8Array) {
    throw new RichTextOperationError(`${path} is not canonical JSON`);
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => jsonFromLoroValue(child, `${path}[${index}]`));
  }
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = jsonFromLoroValue(child, `${path}.${key}`);
  }
  return result;
}

function objectAttribute(
  attributes: Record<string, Value>,
  key: string,
  property: string,
): string | undefined {
  const value = attributes[key];
  if (value === undefined) return undefined;
  if (
    value === null ||
    Array.isArray(value) ||
    value instanceof Uint8Array ||
    typeof value !== "object"
  ) {
    throw new RichTextOperationError(`${key} must be an object attribute`);
  }
  const propertyValue = value[property];
  if (typeof propertyValue !== "string") {
    throw new RichTextOperationError(`${key}.${property} must be a string`);
  }
  return propertyValue;
}

function marksFromAttributes(attributes: Record<string, Value> | undefined): readonly MarkV3[] {
  if (attributes === undefined) return [];
  const marks: MarkV3[] = [];
  const booleanMark = (
    key: string,
    type: "bold" | "italic" | "underline" | "strikethrough" | "code",
  ): void => {
    const value = attributes[key];
    if (value === undefined) return;
    if (value !== true) throw new RichTextOperationError(`${key} must be true when active`);
    marks.push({ type });
  };
  booleanMark("bold", "bold");
  booleanMark("italic", "italic");
  booleanMark("underline", "underline");
  booleanMark("strike", "strikethrough");
  booleanMark("code", "code");

  const href = objectAttribute(attributes, "link", "href");
  if (href !== undefined) marks.push({ type: "link", href });
  const targetItemId = objectAttribute(attributes, "pageLink", "itemId");
  if (targetItemId !== undefined) {
    if (!isUuid(targetItemId)) {
      throw new RichTextOperationError("pageLink.itemId must be a UUID");
    }
    marks.push({ type: "pageLink", targetItemId: targetItemId as Uuid });
  }
  for (const type of ["textColor", "backgroundColor"] as const) {
    const color = attributes[type];
    if (color === undefined) continue;
    if (typeof color !== "string") {
      throw new RichTextOperationError(`${type} must be a string token`);
    }
    if (!COLOR_TOKENS.includes(color as ColorToken)) {
      throw new RichTextOperationError(`${type} must be a canonical color token`);
    }
    marks.push({ type, color: color as ColorToken });
  }

  const unknownMarks = attributes[UNKNOWN_MARKS_ATTRIBUTE];
  if (unknownMarks !== undefined) {
    if (!Array.isArray(unknownMarks)) {
      throw new RichTextOperationError("unknownMarks must be an array");
    }
    for (const [index, value] of unknownMarks.entries()) {
      const raw = jsonFromLoroValue(value, `unknownMarks[${index}]`);
      if (raw === null || Array.isArray(raw) || typeof raw !== "object") {
        throw new RichTextOperationError("an unknown mark must be an object");
      }
      const declaredType = raw["type"];
      if (typeof declaredType !== "string") {
        throw new RichTextOperationError("an unknown mark must declare a type");
      }
      marks.push({ type: "unknown", declaredType, raw });
    }
  }

  const knownAttributes = new Set([
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "link",
    "pageLink",
    "textColor",
    "backgroundColor",
    UNKNOWN_MARKS_ATTRIBUTE,
  ]);
  for (const [key, value] of Object.entries(attributes)) {
    if (knownAttributes.has(key)) continue;
    marks.push({
      type: "unknown",
      declaredType: "loroAttribute",
      raw: { type: "loroAttribute", key, value: jsonFromLoroValue(value, key) },
    });
  }
  return normaliseMarksV3(marks) ?? [];
}

export function projectRichText(text: LoroText): readonly InlineV3[] {
  const content: InlineV3[] = [];
  for (const operation of text.toDelta()) {
    if (operation.insert === undefined || operation.insert.length === 0) continue;
    const marks = marksFromAttributes(operation.attributes);
    content.push(
      marks.length === 0 ? { text: operation.insert } : { text: operation.insert, marks },
    );
  }
  return normaliseInlineV3(content);
}

function validateUnicodeText(value: string, allowCodeControls: boolean): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new RichTextOperationError("text must contain valid Unicode scalar values");
      }
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RichTextOperationError("text must contain valid Unicode scalar values");
    }
    if (unit <= 0x1f && (!allowCodeControls || (unit !== 0x09 && unit !== 0x0a))) {
      throw new RichTextOperationError("text contains a forbidden control character");
    }
  }
}

function isUtf16Boundary(value: string, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > value.length) return false;
  if (index === 0 || index === value.length) return true;
  const before = value.charCodeAt(index - 1);
  const after = value.charCodeAt(index);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function assertTextRange(text: LoroText, from: number, to: number): void {
  const value = text.toString();
  if (from > to || !isUtf16Boundary(value, from) || !isUtf16Boundary(value, to)) {
    throw new RichTextOperationError("text range must use valid UTF-16 boundaries");
  }
}

export function replaceRichText(
  text: LoroText,
  from: number,
  to: number,
  replacement: string,
  allowCodeControls: boolean,
): void {
  assertTextRange(text, from, to);
  validateUnicodeText(replacement, allowCodeControls);
  if (from === to && replacement.length === 0) return;
  text.splice(from, to - from, replacement);
}

function markAttribute(mark: Exclude<MarkV3, { type: "unknown" }>): [string, Value] {
  switch (mark.type) {
    case "strikethrough":
      return ["strike", true];
    case "link":
      return ["link", { href: mark.href }];
    case "pageLink":
      return ["pageLink", { itemId: mark.targetItemId }];
    case "textColor":
    case "backgroundColor":
      return [mark.type, mark.color];
    default:
      return [mark.type, true];
  }
}

function canonicalOpaque(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOpaque).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new RichTextOperationError(`opaque key ${key} is undefined`);
        return `${JSON.stringify(key)}:${canonicalOpaque(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function updateUnknownMark(
  text: LoroText,
  from: number,
  to: number,
  mark: MarkV3,
  enabled: boolean,
): void {
  if (mark.type !== "unknown") return;
  let offset = from;
  const targetKey = canonicalOpaque(mark.raw);
  for (const operation of text.sliceDelta(from, to)) {
    if (operation.insert === undefined) continue;
    const end = offset + operation.insert.length;
    const current = operation.attributes?.[UNKNOWN_MARKS_ATTRIBUTE];
    const values = Array.isArray(current)
      ? current.map((value, index) => jsonFromLoroValue(value, `unknownMarks[${index}]`))
      : [];
    const next = enabled
      ? values.some((value) => canonicalOpaque(value) === targetKey)
        ? values
        : [...values, mark.raw]
      : values.filter((value) => canonicalOpaque(value) !== targetKey);
    if (next.length === 0) text.unmark({ start: offset, end }, UNKNOWN_MARKS_ATTRIBUTE);
    else text.mark({ start: offset, end }, UNKNOWN_MARKS_ATTRIBUTE, next);
    offset = end;
  }
}

export function setRichTextMark(
  text: LoroText,
  from: number,
  to: number,
  mark: MarkV3,
  enabled: boolean,
): void {
  assertTextRange(text, from, to);
  if (from === to) throw new RichTextOperationError("a mark range must not be empty");
  if (mark.type === "unknown") {
    updateUnknownMark(text, from, to, mark, enabled);
    return;
  }
  const [key, value] = markAttribute(mark);
  if (enabled && key === "code") {
    for (const other of [
      "bold",
      "italic",
      "underline",
      "strike",
      "link",
      "pageLink",
      "textColor",
      "backgroundColor",
      UNKNOWN_MARKS_ATTRIBUTE,
    ]) {
      text.unmark({ start: from, end: to }, other);
    }
  } else if (enabled) {
    text.unmark({ start: from, end: to }, "code");
  }
  if (enabled) text.mark({ start: from, end: to }, key, value);
  else text.unmark({ start: from, end: to }, key);
}

export function createRelativeTextPosition(
  text: LoroText,
  index: number,
  side: Side = 0,
): Uint8Array {
  if (!isUtf16Boundary(text.toString(), index)) {
    throw new RichTextOperationError("cursor must use a valid UTF-16 boundary");
  }
  const cursor = text.getCursor(index, side);
  if (cursor === undefined) throw new RichTextOperationError("cursor is outside the text");
  return cursor.encode();
}

export function resolveRelativeTextPosition(
  doc: LoroDoc,
  encodedCursor: Uint8Array,
): { readonly offset: number; readonly side: Side } | undefined {
  const resolved = doc.getCursorPos(Cursor.decode(encodedCursor));
  return resolved === undefined ? undefined : { offset: resolved.offset, side: resolved.side };
}
