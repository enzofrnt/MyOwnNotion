import type { CanonicalBlockV3, JsonObject } from "./block.ts";
export function canonicalBlockProperties(block: CanonicalBlockV3): JsonObject {
  switch (block.type) {
    case "equation":
      return { expression: block.expression };
    case "heading":
      return { level: block.level };
    case "checkbox":
      return { checked: block.checked };
    case "code":
      return { language: block.language };
    case "callout":
      return { icon: block.icon, tone: block.tone };
    case "image":
      return {
        fileItemId: block.fileItemId,
        caption: block.caption,
        altText: block.altText,
        displayWidth: block.displayWidth,
      };
    case "fileEmbed":
      return { fileItemId: block.fileItemId, caption: block.caption };
    case "embed":
      return { provider: block.provider, sourceUrl: block.sourceUrl, caption: block.caption };
    case "databaseView":
      return { containerItemId: block.containerItemId, viewId: block.viewId };
    default:
      return {};
  }
}
