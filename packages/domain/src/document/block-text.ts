import { type CanonicalBlockV3, hasInlineContentV3 } from "./block.ts";
export function canonicalBlockText(block: CanonicalBlockV3): string | undefined {
  if (block.type === "unknown") return undefined;
  if (hasInlineContentV3(block)) return block.content.map(({ text }) => text).join("");
  if (block.type === "code") return block.text;
  return undefined;
}
