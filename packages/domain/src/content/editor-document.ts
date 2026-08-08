/** Canonical, editor-independent page document contract. */
import { isUuid, type Uuid } from "../ids/uuid.ts";
import { type DatabaseBlockAttributes, validateDatabaseBlockAttributes } from "./database.ts";
import type { DomainResult, PageDocument, SafeErrorCode } from "./types.ts";
import { err, ok, PAGE_DOCUMENT_FORMAT } from "./types.ts";

export const LEGACY_EDITOR_DOCUMENT_VERSION = 2;
export const WIKI_LINK_EDITOR_DOCUMENT_VERSION = 3;
export const TASK_EDITOR_DOCUMENT_VERSION = 4;
export const EDITOR_DOCUMENT_VERSION = 5;

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
  "databaseBlock",
] as const;

export const EDITOR_MARK_TYPES = ["bold", "italic", "strike", "code", "wikiLink"] as const;

export type EditorBlockType = (typeof EDITOR_BLOCK_TYPES)[number];
export type EditorMarkType = (typeof EDITOR_MARK_TYPES)[number];

export interface EditorStyleMark {
  readonly type: Exclude<EditorMarkType, "wikiLink">;
}

export interface WikiLinkMark {
  readonly type: "wikiLink";
  readonly attrs: {
    readonly targetItemId: Uuid;
    readonly occurrenceId: Uuid;
  };
}

export type EditorMark = EditorStyleMark | WikiLinkMark;

export interface WikiLinkOccurrence {
  readonly occurrenceId: Uuid;
  readonly targetItemId: Uuid;
  readonly label: string;
}

export const TASK_STATUSES = ["todo", "in_progress", "completed", "cancelled"] as const;
export const TASK_PRIORITIES = ["none", "low", "medium", "high"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskItemAttributes {
  readonly checked: boolean;
  readonly taskId: Uuid;
  readonly status: TaskStatus;
  readonly dueDate: string | null;
  readonly priority: TaskPriority;
}

export interface TaskOccurrence extends TaskItemAttributes {
  readonly title: string;
  readonly documentOrder: number;
  readonly depth: number;
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

function validateMarks(value: unknown, path: string, allowWikiLinks: boolean): DomainResult<null> {
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
    if (!isRecord(mark) || typeof mark.type !== "string") {
      return structureError(markPath, "invalid-mark");
    }
    if (!(EDITOR_MARK_TYPES as readonly string[]).includes(mark.type)) {
      return structureError(`${markPath}.type`, "unsupported-mark", "document.unsupported-content");
    }
    if (mark.type === "wikiLink") {
      if (!allowWikiLinks) {
        return structureError(
          `${markPath}.type`,
          "unsupported-mark",
          "document.unsupported-content",
        );
      }
      if (!hasOnlyKeys(mark, ["type", "attrs"]) || !isRecord(mark.attrs)) {
        return structureError(markPath, "invalid-wiki-link");
      }
      if (
        !hasOnlyKeys(mark.attrs, ["targetItemId", "occurrenceId"]) ||
        !isUuid(mark.attrs["targetItemId"]) ||
        !isUuid(mark.attrs["occurrenceId"])
      ) {
        return structureError(`${markPath}.attrs`, "invalid-wiki-link-identifiers");
      }
    } else if (!hasOnlyKeys(mark, ["type"])) {
      return structureError(markPath, "invalid-mark");
    }
    if (seen.has(mark.type)) {
      return structureError(markPath, "duplicate-mark");
    }
    seen.add(mark.type);
  }
  return ok(null);
}

function validateText(
  value: unknown,
  path: string,
  allowMarks: boolean,
  allowWikiLinks: boolean,
): DomainResult<null> {
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
  return allowMarks ? validateMarks(value.marks, `${path}.marks`, allowWikiLinks) : ok(null);
}

function validateTextContent(
  value: unknown,
  path: string,
  allowMarks: boolean,
  allowWikiLinks: boolean,
): DomainResult<null> {
  if (value === undefined) {
    return ok(null);
  }
  if (!Array.isArray(value)) {
    return structureError(path, "expected-array");
  }
  for (let index = 0; index < value.length; index += 1) {
    const result = validateText(value[index], `${path}[${index}]`, allowMarks, allowWikiLinks);
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

type TaskMetadataMode = "legacy" | "current" | "either";

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

export function isTaskCalendarDate(value: unknown): value is string {
  return typeof value === "string" && isRealCalendarDate(value);
}

function validateTaskItemAttrs(
  value: unknown,
  path: string,
  mode: TaskMetadataMode,
): DomainResult<null> {
  if (!isRecord(value)) {
    return structureError(path, "invalid-task-attributes");
  }
  const hasCurrentMetadata = ["taskId", "status", "dueDate", "priority"].some(
    (key) => key in value,
  );
  const validateCurrent = mode === "current" || (mode === "either" && hasCurrentMetadata);
  if (mode === "legacy" && hasCurrentMetadata) {
    return structureError(path, "task-metadata-not-supported");
  }
  if (!validateCurrent) {
    if (!hasOnlyKeys(value, ["checked"]) || typeof value.checked !== "boolean") {
      return structureError(`${path}.checked`, "expected-boolean");
    }
    return ok(null);
  }
  if (
    !hasOnlyKeys(value, ["checked", "taskId", "status", "dueDate", "priority"]) ||
    typeof value.checked !== "boolean" ||
    !isUuid(value["taskId"]) ||
    !(TASK_STATUSES as readonly unknown[]).includes(value["status"]) ||
    !(TASK_PRIORITIES as readonly unknown[]).includes(value["priority"]) ||
    !(value["dueDate"] === null || isTaskCalendarDate(value["dueDate"]))
  ) {
    return structureError(path, "invalid-task-metadata");
  }
  if (value.checked !== (value["status"] === "completed")) {
    return structureError(path, "task-status-checkbox-mismatch");
  }
  return ok(null);
}

function validateListItems(
  value: unknown,
  path: string,
  expectedType: "listItem" | "taskItem",
  options: {
    readonly allowWikiLinks: boolean;
    readonly taskMetadata: TaskMetadataMode;
    readonly allowDatabases: boolean;
  },
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
      const attrs = validateTaskItemAttrs(item.attrs, `${itemPath}.attrs`, options.taskMetadata);
      if (!attrs.ok) {
        return attrs;
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
      const result = validateBlock(
        item.content[childIndex],
        `${itemPath}.content[${childIndex}]`,
        options,
      );
      if (!result.ok) {
        return result;
      }
    }
  }
  return ok(null);
}

function validateBlock(
  value: unknown,
  path: string,
  options: {
    readonly allowWikiLinks: boolean;
    readonly taskMetadata: TaskMetadataMode;
    readonly allowDatabases: boolean;
  },
): DomainResult<null> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return structureError(path, "invalid-block");
  }
  switch (value.type) {
    case "paragraph": {
      if (!hasOnlyKeys(value, ["type", "content"])) {
        return structureError(path, "invalid-paragraph");
      }
      return validateTextContent(value.content, `${path}.content`, true, options.allowWikiLinks);
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
      return validateTextContent(value.content, `${path}.content`, true, options.allowWikiLinks);
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
        const result = validateBlock(value.content[index], `${path}.content[${index}]`, options);
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
      return validateTextContent(value.content, `${path}.content`, false, false);
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
      return validateListItems(value.content, `${path}.content`, "listItem", options);
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
      return validateListItems(value.content, `${path}.content`, "listItem", options);
    }
    case "taskList":
      if (!hasOnlyKeys(value, ["type", "content"])) {
        return structureError(path, "invalid-task-list");
      }
      return validateListItems(value.content, `${path}.content`, "taskItem", options);
    case "databaseBlock": {
      if (!options.allowDatabases) {
        return structureError(`${path}.type`, "unsupported-node", "document.unsupported-content");
      }
      if (!hasOnlyKeys(value, ["type", "attrs"])) {
        return structureError(path, "invalid-database-block");
      }
      const result = validateDatabaseBlockAttributes(value.attrs, `${path}.attrs`);
      return result.ok ? ok(null) : result;
    }
    default:
      return structureError(`${path}.type`, "unsupported-node", "document.unsupported-content");
  }
}

export function extractWikiLinkOccurrences(document: EditorDocument): WikiLinkOccurrence[] {
  const occurrences: WikiLinkOccurrence[] = [];
  const visit = (node: EditorNode): void => {
    if (node.type === "text") {
      for (const mark of node.marks ?? []) {
        if (mark.type === "wikiLink") {
          occurrences.push({
            occurrenceId: mark.attrs.occurrenceId,
            targetItemId: mark.attrs.targetItemId,
            label: node.text ?? "",
          });
        }
      }
    }
    for (const child of node.content ?? []) {
      visit(child);
    }
  };
  visit(document);
  return occurrences;
}

function textContent(node: EditorNode | undefined): string {
  if (node === undefined) {
    return "";
  }
  if (node.type === "text") {
    return node.text ?? "";
  }
  return (node.content ?? []).map((child) => textContent(child)).join("");
}

export function extractTaskOccurrences(document: EditorDocument): TaskOccurrence[] {
  const occurrences: TaskOccurrence[] = [];
  const visit = (node: EditorNode, taskDepth: number): void => {
    if (node.type === "taskItem") {
      const attrs = node.attrs;
      if (
        attrs !== undefined &&
        typeof attrs["checked"] === "boolean" &&
        isUuid(attrs["taskId"]) &&
        (TASK_STATUSES as readonly unknown[]).includes(attrs["status"]) &&
        (TASK_PRIORITIES as readonly unknown[]).includes(attrs["priority"]) &&
        (attrs["dueDate"] === null || isTaskCalendarDate(attrs["dueDate"]))
      ) {
        occurrences.push({
          checked: attrs["checked"],
          taskId: attrs["taskId"],
          status: attrs["status"] as TaskStatus,
          dueDate: attrs["dueDate"] as string | null,
          priority: attrs["priority"] as TaskPriority,
          title: textContent(node.content?.[0]),
          documentOrder: occurrences.length,
          depth: taskDepth,
        });
      }
    }
    const childDepth = node.type === "taskItem" ? taskDepth + 1 : taskDepth;
    for (const child of node.content ?? []) {
      visit(child, childDepth);
    }
  };
  visit(document, 0);
  return occurrences;
}

export function countEditorTaskItems(document: EditorDocument): number {
  let count = 0;
  const visit = (node: EditorNode): void => {
    if (node.type === "taskItem") {
      count += 1;
    }
    for (const child of node.content ?? []) {
      visit(child);
    }
  };
  visit(document);
  return count;
}

export function extractDatabaseBlocks(document: EditorDocument): DatabaseBlockAttributes[] {
  const databases: DatabaseBlockAttributes[] = [];
  const visit = (node: EditorNode): void => {
    if (node.type === "databaseBlock") {
      const result = validateDatabaseBlockAttributes(node.attrs);
      if (result.ok) databases.push(result.value);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document);
  return databases;
}

export function validateEditorDocument(
  value: unknown,
  options: {
    readonly allowWikiLinks?: boolean;
    readonly taskMetadata?: TaskMetadataMode;
    readonly allowDatabases?: boolean;
  } = {},
): DomainResult<EditorDocument> {
  const validationOptions = {
    allowWikiLinks: options.allowWikiLinks ?? true,
    taskMetadata: options.taskMetadata ?? ("either" as const),
    allowDatabases: options.allowDatabases ?? true,
  };
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "content"]) || value.type !== "doc") {
    return structureError("body", "invalid-document");
  }
  if (!Array.isArray(value.content) || value.content.length === 0) {
    return structureError("body.content", "document-requires-block");
  }
  for (let index = 0; index < value.content.length; index += 1) {
    const result = validateBlock(value.content[index], `body.content[${index}]`, validationOptions);
    if (!result.ok) {
      return result;
    }
  }
  const document = value as unknown as EditorDocument;
  const occurrenceIds = new Set<string>();
  for (const occurrence of extractWikiLinkOccurrences(document)) {
    if (occurrenceIds.has(occurrence.occurrenceId)) {
      return structureError("body", "duplicate-wiki-link-occurrence");
    }
    occurrenceIds.add(occurrence.occurrenceId);
  }
  const taskIds = new Set<string>();
  for (const occurrence of extractTaskOccurrences(document)) {
    if (taskIds.has(occurrence.taskId)) {
      return structureError("body", "duplicate-task-identity");
    }
    taskIds.add(occurrence.taskId);
  }
  const databaseIds = new Set<string>();
  for (const database of extractDatabaseBlocks(document)) {
    if (databaseIds.has(database.databaseId)) {
      return structureError("body", "duplicate-database-identity");
    }
    databaseIds.add(database.databaseId);
  }
  return ok(document);
}

export function validateWikiLinkTargets(
  document: EditorDocument,
  sourceItemId: Uuid,
  getItem: (id: Uuid) => {
    readonly kind: "page" | "folder" | "file";
    readonly lifecycle: "active" | "trashed" | "purged";
  } | null,
): DomainResult<WikiLinkOccurrence[]> {
  const occurrences = extractWikiLinkOccurrences(document);
  for (const occurrence of occurrences) {
    if (occurrence.targetItemId === sourceItemId) {
      return structureError("body", "wiki-link-self-reference");
    }
    const target = getItem(occurrence.targetItemId);
    if (target === null || target.lifecycle === "purged") {
      return err("relationship.endpoint-unavailable", "Wiki-link target is unavailable");
    }
    if (target.kind !== "page") {
      return err("item.wrong-kind", "Wiki links can target pages only");
    }
  }
  return ok(occurrences);
}

export function normalizePageDocumentForEditor(
  document: PageDocument,
): DomainResult<EditorDocument> {
  if (document.format !== PAGE_DOCUMENT_FORMAT) {
    return structureError("document.format", "unsupported-format", "document.unsupported-content");
  }
  if (document.formatVersion === EDITOR_DOCUMENT_VERSION) {
    return validateEditorDocument(document.body, {
      taskMetadata: "current",
      allowDatabases: true,
    });
  }
  if (document.formatVersion === TASK_EDITOR_DOCUMENT_VERSION) {
    return validateEditorDocument(document.body, {
      taskMetadata: "current",
      allowDatabases: false,
    });
  }
  if (document.formatVersion === WIKI_LINK_EDITOR_DOCUMENT_VERSION) {
    return validateEditorDocument(document.body, {
      allowWikiLinks: true,
      taskMetadata: "legacy",
      allowDatabases: false,
    });
  }
  if (document.formatVersion === LEGACY_EDITOR_DOCUMENT_VERSION) {
    return validateEditorDocument(document.body, {
      allowWikiLinks: false,
      taskMetadata: "legacy",
      allowDatabases: false,
    });
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
