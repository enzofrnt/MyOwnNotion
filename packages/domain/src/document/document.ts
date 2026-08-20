/**
 * The document envelope, its invariants, and normalisation (T006, T007).
 *
 * A document is an ordered list of blocks. Order in the array *is* document
 * order: there is no separate position key, because this is a single-owner
 * document edited as a whole rather than a set of independently placed rows,
 * and inventing one here would duplicate a mechanism feature 001 already owns
 * at the item level.
 *
 * Normalisation exists for one reason, and it is worth stating because the
 * function looks like tidying: the round-trip property in FR-006/SC-009 needs a
 * fixed point to compare against. Without a defined canonical form, "the
 * document came back unchanged" would depend on how the editor happened to
 * split its text nodes, and the property would be untestable rather than false.
 */

import type { Uuid } from "../ids/uuid.ts";
import {
  BLOCK_FIELD_ORDER_V3,
  type Block,
  type CanonicalBlockV3,
  childrenOf,
  childrenOfV3,
  hasInlineContent,
  hasInlineContentV3,
  type Inline,
  type InlineV3,
  isUnknownBlock,
  isUnknownBlockV3,
  type JsonObject,
  type JsonValue,
  type KnownMarkTypeV3,
  MARK_ORDER,
  MARK_ORDER_V3,
  type Mark,
  type MarkType,
  type MarkV3,
  type TableCellV3,
} from "./block.ts";

export const DOCUMENT_FORMAT = "myownnotion.document+json";

/** The version this client writes. Version 1 bodies are read, never written. */
export const DOCUMENT_FORMAT_VERSION = 2;

/** The convergent editor's canonical projection version. */
export const DOCUMENT_FORMAT_VERSION_V3 = 3;

/** The body of a `formatVersion: 2` page document. */
export interface BlockDocument {
  readonly blocks: readonly Block[];
}

/** Editor-independent projection of the convergent page state. */
export interface BlockDocumentV3 {
  readonly blocks: readonly CanonicalBlockV3[];
}

export interface PageDocumentEnvelopeV3 {
  readonly format: typeof DOCUMENT_FORMAT;
  readonly formatVersion: typeof DOCUMENT_FORMAT_VERSION_V3;
  readonly body: BlockDocumentV3;
}

export function emptyDocument(): BlockDocument {
  return { blocks: [] };
}

/**
 * Stable targets mentioned by internal page-link marks.
 *
 * The visible document can mention the same item more than once, while the
 * relationship projection deliberately stores one edge per source/target
 * pair. Keeping this extraction in the editor-independent model gives the
 * browser, server validation, and revision restore one definition of that set
 * instead of separate approximations.
 */
export function pageLinkTargets(document: BlockDocument): Uuid[] {
  const targets = new Set<Uuid>();
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (hasInlineContent(block)) {
        for (const inline of block.content) {
          for (const mark of inline.marks ?? []) {
            if (mark.type === "pageLink") {
              targets.add(mark.targetItemId);
            }
          }
        }
      }
      visit(childrenOf(block));
    }
  };
  visit(document.blocks);
  return [...targets];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const MARK_RANK: ReadonlyMap<MarkType, number> = new Map(
  MARK_ORDER.map((type, index) => [type, index]),
);

function rankOf(type: MarkType): number {
  return MARK_RANK.get(type) ?? MARK_ORDER.length;
}

/** Sorts marks into the canonical order and drops exact duplicates. */
function normaliseMarks(marks: readonly Mark[] | undefined): readonly Mark[] | undefined {
  if (marks === undefined || marks.length === 0) {
    return undefined;
  }

  // `code` is exclusive: a run of inline code carries no other formatting.
  //
  // Two reasons, and the second is the one that forced it. Typographically,
  // bold inside a code span has no meaning — the export already dropped it,
  // returning the code span and ignoring every other mark. And every editor
  // schema worth using says the same: ProseMirror's `code` mark excludes all
  // others, so a model that allowed the combination produced documents the
  // editor refused to open. Deciding it here keeps the two in agreement
  // instead of leaving the conversion to paper over a disagreement.
  const codeMark = marks.find((mark) => mark.type === "code");
  if (codeMark !== undefined) {
    return [codeMark];
  }

  const seen = new Set<string>();
  const unique: Mark[] = [];
  for (const mark of marks) {
    // One mark of each type, links included — and links especially. An earlier
    // version keyed links by href, on the reasoning that two links to different
    // places are two different marks. They are, but a single run of text cannot
    // be both: it points somewhere, or somewhere else. The editor schema agrees
    // and rejects the pair outright, so the model has to decide, and the first
    // one wins because document order is the only ordering there is.
    if (seen.has(mark.type)) {
      continue;
    }
    seen.add(mark.type);
    unique.push(mark);
  }

  unique.sort((left, right) => {
    const byType = rankOf(left.type) - rankOf(right.type);
    if (byType !== 0) {
      return byType;
    }
    const leftValue =
      left.type === "link" ? left.href : left.type === "pageLink" ? left.targetItemId : "";
    const rightValue =
      right.type === "link" ? right.href : right.type === "pageLink" ? right.targetItemId : "";
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
  return unique;
}

function marksKey(marks: readonly Mark[] | undefined): string {
  if (marks === undefined) {
    return "";
  }
  return marks
    .map((mark) =>
      mark.type === "link"
        ? `link:${mark.href}`
        : mark.type === "pageLink"
          ? `pageLink:${mark.targetItemId}`
          : mark.type,
    )
    .join("|");
}

/**
 * Canonical form for a run of inline content: empty text dropped, marks
 * ordered, and adjacent runs with identical marks merged.
 *
 * The merge is what stops `["a"]["b"]` and `["ab"]` from being different
 * documents. Editors split text nodes for their own reasons — a cursor
 * position, a mark applied and removed — and none of those reasons are content.
 */
export function normaliseInline(content: readonly Inline[]): readonly Inline[] {
  const result: Inline[] = [];
  for (const node of content) {
    if (node.text === "") {
      continue;
    }
    const marks = normaliseMarks(node.marks);
    const previous = result[result.length - 1];
    if (previous !== undefined && marksKey(previous.marks) === marksKey(marks)) {
      result[result.length - 1] =
        previous.marks === undefined
          ? { text: previous.text + node.text }
          : { text: previous.text + node.text, marks: previous.marks };
      continue;
    }
    result.push(marks === undefined ? { text: node.text } : { text: node.text, marks });
  }
  return result;
}

/** Normalises one block and, recursively, its children. */
export function normaliseBlock(block: Block): Block {
  if (isUnknownBlock(block)) {
    // Never touched. Normalising an unknown block would mean interpreting it,
    // which is the one thing that must not happen to it.
    return block;
  }

  const children = childrenOf(block);
  const normalisedChildren = children.length === 0 ? undefined : children.map(normaliseBlock);

  if (!hasInlineContent(block)) {
    return block;
  }

  const content = normaliseInline(block.content);
  return normalisedChildren === undefined
    ? ({ ...block, content } as Block)
    : ({ ...block, content, children: normalisedChildren } as Block);
}

/**
 * The canonical form of a document. Idempotent by construction, which the
 * property test asserts rather than assumes.
 */
export function normaliseDocument(document: BlockDocument): BlockDocument {
  return { blocks: document.blocks.map(normaliseBlock) };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** Every block id in the document, in document order, including nested ones. */
export function collectBlockIds(document: BlockDocument): string[] {
  const ids: string[] = [];
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      ids.push(block.id);
      visit(childrenOf(block));
    }
  };
  visit(document.blocks);
  return ids;
}

/** The ids appearing more than once, if any. Empty means the invariant holds. */
export function duplicateBlockIds(document: BlockDocument): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of collectBlockIds(document)) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates];
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * The stored body for a document.
 *
 * An unknown block serialises to its `raw` value and nothing else — not to the
 * in-memory shape that carries `declaredType` and the synthetic-id flag. That
 * asymmetry is the whole preservation mechanism: what goes out is the object
 * that came in, never a reconstruction of it.
 */
export function serialiseDocument(document: BlockDocument): JsonObject {
  return { blocks: document.blocks.map(serialiseBlock) };
}

function serialiseBlock(block: Block): JsonValue {
  if (isUnknownBlock(block)) {
    return block.raw;
  }

  const children = childrenOf(block);
  const serialised: JsonObject = { ...(block as unknown as JsonObject) };
  if (children.length === 0) {
    delete serialised["children"];
  } else {
    serialised["children"] = children.map(serialiseBlock);
  }
  return serialised;
}

// ---------------------------------------------------------------------------
// Version 3 normalisation and serialisation
// ---------------------------------------------------------------------------

const MARK_RANK_V3: ReadonlyMap<KnownMarkTypeV3, number> = new Map(
  MARK_ORDER_V3.map((type, index) => [type, index]),
);

function opaqueJsonKey(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(opaqueJsonKey).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new TypeError(`opaque JSON key ${key} is undefined`);
        return `${JSON.stringify(key)}:${opaqueJsonKey(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalOpaqueValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalOpaqueValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) throw new TypeError(`opaque JSON key ${key} is undefined`);
      sorted[key] = canonicalOpaqueValue(child);
    }
    return sorted;
  }
  return value;
}

function isUnknownMarkV3(mark: MarkV3): mark is Extract<MarkV3, { type: "unknown" }> {
  return mark.type === "unknown";
}

function markKeyV3(mark: MarkV3): string {
  switch (mark.type) {
    case "link":
      return `link:${mark.href}`;
    case "pageLink":
      return `pageLink:${mark.targetItemId}`;
    case "textColor":
    case "backgroundColor":
      return `${mark.type}:${mark.color}`;
    case "unknown":
      return `unknown:${opaqueJsonKey(mark.raw)}`;
    default:
      return mark.type;
  }
}

/** Canonical mark ordering for editor commands and operational projections. */
export function normaliseMarksV3(
  marks: readonly MarkV3[] | undefined,
): readonly MarkV3[] | undefined {
  if (marks === undefined || marks.length === 0) {
    return undefined;
  }

  const knownByType = new Map<KnownMarkTypeV3, MarkV3>();
  const unknown: MarkV3[] = [];
  for (const mark of marks) {
    if (isUnknownMarkV3(mark)) {
      unknown.push(mark);
    } else if (!knownByType.has(mark.type)) {
      knownByType.set(mark.type, mark);
    }
  }

  // Operational commands may transiently produce an incompatible set. The
  // persisted parser refuses it; command normalisation keeps code exclusive.
  if (knownByType.has("code")) {
    for (const type of [...knownByType.keys()]) {
      if (type !== "code") knownByType.delete(type);
    }
  }

  const known = [...knownByType.values()].sort((left, right) => {
    if (isUnknownMarkV3(left) || isUnknownMarkV3(right)) return 0;
    return (
      (MARK_RANK_V3.get(left.type) ?? MARK_ORDER_V3.length) -
      (MARK_RANK_V3.get(right.type) ?? MARK_ORDER_V3.length)
    );
  });
  unknown.sort((left, right) => {
    const leftKey = markKeyV3(left);
    const rightKey = markKeyV3(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return [...known, ...unknown];
}

function marksKeyV3(marks: readonly MarkV3[] | undefined): string {
  return JSON.stringify(marks?.map(markKeyV3) ?? []);
}

export function normaliseInlineV3(content: readonly InlineV3[]): readonly InlineV3[] {
  const result: InlineV3[] = [];
  for (const node of content) {
    if (node.text.length === 0) continue;
    const marks = normaliseMarksV3(node.marks);
    const previous = result.at(-1);
    if (previous !== undefined && marksKeyV3(previous.marks) === marksKeyV3(marks)) {
      result[result.length - 1] =
        previous.marks === undefined
          ? { text: previous.text + node.text }
          : { text: previous.text + node.text, marks: previous.marks };
      continue;
    }
    result.push(marks === undefined ? { text: node.text } : { text: node.text, marks });
  }
  return result;
}

function normaliseChildrenV3(
  children: readonly CanonicalBlockV3[] | undefined,
): readonly CanonicalBlockV3[] | undefined {
  if (children === undefined || children.length === 0) return undefined;
  return children.map(normaliseBlockV3);
}

function normaliseCellV3(cell: TableCellV3): TableCellV3 {
  const children = normaliseChildrenV3(cell.children);
  return children === undefined
    ? { id: cell.id, content: normaliseInlineV3(cell.content) }
    : { id: cell.id, content: normaliseInlineV3(cell.content), children };
}

export function normaliseBlockV3(block: CanonicalBlockV3): CanonicalBlockV3 {
  if (isUnknownBlockV3(block)) return block;

  switch (block.type) {
    case "paragraph":
    case "heading":
      return { ...block, content: normaliseInlineV3(block.content) };
    case "bulletedListItem":
    case "numberedListItem":
    case "checkbox":
    case "quote":
    case "toggle":
    case "callout": {
      const children = normaliseChildrenV3(block.children);
      const normalised = { ...block, content: normaliseInlineV3(block.content) };
      if (children === undefined) {
        const { children: _children, ...withoutChildren } = normalised;
        return withoutChildren as CanonicalBlockV3;
      }
      return { ...normalised, children } as CanonicalBlockV3;
    }
    case "table":
      return {
        ...block,
        rows: block.rows.map((row) => ({
          id: row.id,
          cells: row.cells.map(normaliseCellV3),
        })),
      };
    case "code":
    case "divider":
    case "image":
    case "fileEmbed":
    case "embed":
      return block;
  }
}

export function normaliseDocumentV3(document: BlockDocumentV3): BlockDocumentV3 {
  return { blocks: document.blocks.map(normaliseBlockV3) };
}

function serialiseMarkV3(mark: MarkV3, canonicalOpaque: boolean): JsonObject {
  if (mark.type === "unknown") {
    return canonicalOpaque ? (canonicalOpaqueValue(mark.raw) as JsonObject) : mark.raw;
  }
  switch (mark.type) {
    case "link":
      return { type: mark.type, href: mark.href };
    case "pageLink":
      return { type: mark.type, targetItemId: mark.targetItemId };
    case "textColor":
    case "backgroundColor":
      return { type: mark.type, color: mark.color };
    default:
      return { type: mark.type };
  }
}

function serialiseInlineV3(node: InlineV3, canonicalOpaque: boolean): JsonObject {
  const result: JsonObject = { text: node.text };
  if (node.marks !== undefined && node.marks.length > 0) {
    result["marks"] = node.marks.map((mark) => serialiseMarkV3(mark, canonicalOpaque));
  }
  return result;
}

function appendExtraPropertiesV3(
  known: JsonObject,
  extra: JsonObject | undefined,
  canonicalOpaque: boolean,
  reservedKeys: readonly string[],
): JsonObject {
  if (extra === undefined) return known;
  const reserved = new Set(reservedKeys);
  for (const key of Object.keys(extra).sort()) {
    if (reserved.has(key)) {
      throw new Error(`v3 opaque property collides with known field: ${key}`);
    }
    const value = extra[key];
    if (value === undefined) throw new TypeError(`opaque JSON key ${key} is undefined`);
    known[key] = canonicalOpaque ? canonicalOpaqueValue(value) : value;
  }
  return known;
}

function serialiseChildrenV3(
  into: JsonObject,
  children: readonly CanonicalBlockV3[] | undefined,
  canonicalOpaque: boolean,
): JsonObject {
  if (children !== undefined && children.length > 0) {
    into["children"] = children.map((child) => serialiseBlockV3(child, canonicalOpaque));
  }
  return into;
}

function serialiseCellV3(cell: TableCellV3, canonicalOpaque: boolean): JsonObject {
  return serialiseChildrenV3(
    {
      id: cell.id,
      content: cell.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
    },
    cell.children,
    canonicalOpaque,
  );
}

function serialiseBlockV3(block: CanonicalBlockV3, canonicalOpaque: boolean): JsonValue {
  if (isUnknownBlockV3(block)) {
    return canonicalOpaque ? canonicalOpaqueValue(block.raw) : block.raw;
  }

  let known: JsonObject;
  switch (block.type) {
    case "paragraph":
      known = {
        type: block.type,
        id: block.id,
        content: block.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
      };
      break;
    case "heading":
      known = {
        type: block.type,
        id: block.id,
        level: block.level,
        content: block.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
      };
      break;
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
    case "toggle":
      known = serialiseChildrenV3(
        {
          type: block.type,
          id: block.id,
          content: block.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
        },
        block.children,
        canonicalOpaque,
      );
      break;
    case "checkbox":
      known = serialiseChildrenV3(
        {
          type: block.type,
          id: block.id,
          checked: block.checked,
          content: block.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
        },
        block.children,
        canonicalOpaque,
      );
      break;
    case "code":
      known = { type: block.type, id: block.id, text: block.text, language: block.language };
      break;
    case "divider":
      known = { type: block.type, id: block.id };
      break;
    case "callout":
      known = serialiseChildrenV3(
        {
          type: block.type,
          id: block.id,
          content: block.content.map((node) => serialiseInlineV3(node, canonicalOpaque)),
          icon: block.icon,
          tone: block.tone,
        },
        block.children,
        canonicalOpaque,
      );
      break;
    case "table":
      known = {
        type: block.type,
        id: block.id,
        columns: block.columns.map((column) => ({ id: column.id, width: column.width })),
        rows: block.rows.map((row) => ({
          id: row.id,
          cells: row.cells.map((cell) => serialiseCellV3(cell, canonicalOpaque)),
        })),
      };
      break;
    case "image":
      known = {
        type: block.type,
        id: block.id,
        fileItemId: block.fileItemId,
        caption: block.caption,
        altText: block.altText,
        displayWidth: block.displayWidth,
      };
      break;
    case "fileEmbed":
      known = {
        type: block.type,
        id: block.id,
        fileItemId: block.fileItemId,
        caption: block.caption,
      };
      break;
    case "embed":
      known = {
        type: block.type,
        id: block.id,
        provider: block.provider,
        sourceUrl: block.sourceUrl,
        caption: block.caption,
      };
      break;
  }
  return appendExtraPropertiesV3(
    known,
    block.rawExtraProperties,
    canonicalOpaque,
    BLOCK_FIELD_ORDER_V3[block.type],
  );
}

/** Wire representation; unknown blocks and marks retain their original objects. */
export function serialiseDocumentV3(document: BlockDocumentV3): JsonObject {
  return { blocks: document.blocks.map((block) => serialiseBlockV3(block, false)) };
}

/** Digest representation; opaque JSON keys are recursively sorted. */
export function serialiseCanonicalDocumentV3(document: BlockDocumentV3): JsonObject {
  return { blocks: document.blocks.map((block) => serialiseBlockV3(block, true)) };
}

export function pageLinkTargetsV3(document: BlockDocumentV3): Uuid[] {
  const targets = new Set<Uuid>();
  const collectInline = (content: readonly InlineV3[]): void => {
    for (const inline of content) {
      for (const mark of inline.marks ?? []) {
        if (mark.type === "pageLink") targets.add(mark.targetItemId);
      }
    }
  };
  const visit = (blocks: readonly CanonicalBlockV3[]): void => {
    for (const block of blocks) {
      if (hasInlineContentV3(block)) collectInline(block.content);
      if (!isUnknownBlockV3(block) && block.type === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            collectInline(cell.content);
            visit(cell.children ?? []);
          }
        }
      }
      visit(childrenOfV3(block));
    }
  };
  visit(document.blocks);
  return [...targets];
}

/** All structural identities, including table columns, rows and cells. */
export function collectDocumentIdsV3(document: BlockDocumentV3): string[] {
  const ids: string[] = [];
  const visit = (blocks: readonly CanonicalBlockV3[]): void => {
    for (const block of blocks) {
      ids.push(block.id);
      if (!isUnknownBlockV3(block) && block.type === "table") {
        for (const column of block.columns) ids.push(column.id);
        for (const row of block.rows) {
          ids.push(row.id);
          for (const cell of row.cells) {
            ids.push(cell.id);
            visit(cell.children ?? []);
          }
        }
      }
      visit(childrenOfV3(block));
    }
  };
  visit(document.blocks);
  return ids;
}
