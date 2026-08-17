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
  type Block,
  childrenOf,
  hasInlineContent,
  type Inline,
  isUnknownBlock,
  type JsonObject,
  type JsonValue,
  MARK_ORDER,
  type Mark,
  type MarkType,
} from "./block.ts";

export const DOCUMENT_FORMAT = "myownnotion.document+json";

/** The version this client writes. Version 1 bodies are read, never written. */
export const DOCUMENT_FORMAT_VERSION = 2;

/** The body of a `formatVersion: 2` page document. */
export interface BlockDocument {
  readonly blocks: readonly Block[];
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
