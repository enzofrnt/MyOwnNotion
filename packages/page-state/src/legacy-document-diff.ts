/**
 * Verified semantic recovery of a historical whole-document page edit.
 *
 * The generated commands are not trusted because a diff looked plausible:
 * every command is applied through the operational document engine and the
 * final canonical JSON and digest must exactly match the retained local draft.
 */

import {
  type BlockDocumentV3,
  type CanonicalBlockV3,
  canonicalDocumentJsonV3,
  childrenOfV3,
  documentDigestV3,
  hasInlineContentV3,
  type InlineV3,
  type JsonObject,
  type JsonValue,
  type MarkV3,
  mayHaveChildrenV3,
  normaliseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import { isTransformableBlockType } from "./block-tree.ts";
import { OperationalPageDocument, type PageCommand } from "./document.ts";
import {
  type LegacySemanticCommand,
  legacySemanticCommandsFromTransaction,
} from "./legacy-offline-branch.ts";

interface IndexedBlock {
  readonly block: CanonicalBlockV3;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
}

export class LegacyDocumentDiffError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LegacyDocumentDiffError";
    this.code = code;
  }
}

export interface LegacyDocumentDiffResult {
  readonly commands: readonly LegacySemanticCommand[];
  readonly document: BlockDocumentV3;
  readonly digest: string;
}

function indexDocument(document: BlockDocumentV3): Map<Uuid, IndexedBlock> {
  const result = new Map<Uuid, IndexedBlock>();
  const visit = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null) => {
    for (const [index, block] of blocks.entries()) {
      if (result.has(block.id)) {
        throw new LegacyDocumentDiffError(
          "legacy-recovery.duplicate-block",
          `legacy recovery found duplicate block ${block.id}`,
        );
      }
      result.set(block.id, {
        block,
        parentBlockId,
        beforeBlockId: blocks[index + 1]?.id ?? null,
      });
      visit(childrenOfV3(block), block.id);
    }
  };
  visit(document.blocks, null);
  return result;
}

function visitDocument(
  document: BlockDocumentV3,
  visitor: (block: CanonicalBlockV3, parentBlockId: Uuid | null) => void,
): void {
  const visit = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null) => {
    for (const block of blocks) {
      visitor(block, parentBlockId);
      visit(childrenOfV3(block), block.id);
    }
  };
  visit(document.blocks, null);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shallowBlock(block: CanonicalBlockV3): CanonicalBlockV3 {
  if (block.type === "unknown" || !("children" in block)) return structuredClone(block);
  return { ...structuredClone(block), children: [] } as CanonicalBlockV3;
}

function propertiesOf(block: CanonicalBlockV3): JsonObject {
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

function rawProperties(block: CanonicalBlockV3): JsonObject | undefined {
  return block.type === "unknown" ? block.raw : block.rawExtraProperties;
}

function plainText(block: CanonicalBlockV3): string | null {
  if (hasInlineContentV3(block)) return block.content.map(({ text }) => text).join("");
  if (block.type === "code") return block.text;
  return null;
}

function containsUnknownMarks(content: readonly InlineV3[]): boolean {
  return content.some(({ marks }) => marks?.some(({ type }) => type === "unknown") === true);
}

function markRuns(content: readonly InlineV3[]): Array<{
  readonly from: number;
  readonly to: number;
  readonly mark: MarkV3;
}> {
  const result: Array<{ from: number; to: number; mark: MarkV3 }> = [];
  let offset = 0;
  for (const inline of content) {
    const to = offset + inline.text.length;
    if (to > offset) {
      for (const mark of inline.marks ?? []) result.push({ from: offset, to, mark });
    }
    offset = to;
  }
  return result;
}

function targetChildren(
  document: BlockDocumentV3,
  parentBlockId: Uuid | null,
): readonly CanonicalBlockV3[] {
  if (parentBlockId === null) return document.blocks;
  return childrenOfV3(indexDocument(document).get(parentBlockId)?.block as CanonicalBlockV3);
}

/**
 * Produces only commands the current semantic branch protocol can prove.
 * Unsupported table/unknown/type transformations fail closed and are routed
 * to recovery quarantine by the caller.
 */
export async function diffLegacyDocuments(input: {
  readonly pageId: Uuid;
  readonly base: BlockDocumentV3;
  readonly local: BlockDocumentV3;
}): Promise<LegacyDocumentDiffResult> {
  const base = normaliseDocumentV3(input.base);
  const local = normaliseDocumentV3(input.local);
  const page = OperationalPageDocument.create({ pageId: input.pageId, document: base });
  const commands: LegacySemanticCommand[] = [];

  const apply = (command: PageCommand): void => {
    const beforeDocument = page.snapshot();
    const transaction = page.transact([command]);
    commands.push(
      ...legacySemanticCommandsFromTransaction({
        pageId: input.pageId,
        beforeDocument,
        transaction,
      }),
    );
  };

  const targetIndex = indexDocument(local);

  // Existing blocks that become containers must be transformed before a new
  // or moved child can be placed below them.
  visitDocument(local, (target) => {
    const current = indexDocument(page.snapshot()).get(target.id)?.block;
    if (current === undefined || current.type === target.type) return;
    if (
      target.type === "unknown" ||
      current.type === "unknown" ||
      !isTransformableBlockType(target.type) ||
      !isTransformableBlockType(current.type)
    ) {
      return;
    }
    if (mayHaveChildrenV3(target.type)) {
      apply({
        type: "set-block-type",
        blockId: target.id,
        blockType: target.type,
        properties: propertiesOf(target),
      });
    }
  });

  // Insert identities in target pre-order. Containers are inserted shallow so
  // descendants that already existed can be moved rather than duplicated.
  visitDocument(local, (target, parentBlockId) => {
    if (indexDocument(page.snapshot()).has(target.id)) return;
    apply({
      type: "insert-block",
      block: shallowBlock(target),
      parentBlockId,
      beforeBlockId: null,
    });
  });

  const orderTarget = (parentBlockId: Uuid | null): void => {
    const siblings = targetChildren(local, parentBlockId);
    let beforeBlockId: Uuid | null = null;
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      const target = siblings[index];
      if (target === undefined) {
        throw new LegacyDocumentDiffError(
          "legacy-recovery.block-missing",
          "legacy recovery encountered an invalid target order",
        );
      }
      const current = indexDocument(page.snapshot()).get(target.id);
      if (current === undefined) {
        throw new LegacyDocumentDiffError(
          "legacy-recovery.block-missing",
          `legacy recovery cannot place missing block ${target.id}`,
        );
      }
      if (current.parentBlockId !== parentBlockId || current.beforeBlockId !== beforeBlockId) {
        apply({
          type: "move-block",
          blockId: target.id,
          parentBlockId,
          beforeBlockId,
        });
      }
      beforeBlockId = target.id;
    }
    for (const target of siblings) orderTarget(target.id);
  };
  orderTarget(null);

  // Surviving descendants are now outside removed parents, so deleting each
  // topmost absent subtree cannot erase an identity retained by the draft.
  const deleteAbsent = (blocks: readonly CanonicalBlockV3[]): void => {
    for (const block of blocks) {
      if (!targetIndex.has(block.id)) {
        apply({ type: "delete-block", blockId: block.id });
      } else {
        deleteAbsent(childrenOfV3(block));
      }
    }
  };
  deleteAbsent(page.snapshot().blocks);
  orderTarget(null);

  // Remaining type changes now target blocks whose incompatible children have
  // already moved or disappeared.
  visitDocument(local, (target) => {
    const current = indexDocument(page.snapshot()).get(target.id)?.block;
    if (current === undefined || current.type === target.type) return;
    if (
      target.type === "unknown" ||
      current.type === "unknown" ||
      !isTransformableBlockType(target.type) ||
      !isTransformableBlockType(current.type)
    ) {
      throw new LegacyDocumentDiffError(
        "legacy-recovery.type-unsupported",
        `legacy recovery cannot transform block ${target.id}`,
      );
    }
    if (target.type === "divider") {
      const text = plainText(current);
      if (text !== null && text.length > 0) {
        apply({ type: "replace-text", blockId: target.id, from: 0, to: text.length, text: "" });
      }
    }
    apply({
      type: "set-block-type",
      blockId: target.id,
      blockType: target.type,
      properties: propertiesOf(target),
    });
  });

  visitDocument(local, (target) => {
    let current = indexDocument(page.snapshot()).get(target.id)?.block;
    if (current === undefined || current.type !== target.type) {
      throw new LegacyDocumentDiffError(
        "legacy-recovery.type-mismatch",
        `legacy recovery cannot reproduce block ${target.id}`,
      );
    }
    if (!sameJson(rawProperties(current), rawProperties(target))) {
      throw new LegacyDocumentDiffError(
        "legacy-recovery.opaque-property",
        `legacy recovery cannot safely change opaque properties on block ${target.id}`,
      );
    }
    if (target.type === "unknown" || target.type === "table") {
      if (!sameJson(current, target)) {
        throw new LegacyDocumentDiffError(
          "legacy-recovery.complex-block",
          `legacy recovery cannot safely rewrite complex block ${target.id}`,
        );
      }
      return;
    }

    const currentProperties = propertiesOf(current);
    for (const [key, value] of Object.entries(propertiesOf(target))) {
      if (!sameJson(currentProperties[key], value)) {
        apply({
          type: "set-block-property",
          blockId: target.id,
          key,
          value: value as JsonValue,
        });
      }
    }
    current = indexDocument(page.snapshot()).get(target.id)?.block;
    if (current === undefined) return;

    if (hasInlineContentV3(current) && hasInlineContentV3(target)) {
      if (!sameJson(current.content, target.content)) {
        if (containsUnknownMarks(current.content) || containsUnknownMarks(target.content)) {
          throw new LegacyDocumentDiffError(
            "legacy-recovery.unknown-mark",
            `legacy recovery cannot safely rewrite unknown marks on block ${target.id}`,
          );
        }
        for (const run of markRuns(current.content)) {
          apply({ type: "set-mark", blockId: target.id, ...run, enabled: false });
        }
        const currentText = current.content.map(({ text }) => text).join("");
        const targetText = target.content.map(({ text }) => text).join("");
        if (currentText !== targetText) {
          apply({
            type: "replace-text",
            blockId: target.id,
            from: 0,
            to: currentText.length,
            text: targetText,
          });
        }
        for (const run of markRuns(target.content)) {
          apply({ type: "set-mark", blockId: target.id, ...run, enabled: true });
        }
      }
    } else if (current.type === "code" && target.type === "code" && current.text !== target.text) {
      apply({
        type: "replace-text",
        blockId: target.id,
        from: 0,
        to: current.text.length,
        text: target.text,
      });
    }
  });

  const document = normaliseDocumentV3(page.snapshot());
  if (canonicalDocumentJsonV3(document) !== canonicalDocumentJsonV3(local)) {
    throw new LegacyDocumentDiffError(
      "legacy-recovery.replay-mismatch",
      "legacy recovery semantic replay does not match the retained draft",
    );
  }
  return { commands, document, digest: await documentDigestV3(document) };
}
