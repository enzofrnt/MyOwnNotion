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

import {
  type Block,
  type CanonicalBlockV3,
  childrenOf,
  childrenOfV3,
  type Inline,
  type InlineV3,
  type Mark,
  type MarkV3,
} from "./block.ts";
import type { BlockDocument, BlockDocumentV3 } from "./document.ts";

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
  renderCommonBlock(
    block,
    depth,
    lines,
    list,
    () => ("content" in block ? renderInline(block.content) : ""),
    () => renderChildren(block, depth, lines),
  );
}

function renderChildren(block: Block, depth: number, lines: string[]): void {
  renderNestedBlocks(childrenOf(block), depth, lines, renderBlock);
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

function wrapLink(text: string, marks: readonly (Mark | MarkV3)[]): string {
  const link = marks.find((mark): mark is Extract<Mark, { type: "link" }> => mark.type === "link");
  if (link !== undefined) {
    return `[${text}](${link.href})`;
  }
  const pageLink = marks.find(
    (mark): mark is Extract<Mark, { type: "pageLink" }> => mark.type === "pageLink",
  );
  return pageLink === undefined ? text : `[${text}](myownnotion://page/${pageLink.targetItemId})`;
}

/** Escapes the characters that would otherwise become Markdown syntax. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

/** Durable Markdown export of the complete v3 projection. */
export function exportMarkdownV3(document: BlockDocumentV3): string {
  const lines: string[] = [];
  for (const block of document.blocks) renderBlockV3(block, 0, lines, { counter: 0 });
  return `${lines
    .filter((line, index) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim()}\n`;
}

function renderBlockV3(
  block: CanonicalBlockV3,
  depth: number,
  lines: string[],
  list: ListContext,
): void {
  const indent = "  ".repeat(depth);
  if (
    renderCommonBlock(
      block,
      depth,
      lines,
      list,
      () => ("content" in block ? renderInlineV3(block.content) : ""),
      () => renderChildrenV3(block, depth, lines),
    )
  )
    return;
  switch (block.type) {
    case "toggle":
      lines.push(
        `${indent}<details>`,
        `${indent}<summary>${renderInlineV3(block.content)}</summary>`,
      );
      renderChildrenV3(block, depth, lines);
      lines.push(`${indent}</details>`, "");
      break;
    case "callout":
      lines.push(`${indent}> ${block.icon ?? ""} ${renderInlineV3(block.content)}`.trimEnd());
      renderChildrenV3(block, depth, lines);
      lines.push("");
      break;
    case "table":
      renderTableV3(block, depth, lines);
      break;
    case "image": {
      const alt = block.altText ?? block.caption ?? "image";
      lines.push(`${indent}![${escapeText(alt)}](myownnotion://file/${block.fileItemId})`);
      if (block.caption !== null) lines.push(`${indent}_${escapeText(block.caption)}_`);
      lines.push("");
      break;
    }
    case "fileEmbed":
      lines.push(
        `${indent}[${escapeText(block.caption ?? "Fichier")}](myownnotion://file/${block.fileItemId})`,
        "",
      );
      break;
    case "equation":
      lines.push(`${indent}$$`, block.expression, `${indent}$$`, "");
      break;
    case "tableOfContents":
      lines.push(`${indent}<!-- table-of-contents -->`, "");
      break;
    case "embed":
      lines.push(
        `${indent}[${escapeText(block.caption ?? block.provider)}](${block.sourceUrl})`,
        "",
      );
      break;
  }
}

function renderChildrenV3(block: CanonicalBlockV3, depth: number, lines: string[]): void {
  renderNestedBlocks(childrenOfV3(block), depth, lines, renderBlockV3);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderTableV3(
  block: Extract<CanonicalBlockV3, { type: "table" }>,
  depth: number,
  lines: string[],
): void {
  const indent = "  ".repeat(depth);
  const rows = block.rows.map((row) =>
    row.cells.map((cell) => escapeTableCell(renderInlineV3(cell.content))),
  );
  const first = rows[0] ?? block.columns.map(() => "");
  lines.push(`${indent}| ${first.join(" | ")} |`);
  lines.push(`${indent}| ${block.columns.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) lines.push(`${indent}| ${row.join(" | ")} |`);
  lines.push("");

  // Cell children have no standard Markdown table representation. They remain
  // explicit below the table, labelled by stable cell identity.
  for (const row of block.rows) {
    for (const cell of row.cells) {
      if ((cell.children?.length ?? 0) === 0) continue;
      lines.push(`${indent}<!-- table-cell:${cell.id} children -->`);
      const nested: ListContext = { counter: 0 };
      for (const child of cell.children ?? []) renderBlockV3(child, depth + 1, lines, nested);
    }
  }
}

function renderInlineV3(content: readonly InlineV3[]): string {
  return content.map(renderNodeV3).join("");
}

function renderNodeV3(node: InlineV3): string {
  const marks = node.marks ?? [];
  const equation = marks.find((mark) => mark.type === "equation");
  if (equation?.type === "equation") return `$${equation.expression}$`;
  if (marks.some((mark) => mark.type === "code")) return `\`${node.text}\``;

  let text = escapeText(node.text);
  if (marks.some((mark) => mark.type === "bold")) text = `**${text}**`;
  if (marks.some((mark) => mark.type === "italic")) text = `*${text}*`;
  if (marks.some((mark) => mark.type === "underline")) text = `<u>${text}</u>`;
  if (marks.some((mark) => mark.type === "strikethrough")) text = `~~${text}~~`;
  text = wrapColorV3(text, marks, "textColor", "data-text-color");
  text = wrapColorV3(text, marks, "backgroundColor", "data-background-color");
  text = wrapUnknownMarksV3(text, marks);
  return wrapLink(text, marks);
}

function wrapColorV3(
  text: string,
  marks: readonly MarkV3[],
  type: "textColor" | "backgroundColor",
  attribute: string,
): string {
  const mark = marks.find(
    (candidate): candidate is Extract<MarkV3, { type: typeof type }> => candidate.type === type,
  );
  return mark === undefined ? text : `<span ${attribute}="${mark.color}">${text}</span>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrapUnknownMarksV3(text: string, marks: readonly MarkV3[]): string {
  return marks
    .filter((mark): mark is Extract<MarkV3, { type: "unknown" }> => mark.type === "unknown")
    .reduce(
      (wrapped, mark) =>
        `<span data-myownnotion-mark="${escapeHtmlAttribute(JSON.stringify(mark.raw))}">${wrapped}</span>`,
      text,
    );
}

function renderCommonBlock(
  block: Block | CanonicalBlockV3,
  depth: number,
  lines: string[],
  list: ListContext,
  content: () => string,
  children: () => void,
): boolean {
  const indent = "  ".repeat(depth);

  if (block.type === "unknown") {
    // Labelled with the type so a reader can tell what they are looking at, and
    // emitted in full so nothing is lost to a format that cannot hold it.
    lines.push(`${indent}\`\`\`json unknown-block:${block.declaredType}`);
    lines.push(`${indent}${JSON.stringify(block.raw, null, 2)}`);
    lines.push(`${indent}\`\`\``);
    lines.push("");
    return true;
  }

  switch (block.type) {
    case "paragraph":
      lines.push(indent + content());
      lines.push("");
      break;

    case "heading":
      lines.push(`${indent}${"#".repeat(block.level)} ${content()}`);
      lines.push("");
      break;

    case "bulletedListItem":
      lines.push(`${indent}- ${content()}`);
      children();
      break;

    case "numberedListItem":
      // Numbering restarts per level: a nested list is its own sequence, which
      // is what a reader expects and what a Markdown renderer will produce.
      list.counter += 1;
      lines.push(`${indent}${list.counter}. ${content()}`);
      children();
      break;

    case "checkbox":
      lines.push(`${indent}- [${block.checked ? "x" : " "}] ${content()}`);
      children();
      break;

    case "quote":
      lines.push(`${indent}> ${content()}`);
      children();
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
    default:
      return false;
  }
  return true;
}
function renderNestedBlocks<T>(
  children: readonly T[],
  depth: number,
  lines: string[],
  render: (block: T, depth: number, lines: string[], list: ListContext) => void,
): void {
  const nested: ListContext = { counter: 0 };
  for (const child of children) render(child, depth + 1, lines, nested);
}
