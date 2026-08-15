/**
 * The block content model (T005, US1, FR-001, FR-005, FR-006).
 *
 * This is the model FR-005 requires to be documented and independent of the
 * editing library. It lives in the domain package, where React, Tiptap, and the
 * DOM cannot be imported, so the independence is a fact the module graph
 * enforces rather than a promise in a document.
 *
 * The design decision behind the whole module is that **the stored format is
 * ours and the editor renders it**, not the reverse. That is not merely
 * compliance: ProseMirror validates content against its schema and discards
 * what does not fit, and `Node.fromJSON` throws outright on an unknown node
 * type. If the stored document were the editor's own JSON, a block type a
 * future client added would be destroyed by the act of opening the page, and
 * there would be no layer left holding the original. Owning the format is what
 * makes the preservation requirement expressible at all.
 *
 * See `specs/003-core-workspace-experience/data-model.md` for the normative
 * description and `contracts/document-format.md` for the durable contract.
 */

import type { Uuid } from "../ids/uuid.ts";

/** Any value `JSON.parse` can produce. Used to carry unrecognised content. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

export type Mark =
  | { readonly type: "bold" }
  | { readonly type: "italic" }
  | { readonly type: "strikethrough" }
  | { readonly type: "code" }
  | { readonly type: "link"; readonly href: string };

export type MarkType = Mark["type"];

/**
 * The mark order used by normalisation.
 *
 * Marks carry no meaning in their ordering, so two documents differing only by
 * it are the same document. Fixing an order gives the round-trip property a
 * fixed point to compare against; without one, "the document is unchanged"
 * would depend on the order the editor happened to apply them in.
 */
export const MARK_ORDER: readonly MarkType[] = ["bold", "italic", "strikethrough", "code", "link"];

/** A run of text with a uniform set of marks. */
export interface Inline {
  readonly text: string;
  readonly marks?: readonly Mark[];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly id: Uuid;
  readonly content: readonly Inline[];
}

export interface HeadingBlock {
  readonly type: "heading";
  readonly id: Uuid;
  readonly level: 1 | 2 | 3;
  readonly content: readonly Inline[];
}

export interface BulletedListItemBlock {
  readonly type: "bulletedListItem";
  readonly id: Uuid;
  readonly content: readonly Inline[];
  readonly children?: readonly Block[];
}

export interface NumberedListItemBlock {
  readonly type: "numberedListItem";
  readonly id: Uuid;
  readonly content: readonly Inline[];
  readonly children?: readonly Block[];
}

export interface CheckboxBlock {
  readonly type: "checkbox";
  readonly id: Uuid;
  readonly checked: boolean;
  readonly content: readonly Inline[];
  readonly children?: readonly Block[];
}

export interface QuoteBlock {
  readonly type: "quote";
  readonly id: Uuid;
  readonly content: readonly Inline[];
  readonly children?: readonly Block[];
}

/**
 * A code block holds plain text, not inline content.
 *
 * Marks inside code are not meaningful, and allowing them would produce
 * documents whose Markdown export cannot represent them — the failure the
 * specification's last edge case is about.
 */
export interface CodeBlock {
  readonly type: "code";
  readonly id: Uuid;
  readonly text: string;
  readonly language: string | null;
}

export interface DividerBlock {
  readonly type: "divider";
  readonly id: Uuid;
}

/**
 * A block whose type this client version does not recognise (FR-006).
 *
 * It is data, not an error. `raw` holds the value exactly as it was parsed and
 * is what gets written back — never a reconstruction from what was displayed,
 * which is what makes the byte-for-byte guarantee (SC-009) honest rather than
 * approximate.
 *
 * The in-memory shape deliberately differs from the serialised one: this
 * carries `type: "unknown"` so TypeScript can discriminate the union, while
 * serialisation emits `raw` and nothing else. A stored block whose type is
 * literally the string `"unknown"` is not a collision — it is an unrecognised
 * type, which is exactly how it is treated, with `declaredType` preserving what
 * the document said.
 */
export interface UnknownBlock {
  readonly type: "unknown";
  readonly id: Uuid;
  /** The `type` the stored block declared, for the unrenderable placeholder. */
  readonly declaredType: string;
  /** The parsed value, untouched. Written back as-is. */
  readonly raw: JsonObject;
  /**
   * True when the stored block carried no usable id and one was minted for the
   * editing session. A synthetic id addresses the block in the editor and is
   * never written into `raw`, because adding a field to an owner's data in
   * order to display it is a change we have no reason to make.
   */
  readonly syntheticId: boolean;
}

export type KnownBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletedListItemBlock
  | NumberedListItemBlock
  | CheckboxBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock;

export type Block = KnownBlock | UnknownBlock;

export type KnownBlockType = KnownBlock["type"];

/** The registry. A `type` outside this set makes a block an unknown block. */
export const KNOWN_BLOCK_TYPES: readonly KnownBlockType[] = [
  "paragraph",
  "heading",
  "bulletedListItem",
  "numberedListItem",
  "checkbox",
  "quote",
  "code",
  "divider",
];

const KNOWN_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(KNOWN_BLOCK_TYPES);

export function isKnownBlockType(value: unknown): value is KnownBlockType {
  return typeof value === "string" && KNOWN_BLOCK_TYPE_SET.has(value);
}

export function isUnknownBlock(block: Block): block is UnknownBlock {
  return block.type === "unknown";
}

/** The types that may nest children. Lists nest directly; there is no container. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "bulletedListItem",
  "numberedListItem",
  "checkbox",
  "quote",
]);

export function mayHaveChildren(type: string): boolean {
  return CONTAINER_TYPES.has(type);
}

/** The types carrying inline content. `code` holds text and `divider` neither. */
const TEXT_BEARING_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "bulletedListItem",
  "numberedListItem",
  "checkbox",
  "quote",
]);

export function isTextBearing(type: string): boolean {
  return TEXT_BEARING_TYPES.has(type);
}

/** Narrowing helper for the blocks that carry `content`. */
export type TextBearingBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletedListItemBlock
  | NumberedListItemBlock
  | CheckboxBlock
  | QuoteBlock;

export function hasInlineContent(block: Block): block is TextBearingBlock {
  return isTextBearing(block.type);
}

/** The children of a block, or an empty list. Unknown blocks have none. */
export function childrenOf(block: Block): readonly Block[] {
  if (isUnknownBlock(block) || !mayHaveChildren(block.type)) {
    return [];
  }
  return (block as { children?: readonly Block[] }).children ?? [];
}
