/**
 * Server-side semantic deltas for accepted operational updates (T143).
 *
 * Ambiguity detection compares what two concurrent updates did to the same
 * block. The operational log stores raw Loro bytes, so each update's delta is
 * reconstructed deterministically: replaying the log update by update and
 * diffing the canonical projections on either side yields exactly the
 * block-level intentions detection needs — deletions, type changes, property
 * changes — without trusting any client-side summary.
 */

import type { CanonicalBlockV3, JsonValue, Uuid } from "@myownnotion/domain";
import { normaliseInlineV3 } from "@myownnotion/domain";
import type {
  PageSemanticChange,
  SemanticUpdateRecord,
  TransformableBlockType,
} from "@myownnotion/page-state";

/** Deterministic JSON for value equality of property payloads. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

interface BlockSignature {
  readonly id: Uuid;
  readonly parentId: Uuid | null;
  readonly nextId: Uuid | null;
  readonly type: CanonicalBlockV3["type"];
  readonly propsJson: string;
  readonly text: string;
  readonly block: CanonicalBlockV3;
}

function flattenBlocks(blocks: readonly CanonicalBlockV3[], parent: Uuid | null): BlockSignature[] {
  const result: BlockSignature[] = [];
  for (const [index, block] of blocks.entries()) {
    const text =
      block.type === "code"
        ? block.text
        : "content" in block
          ? normaliseInlineV3(block.content)
              .map((inline) => inline.text)
              .join("")
          : "";
    result.push({
      id: block.id,
      parentId: parent,
      nextId: (blocks[index + 1]?.id as Uuid | undefined) ?? null,
      type: block.type,
      propsJson: stableJson(extractProps(block)),
      text,
      block,
    });
    const nested = (block as { readonly children?: readonly CanonicalBlockV3[] }).children;
    result.push(...flattenBlocks(nested ?? [], block.id));
  }
  return result;
}

function extractProps(block: CanonicalBlockV3): Record<string, unknown> {
  switch (block.type) {
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
    default:
      return {};
  }
}

function placementOf(signature: BlockSignature): {
  parentBlockId: Uuid | null;
  beforeBlockId: Uuid | null;
} {
  return { parentBlockId: signature.parentId, beforeBlockId: signature.nextId };
}

/**
 * Derives one update's semantic record from the projections on either side of
 * its import. Deletions carry the full subtree from the `before` projection so
 * a later resolution can restore it; type and property changes carry both
 * alternatives.
 */
export function semanticRecordFromProjectionDiff(input: {
  readonly updateId: Uuid;
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly beforeBlocks: readonly CanonicalBlockV3[];
  readonly afterBlocks: readonly CanonicalBlockV3[];
}): SemanticUpdateRecord {
  const before = new Map(flattenBlocks(input.beforeBlocks, null).map((s) => [s.id, s]));
  const after = new Map(flattenBlocks(input.afterBlocks, null).map((s) => [s.id, s]));
  const changes: PageSemanticChange[] = [];

  for (const [id, was] of before) {
    if (!after.has(id)) {
      changes.push({
        type: "block-deleted",
        blockId: id,
        affectedBlockIds: [id],
        blockBefore: was.block,
        placementBefore: placementOf(was),
      });
      continue;
    }
    const now = after.get(id) as BlockSignature;
    if (was.type !== now.type) {
      changes.push({
        type: "block-type-set",
        blockId: id,
        beforeType: was.type,
        afterType: now.type as TransformableBlockType,
        blockBefore: was.block,
        blockAfter: now.block,
      });
      continue;
    }
    if (was.text !== now.text) {
      // A bounded character delta: enough for ambiguity detection, which only
      // needs to know that this block's text was an edit intention.
      let prefix = 0;
      const limit = Math.min(was.text.length, now.text.length);
      while (prefix < limit && was.text[prefix] === now.text[prefix]) prefix += 1;
      let suffix = 0;
      while (
        suffix < was.text.length - prefix &&
        suffix < now.text.length - prefix &&
        was.text[was.text.length - 1 - suffix] === now.text[now.text.length - 1 - suffix]
      ) {
        suffix += 1;
      }
      changes.push({
        type: "text-replaced",
        blockId: id,
        from: prefix,
        to: was.text.length - suffix,
        insertedLength: now.text.length - prefix - suffix,
        removedText: was.text.slice(prefix, was.text.length - suffix),
        blockAfter: now.block,
      });
    }
    if (was.propsJson !== now.propsJson) {
      const beforeProps = JSON.parse(was.propsJson) as Record<string, JsonValue>;
      const afterProps = JSON.parse(now.propsJson) as Record<string, JsonValue>;
      for (const [key, next] of Object.entries(afterProps)) {
        const previous = beforeProps[key] ?? null;
        if (stableJson(previous) === stableJson(next)) continue;
        changes.push({
          type: "block-property-set",
          blockId: id,
          key,
          before: previous,
          after: next,
          blockAfter: now.block,
        });
      }
    }
  }

  return {
    updateId: input.updateId,
    baseVersionVector: input.baseVersionVector,
    resultVersionVector: input.resultVersionVector,
    semanticChanges: changes,
  };
}
