import type { CanonicalBlockV3, InlineV3, MarkV3, Uuid } from "@myownnotion/domain";
import { isUuid, normaliseInlineV3 } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import { stableMoveChanges } from "./block-drag-drop.ts";
import { blockNoteBlockToCanonical } from "./blocknote-conversion.ts";
import type { EditorBlock, EditorBlocksChanged } from "./blocknote-schema.ts";

export interface TextReplacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

/** One bounded splice using UTF-16 offsets, the coordinate system shared by the DOM and Loro. */
export function minimalTextReplacement(before: string, after: string): TextReplacement | null {
  if (before === after) return null;
  let prefix = 0;
  const prefixLimit = Math.min(before.length, after.length);
  while (prefix < prefixLimit && before.charCodeAt(prefix) === after.charCodeAt(prefix))
    prefix += 1;
  if (
    prefix > 0 &&
    (isLowSurrogate(before.charCodeAt(prefix)) || isLowSurrogate(after.charCodeAt(prefix)))
  ) {
    prefix -= 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
  ) {
    suffix += 1;
  }
  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  return { from: prefix, to: beforeEnd, text: after.slice(prefix, afterEnd) };
}

function textOf(block: EditorBlock): string {
  const canonical = blockNoteBlockToCanonical(block);
  if (canonical.type === "code") return canonical.text;
  return "content" in canonical ? canonical.content.map((inline) => inline.text).join("") : "";
}

function inlineOf(block: EditorBlock): readonly InlineV3[] {
  const canonical = blockNoteBlockToCanonical(block);
  if (canonical.type === "code" || !("content" in canonical)) return [];
  return canonical.content;
}

function markKey(mark: MarkV3): string {
  switch (mark.type) {
    case "link":
      return `link:${mark.href}`;
    case "pageLink":
      return `pageLink:${mark.targetItemId}`;
    case "textColor":
    case "backgroundColor":
      return `${mark.type}:${mark.color}`;
    case "unknown":
      return `unknown:${JSON.stringify(mark.raw)}`;
    default:
      return mark.type;
  }
}

interface MarkSpan {
  readonly from: number;
  readonly to: number;
  readonly mark: MarkV3;
}

function markSpans(content: readonly InlineV3[]): Map<string, MarkSpan[]> {
  const spans = new Map<string, MarkSpan[]>();
  let offset = 0;
  for (const inline of normaliseInlineV3(content)) {
    const end = offset + inline.text.length;
    for (const mark of inline.marks ?? []) {
      const key = markKey(mark);
      const entries = spans.get(key) ?? [];
      const previous = entries.at(-1);
      if (previous !== undefined && previous.to === offset) {
        entries[entries.length - 1] = { from: previous.from, to: end, mark };
      } else {
        entries.push({ from: offset, to: end, mark });
      }
      spans.set(key, entries);
    }
    offset = end;
  }
  return spans;
}

function sameSpans(left: readonly MarkSpan[], right: readonly MarkSpan[]): boolean {
  return (
    left.length === right.length &&
    left.every((span, index) => {
      const other = right[index];
      return other !== undefined && span.from === other.from && span.to === other.to;
    })
  );
}

function markCommands(before: EditorBlock, after: EditorBlock): PageCommand[] {
  if (textOf(before) !== textOf(after)) return [];
  const previous = markSpans(inlineOf(before));
  const current = markSpans(inlineOf(after));
  const commands: PageCommand[] = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    const oldSpans = previous.get(key) ?? [];
    const newSpans = current.get(key) ?? [];
    if (sameSpans(oldSpans, newSpans)) continue;
    for (const span of oldSpans) {
      commands.push({
        type: "set-mark",
        blockId: after.id as Uuid,
        from: span.from,
        to: span.to,
        mark: span.mark,
        enabled: false,
      });
    }
    for (const span of newSpans) {
      commands.push({
        type: "set-mark",
        blockId: after.id as Uuid,
        from: span.from,
        to: span.to,
        mark: span.mark,
        enabled: true,
      });
    }
  }
  return commands;
}

interface Placement {
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
  readonly order: number;
}

function placements(blocks: readonly EditorBlock[]): Map<string, Placement> {
  const result = new Map<string, Placement>();
  let order = 0;
  const visit = (siblings: readonly EditorBlock[], parentBlockId: Uuid | null): void => {
    for (const [index, block] of siblings.entries()) {
      const next = siblings[index + 1];
      result.set(block.id, {
        parentBlockId,
        beforeBlockId: next === undefined ? null : (next.id as Uuid),
        order,
      });
      order += 1;
      visit(block.children as EditorBlock[], block.id as Uuid);
    }
  };
  visit(blocks, null);
  return result;
}

function canonicalType(block: EditorBlock): CanonicalBlockV3["type"] {
  return blockNoteBlockToCanonical(block).type;
}

function typeCommand(before: EditorBlock, after: EditorBlock): PageCommand | null {
  const previousType = canonicalType(before);
  const next = blockNoteBlockToCanonical(after);
  if (previousType === next.type) return null;
  switch (next.type) {
    case "paragraph":
    case "bulletedListItem":
    case "numberedListItem":
    case "quote":
      return { type: "set-block-type", blockId: after.id as Uuid, blockType: next.type };
    case "heading":
      return {
        type: "set-block-type",
        blockId: after.id as Uuid,
        blockType: "heading",
        properties: { level: next.level },
      };
    case "checkbox":
      return {
        type: "set-block-type",
        blockId: after.id as Uuid,
        blockType: "checkbox",
        properties: { checked: next.checked },
      };
    case "code":
      return {
        type: "set-block-type",
        blockId: after.id as Uuid,
        blockType: "code",
        properties: { language: next.language },
      };
    case "divider":
      return { type: "set-block-type", blockId: after.id as Uuid, blockType: "divider" };
    case "toggle":
    case "callout":
    case "table":
    case "image":
    case "fileEmbed":
    case "embed":
    case "unknown":
      return null;
  }
}

function propertyCommands(before: EditorBlock, after: EditorBlock): PageCommand[] {
  const oldBlock = blockNoteBlockToCanonical(before);
  const newBlock = blockNoteBlockToCanonical(after);
  if (oldBlock.type !== newBlock.type) return [];
  const commands: PageCommand[] = [];
  if (
    oldBlock.type === "heading" &&
    newBlock.type === "heading" &&
    oldBlock.level !== newBlock.level
  ) {
    commands.push({
      type: "set-block-property",
      blockId: after.id as Uuid,
      key: "level",
      value: newBlock.level,
    });
  }
  if (
    oldBlock.type === "checkbox" &&
    newBlock.type === "checkbox" &&
    oldBlock.checked !== newBlock.checked
  ) {
    commands.push({
      type: "set-block-property",
      blockId: after.id as Uuid,
      key: "checked",
      value: newBlock.checked,
    });
  }
  if (
    oldBlock.type === "code" &&
    newBlock.type === "code" &&
    oldBlock.language !== newBlock.language
  ) {
    commands.push({
      type: "set-block-property",
      blockId: after.id as Uuid,
      key: "language",
      value: newBlock.language,
    });
  }
  return commands;
}

function hasChangedAncestor(
  change: EditorBlocksChanged[number],
  changed: ReadonlySet<string>,
): boolean {
  const parent = "currentParent" in change ? change.currentParent : undefined;
  return parent !== undefined && changed.has(parent.id);
}

export function commandsFromBlockNoteChanges(input: {
  readonly changes: EditorBlocksChanged;
  readonly document: readonly EditorBlock[];
}): PageCommand[] {
  const needsLayout = input.changes.some(
    (change) => change.type === "insert" || change.type === "move",
  );
  const layout = needsLayout ? placements(input.document) : new Map<string, Placement>();
  const insertedIds = new Set(
    input.changes.filter((change) => change.type === "insert").map((change) => change.block.id),
  );
  const deletedIds = new Set(
    input.changes.filter((change) => change.type === "delete").map((change) => change.block.id),
  );
  const commands: PageCommand[] = [];

  const inserts = input.changes
    .filter((change) => change.type === "insert" && !hasChangedAncestor(change, insertedIds))
    .sort(
      (left, right) =>
        (layout.get(right.block.id)?.order ?? -1) - (layout.get(left.block.id)?.order ?? -1),
    );
  for (const change of inserts) {
    const placement = layout.get(change.block.id);
    if (placement === undefined || !isUuid(change.block.id)) continue;
    commands.push({
      type: "insert-block",
      block: blockNoteBlockToCanonical(change.block),
      parentBlockId: placement.parentBlockId,
      beforeBlockId: placement.beforeBlockId,
    });
  }

  const moves = input.changes.some((change) => change.type === "move")
    ? stableMoveChanges(input.changes, input.document).filter(
        (change) => !hasChangedAncestor(change, insertedIds),
      )
    : [];
  for (const change of moves) {
    const placement = layout.get(change.block.id);
    if (placement === undefined || !isUuid(change.block.id)) continue;
    commands.push({
      type: "move-block",
      blockId: change.block.id,
      parentBlockId: placement.parentBlockId,
      beforeBlockId: placement.beforeBlockId,
    });
  }

  for (const change of input.changes) {
    if (change.type !== "update" || !isUuid(change.block.id)) continue;
    const changedType = typeCommand(change.prevBlock, change.block);
    if (changedType !== null) commands.push(changedType);
    const replacement = minimalTextReplacement(textOf(change.prevBlock), textOf(change.block));
    if (replacement !== null) {
      commands.push({
        type: "replace-text",
        blockId: change.block.id,
        ...replacement,
      });
    }
    commands.push(...propertyCommands(change.prevBlock, change.block));
    commands.push(...markCommands(change.prevBlock, change.block));
  }

  for (const change of input.changes) {
    if (change.type !== "delete") continue;
    const previousParent =
      "prevParent" in change
        ? (change as { readonly prevParent?: EditorBlock | null }).prevParent
        : undefined;
    const deletedParent = previousParent != null ? deletedIds.has(previousParent.id) : false;
    if (deletedParent) continue;
    if (isUuid(change.block.id)) commands.push({ type: "delete-block", blockId: change.block.id });
  }
  return commands;
}

/** Coalesces composition updates so one IME confirmation becomes one page transaction. */
export class EditorChangeBatcher {
  readonly #publish: (changes: EditorBlocksChanged) => void;
  #composing = false;
  #pending: EditorBlocksChanged = [];

  constructor(publish: (changes: EditorBlocksChanged) => void) {
    this.#publish = publish;
  }

  beginComposition(): void {
    this.#composing = true;
  }

  push(changes: EditorBlocksChanged): void {
    if (!this.#composing) {
      this.#publish(changes);
      return;
    }
    this.#pending = [...this.#pending, ...changes];
  }

  endComposition(): void {
    this.#composing = false;
    if (this.#pending.length === 0) return;
    const latestByBlock = new Map<string, EditorBlocksChanged[number]>();
    for (const change of this.#pending) {
      const first = latestByBlock.get(change.block.id);
      latestByBlock.set(
        change.block.id,
        first?.type === "update" && change.type === "update"
          ? { ...change, prevBlock: first.prevBlock }
          : change,
      );
    }
    this.#pending = [];
    this.#publish([...latestByBlock.values()] as EditorBlocksChanged);
  }
}
