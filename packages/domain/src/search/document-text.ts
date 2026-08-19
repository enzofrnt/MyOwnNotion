import { type Block, childrenOf, hasInlineContent, isUnknownBlock } from "../document/block.ts";
import type { BlockDocument } from "../document/document.ts";

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu;
const INLINE_WHITESPACE = /\s+/gu;

function cleanVisibleText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(INLINE_WHITESPACE, " ").trim();
}

function textOf(block: Block): string {
  if (isUnknownBlock(block)) {
    return "";
  }
  if (hasInlineContent(block)) {
    return cleanVisibleText(block.content.map(({ text }) => text).join(""));
  }
  if (block.type === "code") {
    return cleanVisibleText(block.text);
  }
  if (block.type === "fileEmbed") {
    return block.caption === null ? "" : cleanVisibleText(block.caption);
  }
  return "";
}

/** Extracts only content a compatible client visibly renders. */
export function extractSearchableDocumentText(document: BlockDocument): string {
  const parts: string[] = [];
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      const text = textOf(block);
      if (text.length > 0) {
        parts.push(text);
      }
      visit(childrenOf(block));
    }
  };
  visit(document.blocks);
  return parts.join("\n");
}
