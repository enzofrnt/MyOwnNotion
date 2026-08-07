/** Canonical, editor-independent page document v2 contract. */
import type { DomainResult, PageDocument, SafeErrorCode } from "./types.ts";
import { err, ok, PAGE_DOCUMENT_FORMAT } from "./types.ts";

export const EDITOR_DOCUMENT_VERSION = 2;

export const EDITOR_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
] as const;

export const EDITOR_MARK_TYPES = ["bold", "italic", "strike", "code"] as const;

export type EditorBlockType = (typeof EDITOR_BLOCK_TYPES)[number];
export type EditorMarkType = (typeof EDITOR_MARK_TYPES)[number];

export interface EditorMark {
  readonly type: EditorMarkType;
}

export interface EditorNode {
  readonly [key: string]: unknown;
  readonly type: "doc" | "text" | EditorBlockType;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: ReadonlyArray<EditorNode>;
  readonly text?: string;
  readonly marks?: ReadonlyArray<EditorMark>;
}

export interface EditorDocument extends EditorNode {
  readonly type: "doc";
  readonly content: ReadonlyArray<EditorNode>;
}

export const EMPTY_EDITOR_DOCUMENT: EditorDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

interface UnknownRecord extends Record<string, unknown> {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly marks?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
  readonly checked?: unknown;
  readonly level?: unknown;
  readonly language?: unknown;
  readonly start?: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlyArray<string>): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function structureError(
  path: string,
  fieldCode: string,
  code: SafeErrorCode = "validation.invalid-payload",
): DomainResult<never> {
  return err(
    code,
    code === "document.unsupported-content"
      ? "Editor document contains unsupported content"
      : "Invalid editor document structure",
    {
      invalidFields: [{ field: path, code: fieldCode }],
    },
  );
}

function validateMarks(value: unknown, path: string): DomainResult<null> {
  if (value === undefined) {
    return ok(null);
  }
  if (!Array.isArray(value)) {
    return structureError(path, "expected-array");
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const mark = value[index];
    const markPath = `${path}[${index}]`;
    if (!isRecord(mark) || !hasOnlyKeys(mark, ["type"]) || typeof mark.type !== "string") {
      return structureError(markPath, "invalid-mark");
    }
    if (!(EDITOR_MARK_TYPES as readonly string[]).includes(mark.type)) {
      return structureError(`${markPath}.type`, "unsupported-mark", "document.unsupported-content");
    }
    if (seen.has(mark.type)) {
      return structureError(markPath, "duplicate-mark");
    }
    seen.add(mark.type);
  }
  return ok(null);
}

function validateText(value: unknown, path: string, allowMarks: boolean): DomainResult<null> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, allowMarks ? ["type", "text", "marks"] : ["type", "text"])
  ) {
    return structureError(path, "invalid-text");
  }
  if (value.type !== "text" || typeof value.text !== "string" || value.text.length === 0) {
    return structureError(path, "invalid-text");
  }
  if (!allowMarks && "marks" in value) {
    return structureError(`${path}.marks`, "marks-not-allowed");
  }
  return allowMarks ? validateMarks(value.marks, `${path}.marks`) : ok(null);
}

function validateTextContent(
  value: unknown,
  path: string,
  allowMarks: boolean,
): DomainResult<null> {
  if (value === undefined) {
    return ok(null);
  }
  if (!Array.isArray(value)) {
    return structureError(path, "expected-array");
  }
  for (let index = 0; index < value.length; index += 1) {
    const result = validateText(value[index], `${path}[${index}]`, allowMarks);
    if (!result.ok) {
      return result;
    }
  }
  return ok(null);
}

function validateAttrs(
  value: unknown,
  path: string,
  allowed: ReadonlyArray<string>,
): DomainResult<UnknownRecord | null> {
  if (value === undefined) {
    return ok(null);
  }
  if (!isRecord(value) || !hasOnlyKeys(value, allowed)) {
    return structureError(path, "invalid-attributes");
  }
  return ok(value);
}

function validateListItems(
  value: unknown,
  path: string,
  expectedType: "listItem" | "taskItem",
): DomainResult<null> {
  if (!Array.isArray(value) || value.length === 0) {
    return structureError(path, "list-requires-items");
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item) || item.type !== expectedType) {
      return structureError(`${itemPath}.type`, "wrong-list-item");
    }
    const allowedKeys =
      expectedType === "taskItem" ? ["type", "attrs", "content"] : ["type", "content"];
    if (!hasOnlyKeys(item, allowedKeys)) {
      return structureError(itemPath, "invalid-list-item");
    }
    if (expectedType === "taskItem") {
      const attrs = validateAttrs(item.attrs, `${itemPath}.attrs`, ["checked"]);
      if (!attrs.ok) {
        return attrs;
      }
      if (attrs.value === null || typeof attrs.value.checked !== "boolean") {
        return structureError(`${itemPath}.attrs.checked`, "expected-boolean");
      }
    }
    if (!Array.isArray(item.content) || item.content.length === 0) {
      return structureError(`${itemPath}.content`, "item-requires-content");
    }
    const first = item.content[0];
    if (!isRecord(first) || first.type !== "paragraph") {
      return structureError(`${itemPath}.content[0]`, "item-must-start-with-paragraph");
    }
    for (let childIndex = 0; childIndex < item.content.length; childIndex += 1) {
      const result = validateBlock(item.content[childIndex], `${itemPath}.content[${childIndex}]`);
      if (!result.ok) {
        return result;
      }
    }
  }
  return ok(null);
}

function validateBlock(value: unknown, path: string): DomainResult<null> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return structureError(path, "invalid-block");
  }
  switch (value.type) {
    case "paragraph": {
      if (!hasOnlyKeys(value, ["type", "content"])) {
        return structureError(path, "invalid-paragraph");
      }
      return validateTextContent(value.content, `${path}.content`, true);
    }
    case "heading": {
      if (!hasOnlyKeys(value, ["type", "attrs", "content"])) {
        return structureError(path, "invalid-heading");
      }
      const attrs = validateAttrs(value.attrs, `${path}.attrs`, ["level"]);
      if (!attrs.ok) {
        return attrs;
      }
      if (attrs.value === null || ![1, 2, 3].includes(attrs.value.level as number)) {
        return structureError(`${path}.attrs.level`, "invalid-heading-level");
      }
      return validateTextContent(value.content, `${path}.content`, true);
    }
    case "blockquote": {
      if (
        !hasOnlyKeys(value, ["type", "content"]) ||
        !Array.isArray(value.content) ||
        value.content.length === 0
      ) {
        return structureError(path, "invalid-blockquote");
      }
      for (let index = 0; index < value.content.length; index += 1) {
        const result = validateBlock(value.content[index], `${path}.content[${index}]`);
        if (!result.ok) {
          return result;
        }
      }
      return ok(null);
    }
    case "codeBlock": {
      if (!hasOnlyKeys(value, ["type", "attrs", "content"])) {
        return structureError(path, "invalid-code-block");
      }
      const attrs = validateAttrs(value.attrs, `${path}.attrs`, ["language"]);
      if (!attrs.ok) {
        return attrs;
      }
      if (
        attrs.value !== null &&
        attrs.value.language !== null &&
        typeof attrs.value.language !== "string"
      ) {
        return structureError(`${path}.attrs.language`, "invalid-language");
      }
      return validateTextContent(value.content, `${path}.content`, false);
    }
    case "horizontalRule":
      return hasOnlyKeys(value, ["type"])
        ? ok(null)
        : structureError(path, "invalid-horizontal-rule");
    case "bulletList": {
      if (!hasOnlyKeys(value, ["type", "attrs", "content"])) {
        return structureError(path, "invalid-list");
      }
      const attrs = validateAttrs(value.attrs, `${path}.attrs`, ["type"]);
      if (!attrs.ok) {
        return attrs;
      }
      return validateListItems(value.content, `${path}.content`, "listItem");
    }
    case "orderedList": {
      if (!hasOnlyKeys(value, ["type", "attrs", "content"])) {
        return structureError(path, "invalid-list");
      }
      const attrs = validateAttrs(value.attrs, `${path}.attrs`, ["start", "type"]);
      if (!attrs.ok) {
        return attrs;
      }
      if (
        attrs.value !== null &&
        "start" in attrs.value &&
        (!Number.isInteger(attrs.value.start) || (attrs.value.start as number) < 1)
      ) {
        return structureError(`${path}.attrs.start`, "invalid-list-start");
      }
      return validateListItems(value.content, `${path}.content`, "listItem");
    }
    case "taskList":
      if (!hasOnlyKeys(value, ["type", "content"])) {
        return structureError(path, "invalid-task-list");
      }
      return validateListItems(value.content, `${path}.content`, "taskItem");
    default:
      return structureError(`${path}.type`, "unsupported-node", "document.unsupported-content");
  }
}

export function validateEditorDocument(value: unknown): DomainResult<EditorDocument> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "content"]) || value.type !== "doc") {
    return structureError("body", "invalid-document");
  }
  if (!Array.isArray(value.content) || value.content.length === 0) {
    return structureError("body.content", "document-requires-block");
  }
  for (let index = 0; index < value.content.length; index += 1) {
    const result = validateBlock(value.content[index], `body.content[${index}]`);
    if (!result.ok) {
      return result;
    }
  }
  return ok(value as unknown as EditorDocument);
}

export function normalizePageDocumentForEditor(
  document: PageDocument,
): DomainResult<EditorDocument> {
  if (document.format !== PAGE_DOCUMENT_FORMAT) {
    return structureError("document.format", "unsupported-format", "document.unsupported-content");
  }
  if (document.formatVersion === EDITOR_DOCUMENT_VERSION) {
    return validateEditorDocument(document.body);
  }
  if (document.formatVersion === 1 && Object.keys(document.body).length === 0) {
    return ok(EMPTY_EDITOR_DOCUMENT);
  }
  return structureError(
    "document.formatVersion",
    "unsupported-version",
    "document.unsupported-content",
  );
}

export function toPageDocument(body: EditorDocument): PageDocument {
  return { format: PAGE_DOCUMENT_FORMAT, formatVersion: EDITOR_DOCUMENT_VERSION, body };
}
