/**
 * Rich-paste reduction to representable V1 structures (FR-021, T097).
 *
 * Paste is the one path where arbitrary outside content reaches the document.
 * The rule is conservative in exactly one direction: every character of text
 * survives, while any structure or style the canonical v3 model cannot
 * represent is reduced — never silently dropped with its text.
 */

import type { EditorPartialBlock } from "./blocknote-schema.ts";
import { isPageLinkHref } from "./page-link-href.ts";

const REPRESENTABLE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "divider",
  "toggleListItem",
  "callout",
  "table",
  "tableRow",
  "tableCell",
  "image",
  "fileEmbed",
  "embed",
  "unknown",
]);

const SAFE_EXTERNAL_LINK_PATTERN = /^(?:https?:|mailto:)/u;
const MAX_PASTE_BLOCKS = 500;
const MAX_PASTE_DEPTH = 20;

export interface SanitizedPaste {
  readonly blocks: EditorPartialBlock[];
  /** True when at least one unrepresentable structure was reduced. */
  readonly reduced: boolean;
}

interface InlineContentNode {
  readonly type: string;
  readonly text?: string;
  readonly styles?: Record<string, unknown>;
  readonly href?: string;
  readonly content?: readonly InlineContentNode[];
}

function isInlineArray(content: unknown): content is InlineContentNode[] {
  return (
    Array.isArray(content) &&
    content.every((item) => item !== null && typeof item === "object" && "type" in item)
  );
}

/** Keeps the text of a link whose href cannot be trusted, dropping only the mark. */
export function safeLinkHref(href: unknown): string | null {
  if (typeof href !== "string" || href.length > 2_048) return null;
  return SAFE_EXTERNAL_LINK_PATTERN.test(href) || isPageLinkHref(href) ? href : null;
}

function sanitizeInline(nodes: readonly unknown[]): { nodes: unknown[]; reduced: boolean } {
  let reduced = false;
  const result: unknown[] = [];
  for (const node of nodes) {
    if (node === null || typeof node !== "object") {
      reduced = true;
      continue;
    }
    const inline = node as InlineContentNode;
    if (inline.type === "text") {
      result.push({ type: "text", text: inline.text ?? "", styles: inline.styles ?? {} });
      continue;
    }
    if (inline.type === "link") {
      const href = safeLinkHref(inline.href);
      if (href === null) {
        reduced = true;
        result.push(...sanitizeInline(inline.content ?? []).nodes);
        continue;
      }
      result.push({ type: "link", href, content: sanitizeInline(inline.content ?? []).nodes });
      continue;
    }
    // An unknown inline kind still carries text-shaped content; keep it as text.
    reduced = true;
    const nested = sanitizeInline(
      isInlineArray(inline.content)
        ? inline.content
        : [{ type: "text", text: String(inline.text ?? "") }],
    );
    result.push(...nested.nodes);
  }
  return { nodes: result, reduced };
}

function sanitizedType(type: unknown): { type: string; reduced: boolean } {
  if (typeof type === "string" && REPRESENTABLE_TYPES.has(type)) return { type, reduced: false };
  return { type: "paragraph", reduced: true };
}

interface PastedBlock {
  readonly id?: string;
  readonly type?: unknown;
  readonly props?: Record<string, unknown>;
  readonly content?: unknown;
  readonly children?: readonly unknown[];
}

function sanitizeBlock(
  block: PastedBlock,
  depth: number,
): { block: EditorPartialBlock; reduced: boolean } {
  let reduced = false;
  const { type, reduced: typeReduced } = sanitizedType(block.type);
  reduced ||= typeReduced;

  const rawChildren: readonly unknown[] = Array.isArray(block.children) ? block.children : [];
  const children: EditorPartialBlock[] = [];
  if (depth < MAX_PASTE_DEPTH) {
    for (const child of rawChildren) {
      if (child === null || typeof child !== "object") {
        reduced = true;
        continue;
      }
      const sanitized = sanitizeBlock(child as PastedBlock, depth + 1);
      children.push(sanitized.block);
      reduced ||= sanitized.reduced;
    }
  } else {
    reduced ||= rawChildren.length > 0;
  }

  const props: Record<string, boolean | number | string> = {};
  if (block.props !== undefined) {
    for (const [key, value] of Object.entries(block.props)) {
      if (typeof value === "object") {
        reduced = true;
        continue;
      }
      props[key] = value as boolean | number | string;
    }
  }

  const content = isInlineArray(block.content)
    ? (() => {
        const sanitized = sanitizeInline(block.content);
        reduced ||= sanitized.reduced;
        return sanitized.nodes;
      })()
    : block.content;

  return {
    block: {
      ...(block.id === undefined ? {} : { id: block.id }),
      type,
      props,
      ...(content === undefined ? {} : { content }),
      ...(children.length === 0 ? {} : { children }),
    } as EditorPartialBlock,
    reduced,
  };
}

/**
 * Reduces pasted blocks to what the canonical model can save. Text is never
 * discarded: an unrepresentable block becomes a paragraph carrying its text,
 * and an unsafe link keeps its label while losing the mark.
 */
export function sanitizePastedBlocks(blocks: readonly unknown[]): SanitizedPaste {
  let reduced = false;
  const result: EditorPartialBlock[] = [];
  for (const entry of blocks.slice(0, MAX_PASTE_BLOCKS)) {
    if (blocks.length > MAX_PASTE_BLOCKS) reduced = true;
    if (entry === null || typeof entry !== "object") {
      reduced = true;
      continue;
    }
    const sanitized = sanitizeBlock(entry as PastedBlock, 0);
    result.push(sanitized.block);
    reduced ||= sanitized.reduced;
  }
  return { blocks: result, reduced };
}
