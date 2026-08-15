/**
 * The documented export path (T011, FR-005).
 *
 * FR-005 requires the content model to have a defined export path, and
 * constitution principle I requires data to be exportable in documented,
 * durable formats. This is that function: pure, dependency-free, and total.
 *
 * **Export is lossy by design and never silently lossy.** Markdown has no
 * idiom for a block type it has never heard of, so an unknown block is emitted
 * as a labelled fenced JSON block. The export therefore contains everything the
 * document contained, even the parts Markdown cannot express — an owner who
 * exports their notes gets all of them, not the subset that happened to be
 * representable.
 *
 * Export is one-way. It is not an import format, and round-tripping through
 * Markdown is not a guarantee this module makes.
 */

import { type Block, childrenOf, type Inline, isUnknownBlock, type Mark } from "./block.ts";
import type { BlockDocument } from "./document.ts";

export function exportMarkdown(document: BlockDocument): string {
  const lines: string[] = [];
  for (const block of document.blocks) {
    renderBlock(block, 0, lines, { counter: 0 });
  }
  // A trailing newline, because a file that does not end in one is a file every
  // other tool complains about.
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

interface ListContext {
  counter: number;
}

function renderBlock(block: Block, depth: number, lines: string[], list: ListContext): void {
  const indent = "  ".repeat(depth);

  if (isUnknownBlock(block)) {
    // Labelled with the type so a reader can tell what they are looking at, and
    // emitted in full so nothing is lost to a format that cannot hold it.
    lines.push(`${indent}\`\`\`json unknown-block:${block.declaredType}`);
    lines.push(`${indent}${JSON.stringify(block.raw, null, 2)}`);
    lines.push(`${indent}\`\`\``);
    lines.push("");
    return;
  }

  switch (block.type) {
    case "paragraph":
      lines.push(indent + renderInline(block.content));
      lines.push("");
      break;

    case "heading":
      lines.push(`${indent}${"#".repeat(block.level)} ${renderInline(block.content)}`);
      lines.push("");
      break;

    case "bulletedListItem":
      lines.push(`${indent}- ${renderInline(block.content)}`);
      renderChildren(block, depth, lines);
      break;

    case "numberedListItem":
      // Numbering restarts per level: a nested list is its own sequence, which
      // is what a reader expects and what a Markdown renderer will produce.
      list.counter += 1;
      lines.push(`${indent}${list.counter}. ${renderInline(block.content)}`);
      renderChildren(block, depth, lines);
      break;

    case "checkbox":
      lines.push(`${indent}- [${block.checked ? "x" : " "}] ${renderInline(block.content)}`);
      renderChildren(block, depth, lines);
      break;

    case "quote":
      lines.push(`${indent}> ${renderInline(block.content)}`);
      renderChildren(block, depth, lines);
      lines.push("");
      break;

    case "code":
      lines.push(`${indent}\`\`\`${block.language ?? ""}`);
      for (const line of block.text.split("\n")) {
        lines.push(indent + line);
      }
      lines.push(`${indent}\`\`\``);
      lines.push("");
      break;

    case "divider":
      lines.push(`${indent}---`);
      lines.push("");
      break;
  }
}

function renderChildren(block: Block, depth: number, lines: string[]): void {
  const children = childrenOf(block);
  if (children.length === 0) {
    return;
  }
  const nested: ListContext = { counter: 0 };
  for (const child of children) {
    renderBlock(child, depth + 1, lines, nested);
  }
}

function renderInline(content: readonly Inline[]): string {
  return content.map(renderNode).join("");
}

function renderNode(node: Inline): string {
  let text = escapeText(node.text);
  const marks = node.marks ?? [];

  // Code first, because Markdown's code span is literal: applying emphasis
  // inside it would emit asterisks that render as asterisks.
  if (marks.some((mark) => mark.type === "code")) {
    return wrapLink(`\`${node.text}\``, marks);
  }
  if (marks.some((mark) => mark.type === "bold")) {
    text = `**${text}**`;
  }
  if (marks.some((mark) => mark.type === "italic")) {
    text = `*${text}*`;
  }
  if (marks.some((mark) => mark.type === "strikethrough")) {
    text = `~~${text}~~`;
  }
  return wrapLink(text, marks);
}

function wrapLink(text: string, marks: readonly Mark[]): string {
  const link = marks.find((mark): mark is Extract<Mark, { type: "link" }> => mark.type === "link");
  return link === undefined ? text : `[${text}](${link.href})`;
}

/** Escapes the characters that would otherwise become Markdown syntax. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}
