import {
  type Block,
  type CanonicalBlockV3,
  childrenOf,
  type Inline,
  type InlineV3,
  isUnknownBlock,
  type JsonObject,
  type JsonValue,
  MARK_ORDER,
  type MarkV3,
} from "./block.ts";
import type { BlockDocument, BlockDocumentV3 } from "./document.ts";
import { type ValidationProblem, validateDocument } from "./validate.ts";

const V2_KNOWN_MARK_TYPES: ReadonlySet<string> = new Set(MARK_ORDER);

function migrateInlineV2ToV3(
  content: readonly Inline[],
  rawContent: JsonValue | undefined,
): readonly InlineV3[] {
  const rawRuns = Array.isArray(rawContent) ? rawContent : [];
  return content.map((inline, index) => {
    const marks: MarkV3[] =
      inline.marks?.map((mark) => {
        switch (mark.type) {
          case "link":
            return { type: "link", href: mark.href };
          case "pageLink":
            return { type: "pageLink", targetItemId: mark.targetItemId };
          default:
            return { type: mark.type };
        }
      }) ?? [];
    const rawRun = rawRuns[index];
    if (isJsonObject(rawRun) && Array.isArray(rawRun["marks"])) {
      for (const rawMark of rawRun["marks"]) {
        if (
          isJsonObject(rawMark) &&
          typeof rawMark["type"] === "string" &&
          !V2_KNOWN_MARK_TYPES.has(rawMark["type"])
        ) {
          marks.push({ type: "unknown", declaredType: rawMark["type"], raw: rawMark });
        }
      }
    }
    return marks.length === 0 ? { text: inline.text } : { text: inline.text, marks };
  });
}

function migrateChildrenV2ToV3(
  block: Block,
  raw: JsonValue | undefined,
): readonly CanonicalBlockV3[] | undefined {
  const children = childrenOf(block);
  if (children.length === 0) return undefined;
  const rawChildren = isJsonObject(raw) && Array.isArray(raw["children"]) ? raw["children"] : [];
  return children.map((child, index) => migrateBlockV2ToV3(child, rawChildren[index]));
}

function migrateBlockV2ToV3(block: Block, raw?: JsonValue): CanonicalBlockV3 {
  if (isUnknownBlock(block)) return block;
  const rawContent = isJsonObject(raw) ? raw["content"] : undefined;

  switch (block.type) {
    case "paragraph":
      return {
        type: block.type,
        id: block.id,
        content: migrateInlineV2ToV3(block.content, rawContent),
      };
    case "heading":
      return {
        type: block.type,
        id: block.id,
        level: block.level,
        content: migrateInlineV2ToV3(block.content, rawContent),
      };
    case "bulletedListItem":
    case "numberedListItem":
    case "quote": {
      const children = migrateChildrenV2ToV3(block, raw);
      const migrated = {
        type: block.type,
        id: block.id,
        content: migrateInlineV2ToV3(block.content, rawContent),
      };
      return children === undefined ? migrated : { ...migrated, children };
    }
    case "checkbox": {
      const children = migrateChildrenV2ToV3(block, raw);
      const migrated = {
        type: block.type,
        id: block.id,
        checked: block.checked,
        content: migrateInlineV2ToV3(block.content, rawContent),
      };
      return children === undefined ? migrated : { ...migrated, children };
    }
    case "code":
      return {
        type: block.type,
        id: block.id,
        text: block.text,
        language: block.language,
      };
    case "divider":
      return { type: block.type, id: block.id };
    case "fileEmbed":
      // Kept explicit because losing this reference would make the file usage
      // index claim a still-visible file is unused.
      return {
        type: "fileEmbed",
        id: block.id,
        fileItemId: block.fileItemId,
        caption: block.caption,
      };
  }
}

/** Pure, identity-preserving migration of an already validated v2 document. */
export function migrateDocumentV2ToV3(document: BlockDocument): BlockDocumentV3 {
  return { blocks: document.blocks.map((block) => migrateBlockV2ToV3(block)) };
}

const V2_KNOWN_KEYS: Readonly<Record<string, readonly string[]>> = {
  paragraph: ["type", "id", "content"],
  heading: ["type", "id", "level", "content"],
  bulletedListItem: ["type", "id", "content", "children"],
  numberedListItem: ["type", "id", "content", "children"],
  checkbox: ["type", "id", "checked", "content", "children"],
  quote: ["type", "id", "content", "children"],
  code: ["type", "id", "text", "language"],
  divider: ["type", "id"],
  fileEmbed: ["type", "id", "fileItemId", "caption"],
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function overlayV2ExtraProperties(
  migrated: CanonicalBlockV3,
  raw: JsonValue | undefined,
): CanonicalBlockV3 {
  if (!isJsonObject(raw) || migrated.type === "unknown") return migrated;
  const knownKeys = V2_KNOWN_KEYS[migrated.type] ?? [];
  const rawExtraProperties: JsonObject = {};
  for (const key of Object.keys(raw)) {
    if (!knownKeys.includes(key)) rawExtraProperties[key] = raw[key] ?? null;
  }

  let withChildren: CanonicalBlockV3 = migrated;
  const rawChildren = raw["children"];
  if ("children" in migrated && migrated.children !== undefined && Array.isArray(rawChildren)) {
    withChildren = {
      ...migrated,
      children: migrated.children.map((child, index) =>
        overlayV2ExtraProperties(child, rawChildren[index]),
      ),
    } as CanonicalBlockV3;
  }
  return Object.keys(rawExtraProperties).length === 0
    ? withChildren
    : ({ ...withChildren, rawExtraProperties } as CanonicalBlockV3);
}

export type V2BodyMigrationResult =
  | { readonly ok: true; readonly document: BlockDocumentV3 }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

/**
 * Validates with the historical v2 parser, then overlays unknown known-block
 * keys from the raw body so activation cannot silently reduce future fields.
 */
export function migrateDocumentV2BodyToV3(body: unknown): V2BodyMigrationResult {
  const result = validateDocument(body);
  if (!result.ok) return result;
  if (!isJsonObject(body) || !Array.isArray(body["blocks"])) {
    return { ok: true, document: migrateDocumentV2ToV3(result.document) };
  }
  const rawBlocks = body["blocks"];
  const migrated: BlockDocumentV3 = {
    blocks: result.document.blocks.map((block, index) =>
      migrateBlockV2ToV3(block, rawBlocks[index]),
    ),
  };
  return {
    ok: true,
    document: {
      blocks: migrated.blocks.map((block, index) =>
        overlayV2ExtraProperties(block, rawBlocks[index]),
      ),
    },
  };
}
