import type { CanonicalBlockV3, InlineV3, MarkV3, TableBlockV3, Uuid } from "@myownnotion/domain";
import { isUuid, normaliseInlineV3 } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import { stableMoveChanges } from "./block-drag-drop.ts";
import { blockNoteBlockToCanonical, blockNoteInlineToCanonical } from "./blocknote-conversion.ts";
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
  if (block.type === "tableCell") {
    return blockNoteInlineToCanonical(block.content)
      .map((inline) => inline.text)
      .join("");
  }
  const canonical = blockNoteBlockToCanonical(block);
  if (canonical.type === "code") return canonical.text;
  return "content" in canonical ? canonical.content.map((inline) => inline.text).join("") : "";
}

function inlineOf(block: EditorBlock): readonly InlineV3[] {
  if (block.type === "tableCell") return blockNoteInlineToCanonical(block.content);
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
  if (
    before.type === "tableRow" ||
    before.type === "tableCell" ||
    after.type === "tableRow" ||
    after.type === "tableCell"
  ) {
    return null;
  }
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
      // A slash-menu or conversion gesture reaches rich blocks as a type
      // change of the existing block, not as an insert. Dropping it here made
      // the visible surface diverge from the operational authority until the
      // next projection assertion rewound the owner's work.
      return { type: "set-block-type", blockId: after.id as Uuid, blockType: "toggle" };
    case "callout":
      return {
        type: "set-block-type",
        blockId: after.id as Uuid,
        blockType: "callout",
        properties: { icon: next.icon, tone: next.tone },
      };
    case "table":
    case "image":
    case "fileEmbed":
    case "embed":
    case "unknown":
      // Media and opaque blocks cannot take a text block's content; they only
      // ever enter through dedicated insertion paths that create their own id.
      return null;
  }
}

function propertyCommands(before: EditorBlock, after: EditorBlock): PageCommand[] {
  if (
    before.type === "tableRow" ||
    before.type === "tableCell" ||
    after.type === "tableRow" ||
    after.type === "tableCell"
  ) {
    return [];
  }
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
  if (oldBlock.type === "callout" && newBlock.type === "callout") {
    if (oldBlock.icon !== newBlock.icon) {
      commands.push({
        type: "set-block-property",
        blockId: after.id as Uuid,
        key: "icon",
        value: newBlock.icon,
      });
    }
    if (oldBlock.tone !== newBlock.tone) {
      commands.push({
        type: "set-block-property",
        blockId: after.id as Uuid,
        key: "tone",
        value: newBlock.tone,
      });
    }
  }
  if (oldBlock.type === "image" && newBlock.type === "image") {
    for (const key of ["fileItemId", "caption", "altText", "displayWidth"] as const) {
      if (oldBlock[key] !== newBlock[key]) {
        commands.push({
          type: "set-block-property",
          blockId: after.id as Uuid,
          key,
          value: newBlock[key],
        });
      }
    }
  }
  if (oldBlock.type === "fileEmbed" && newBlock.type === "fileEmbed") {
    for (const key of ["fileItemId", "caption"] as const) {
      if (oldBlock[key] !== newBlock[key]) {
        commands.push({
          type: "set-block-property",
          blockId: after.id as Uuid,
          key,
          value: newBlock[key],
        });
      }
    }
  }
  if (oldBlock.type === "embed" && newBlock.type === "embed") {
    for (const key of ["provider", "sourceUrl", "caption"] as const) {
      if (oldBlock[key] !== newBlock[key]) {
        commands.push({
          type: "set-block-property",
          blockId: after.id as Uuid,
          key,
          value: newBlock[key],
        });
      }
    }
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

function isInternalTableBlock(block: EditorBlock): boolean {
  return block.type === "tableRow" || block.type === "tableCell";
}

function findEditorBlock(blocks: readonly EditorBlock[], blockId: string): EditorBlock | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findEditorBlock(block.children as EditorBlock[], blockId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function editorTable(block: EditorBlock): TableBlockV3 {
  const canonical = blockNoteBlockToCanonical(block);
  if (canonical.type !== "table") {
    throw new TypeError(`le tableau ${block.id} n’a pas une structure éditable valide`);
  }
  return canonical;
}

function nestedEditorIds(block: EditorBlock): string[] {
  return [block.id, ...block.children.flatMap((child) => nestedEditorIds(child as EditorBlock))];
}

function tableColumnCommands(
  beforeBlock: EditorBlock,
  afterBlock: EditorBlock,
): { readonly commands: PageCommand[]; readonly handledIds: readonly string[] } {
  const before = editorTable(beforeBlock);
  const after = editorTable(afterBlock);
  const beforeIds = new Set(before.columns.map(({ id }) => id));
  const afterIds = new Set(after.columns.map(({ id }) => id));
  const removed = before.columns.filter(({ id }) => !afterIds.has(id));
  const added = after.columns.filter(({ id }) => !beforeIds.has(id));
  const commonBefore = before.columns.filter(({ id }) => afterIds.has(id)).map(({ id }) => id);
  const commonAfter = after.columns.filter(({ id }) => beforeIds.has(id)).map(({ id }) => id);
  if (commonBefore.some((id, index) => id !== commonAfter[index])) {
    throw new TypeError("la réorganisation des colonnes n’est pas encore une opération sûre");
  }
  for (const column of after.columns) {
    const oldColumn = before.columns.find(({ id }) => id === column.id);
    if (oldColumn !== undefined && oldColumn.width !== column.width) {
      throw new TypeError("le redimensionnement des colonnes n’est pas encore une opération sûre");
    }
  }

  const commands: PageCommand[] = removed.map((column) => ({
    type: "delete-table-column",
    tableId: after.id,
    columnId: column.id,
  }));
  // Right-to-left insertion keeps every `beforeColumnId` resolvable when one
  // editor gesture introduces more than one adjacent column.
  for (const column of [...added].reverse()) {
    const columnIndex = after.columns.findIndex(({ id }) => id === column.id);
    const beforeColumnId = after.columns[columnIndex + 1]?.id ?? null;
    const cells = before.rows.map((oldRow) => {
      const row = after.rows.find(({ id }) => id === oldRow.id);
      const cell = row?.cells[columnIndex];
      if (cell === undefined) {
        throw new TypeError(
          `la colonne ${column.id} n’a pas de cellule pour la ligne ${oldRow.id}`,
        );
      }
      return { rowId: oldRow.id, cell };
    });
    commands.push({
      type: "insert-table-column",
      tableId: after.id,
      column,
      cells,
      beforeColumnId,
    });
  }

  const changedColumnIds = new Set([...removed, ...added].map(({ id }) => id));
  const handledIds: string[] = [];
  for (const source of [before, after]) {
    for (const row of source.rows) {
      for (const [index, cell] of row.cells.entries()) {
        if (changedColumnIds.has(source.columns[index]?.id as Uuid)) handledIds.push(cell.id);
      }
    }
  }
  return { commands, handledIds };
}

export function commandsFromBlockNoteChanges(input: {
  readonly changes: EditorBlocksChanged;
  readonly document: readonly EditorBlock[];
  readonly tableIdForInternalBlock?: ((blockId: Uuid) => Uuid | null) | undefined;
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
  const handledInternalIds = new Set<string>();

  for (const change of input.changes) {
    if (change.type !== "update" || change.block.type !== "table") continue;
    const tableChanges = tableColumnCommands(change.prevBlock, change.block);
    commands.push(...tableChanges.commands);
    for (const blockId of tableChanges.handledIds) handledInternalIds.add(blockId);
  }

  for (const change of input.changes) {
    if (change.type !== "insert" || change.block.type !== "tableRow") continue;
    const placement = layout.get(change.block.id);
    if (placement?.parentBlockId === null || placement === undefined) {
      throw new TypeError(`la nouvelle ligne ${change.block.id} n’est rattachée à aucun tableau`);
    }
    // A row created as part of a brand-new table travels inside that table's
    // own insert-block subtree. Translating it again as insert-table-row
    // would target a table the operational state does not hold yet.
    if (insertedIds.has(placement.parentBlockId)) {
      for (const blockId of nestedEditorIds(change.block)) handledInternalIds.add(blockId);
      continue;
    }
    const tableBlock = findEditorBlock(input.document, placement.parentBlockId);
    if (tableBlock?.type !== "table" || !isUuid(change.block.id)) {
      throw new TypeError(`la nouvelle ligne ${change.block.id} n’est pas dans un tableau valide`);
    }
    const row = editorTable(tableBlock).rows.find(({ id }) => id === change.block.id);
    if (row === undefined)
      throw new TypeError(`la nouvelle ligne ${change.block.id} est introuvable`);
    commands.push({
      type: "insert-table-row",
      tableId: tableBlock.id as Uuid,
      row,
      beforeRowId: placement.beforeBlockId,
    });
    for (const blockId of nestedEditorIds(change.block)) handledInternalIds.add(blockId);
  }

  for (const change of input.changes) {
    if (change.type !== "delete" || change.block.type !== "tableRow") continue;
    if (!isUuid(change.block.id))
      throw new TypeError("la ligne supprimée n’a pas d’identité stable");
    const tableId = input.tableIdForInternalBlock?.(change.block.id) ?? null;
    if (tableId === null) {
      throw new TypeError(`le tableau de la ligne supprimée ${change.block.id} est introuvable`);
    }
    commands.push({ type: "delete-table-row", tableId, rowId: change.block.id });
    for (const blockId of nestedEditorIds(change.block)) handledInternalIds.add(blockId);
  }

  const inserts = input.changes
    .filter(
      (change) =>
        change.type === "insert" &&
        !isInternalTableBlock(change.block) &&
        !hasChangedAncestor(change, insertedIds),
    )
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
        (change) => !isInternalTableBlock(change.block) && !hasChangedAncestor(change, insertedIds),
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
    if (change.block.type === "table" || change.block.type === "tableRow") continue;
    const changedType = typeCommand(change.prevBlock, change.block);
    const replacement = minimalTextReplacement(textOf(change.prevBlock), textOf(change.block));
    // A divider cannot temporarily retain text in the operational model. The
    // slash menu can expose `/div` and its final type change in one coalesced
    // browser batch, so remove the query before changing the block type.
    // Other text-capable transforms keep their type-first ordering.
    const clearsTextForDivider =
      changedType?.type === "set-block-type" && changedType.blockType === "divider";
    if (clearsTextForDivider && replacement !== null) {
      commands.push({
        type: "replace-text",
        blockId: change.block.id,
        ...replacement,
      });
    }
    if (changedType !== null) commands.push(changedType);
    if (!clearsTextForDivider && replacement !== null) {
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
    if (isInternalTableBlock(change.block)) {
      if (!handledInternalIds.has(change.block.id) && change.block.type === "tableRow") {
        throw new TypeError(`la suppression de la ligne ${change.block.id} n’a pas été traduite`);
      }
      continue;
    }
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

function indexEditorSubtree(index: Map<string, EditorBlock>, block: EditorBlock): void {
  index.set(block.id, block);
  if (!Array.isArray(block.children)) return;
  for (const child of block.children as EditorBlock[]) indexEditorSubtree(index, child);
}

function removeEditorSubtree(index: Map<string, EditorBlock>, block: EditorBlock): void {
  index.delete(block.id);
  if (!Array.isArray(block.children)) return;
  for (const child of block.children as EditorBlock[]) removeEditorSubtree(index, child);
}

/**
 * Reanchors BlockNote's incremental before-states to the operational authority.
 *
 * BlockNote can coalesce a fast input immediately after a slash transform and
 * report `I -> Information` without ever publishing the leading `I` as its own
 * change. The browser projection is truthful, but applying that delta to an
 * authority that still holds an empty callout would durably lose the first
 * character. Replaying each notification from the engine snapshot catches the
 * omitted prefix while preserving the order of multiple changes in one batch.
 */
export function rebaseBlockNoteChanges(
  changes: EditorBlocksChanged,
  authoritativeDocument: readonly EditorBlock[],
): EditorBlocksChanged {
  const authority = new Map<string, EditorBlock>();
  for (const block of authoritativeDocument) indexEditorSubtree(authority, block);

  return changes.map((change) => {
    switch (change.type) {
      case "insert":
        indexEditorSubtree(authority, change.block);
        return change;
      case "update": {
        const previous = authority.get(change.block.id) ?? change.prevBlock;
        const current = authority.get(change.block.id);
        if (current !== undefined) removeEditorSubtree(authority, current);
        indexEditorSubtree(authority, change.block);
        return { ...change, prevBlock: previous };
      }
      case "delete": {
        const current = authority.get(change.block.id) ?? change.block;
        removeEditorSubtree(authority, current);
        return change;
      }
      case "move":
        // A move changes placement only. Keep the authority's content as the
        // baseline for any update that follows it in the same notification.
        return change;
    }
    const exhaustive: never = change;
    return exhaustive;
  });
}

type EditorChangePublisher = (
  changes: EditorBlocksChanged,
  document: readonly EditorBlock[],
) => void | Promise<void>;

function descendantIdentityShape(block: EditorBlock): readonly unknown[] {
  return block.children.map((child) => [
    child.id,
    child.type,
    descendantIdentityShape(child as EditorBlock),
  ]);
}

function textCoalescingShape(block: EditorBlock): string {
  return JSON.stringify({
    type: block.type,
    props: block.props,
    marks: normaliseInlineV3(inlineOf(block)).map(({ marks }) => marks ?? []),
    descendants: descendantIdentityShape(block),
  });
}

function isCoalescibleTextUpdate(change: EditorBlocksChanged[number]): boolean {
  return (
    change.type === "update" &&
    change.source.type === "local" &&
    textOf(change.prevBlock) !== textOf(change.block) &&
    textCoalescingShape(change.prevBlock) === textCoalescingShape(change.block)
  );
}

/**
 * Keeps only the first and final projection of consecutive updates to one
 * block. Structural changes remain in order: collapsing across an insert,
 * move or delete would erase a distinct owner gesture.
 */
function coalesceEditorUpdates(changes: EditorBlocksChanged): EditorBlocksChanged {
  const coalesced: EditorBlocksChanged = [];
  const openUpdateByBlock = new Map<string, number>();
  for (const change of changes) {
    if (change.type !== "update" || !isCoalescibleTextUpdate(change)) {
      // Tree mutations, paste/drop, formatting, properties and type changes
      // are owner gestures, not typing noise. They close every text burst so
      // undo can never remove a semantic action together with a late key.
      openUpdateByBlock.clear();
      coalesced.push(change);
      continue;
    }
    const existingIndex = openUpdateByBlock.get(change.block.id);
    if (existingIndex === undefined) {
      openUpdateByBlock.set(change.block.id, coalesced.length);
      coalesced.push(change);
      continue;
    }
    const existing = coalesced[existingIndex];
    if (existing?.type !== "update") {
      throw new Error("editor update coalescing lost its structural boundary");
    }
    coalesced[existingIndex] = { ...change, prevBlock: existing.prevBlock };
  }
  return coalesced;
}

function editorTransactions(changes: EditorBlocksChanged): EditorBlocksChanged[] {
  const transactions: EditorBlocksChanged[] = [];
  let current: EditorBlocksChanged = [];
  for (const change of coalesceEditorUpdates(changes)) {
    const previous = current.at(-1);
    const beginsSemanticGestureAfterText =
      previous !== undefined &&
      previous.type === "update" &&
      isCoalescibleTextUpdate(previous) &&
      change.type === "update" &&
      !isCoalescibleTextUpdate(change) &&
      previous.block.id === change.block.id &&
      textCoalescingShape(previous.block) === textCoalescingShape(change.prevBlock);
    if (beginsSemanticGestureAfterText) {
      // BlockNote can publish an input rule after its triggering character,
      // without a standalone notification for that character. Extend the text
      // burst to the semantic change's actual before-state so the first
      // transaction catches the authority up exactly; the second transaction
      // can then safely translate the type/marks/properties change and owns the
      // corresponding undo step on its own.
      if (previous.type === "update" && change.type === "update") {
        current[current.length - 1] = { ...previous, block: change.prevBlock };
      }
      transactions.push(current);
      current = [];
    }
    current.push(change);
  }
  if (current.length > 0) transactions.push(current);
  return transactions;
}

interface PendingEditorChanges {
  readonly type: "changes";
  changes: EditorBlocksChanged;
  document: readonly EditorBlock[] | null;
}

/**
 * Applies back-pressure at the BlockNote/durability seam.
 *
 * The first visible change starts its local commit immediately. Changes that
 * arrive while that commit is in flight are reduced only when they are
 * consecutive local text updates to the same block. Notifications emitted by
 * one complex BlockNote action remain together, because inserts and moves can
 * reference siblings created in that same action. A semantic update following
 * a text burst is split into the next transaction, so a transform never owns
 * the last delayed key. IME input uses one reserved queue position and is
 * published only after composition ends.
 */
export class EditorChangeBatcher {
  readonly #publish: EditorChangePublisher;
  #composing = false;
  #draining = false;
  #pending: PendingEditorChanges[] = [];
  #compositionWork: PendingEditorChanges | null = null;
  #idleWaiters: Array<() => void> = [];

  constructor(publish: EditorChangePublisher) {
    this.#publish = publish;
  }

  beginComposition(): void {
    if (this.#composing) return;
    this.#composing = true;
    const work: PendingEditorChanges = { type: "changes", changes: [], document: null };
    this.#compositionWork = work;
    this.#pending.push(work);
    void this.#drain();
  }

  push(changes: EditorBlocksChanged, document: readonly EditorBlock[]): void {
    if (changes.length === 0) return;
    if (this.#composing && this.#compositionWork !== null) {
      this.#compositionWork.changes = [...this.#compositionWork.changes, ...changes];
      this.#compositionWork.document = [...document];
      return;
    }
    this.#enqueueChanges(changes, document);
    void this.#drain();
  }

  endComposition(): void {
    if (!this.#composing) return;
    this.#composing = false;
    const composition = this.#compositionWork;
    this.#compositionWork = null;
    if (composition !== null) {
      if (composition.changes.length === 0) {
        const index = this.#pending.indexOf(composition);
        if (index >= 0) this.#pending.splice(index, 1);
      } else {
        composition.changes = coalesceEditorUpdates(composition.changes);
      }
    }
    void this.#drain();
  }

  /**
   * Runs a history action after BlockNote has emitted the gesture already
   * visible in its DOM and every resulting local transaction has committed.
   * One task boundary is intentional: some BlockNote commands notify their
   * listeners after the menu/keyboard handler that changed the document.
   */
  async runAfterPendingChanges<T>(action: () => T | Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await this.#whenIdle();
    return action();
  }

  #enqueueChanges(changes: EditorBlocksChanged, document: readonly EditorBlock[]): void {
    const previous = this.#pending.at(-1);
    const previousTail = previous?.changes.at(-1);
    const incomingHead = changes[0];
    const canJoinFollowingUpdateGesture =
      previousTail !== undefined &&
      previousTail.type === "update" &&
      isCoalescibleTextUpdate(previousTail) &&
      incomingHead?.type === "update" &&
      previousTail.block.id === incomingHead.block.id &&
      textCoalescingShape(previousTail.block) === textCoalescingShape(incomingHead.prevBlock) &&
      changes.every((change) => change.type === "update");
    const canExtendPendingTextBurst =
      previous !== undefined &&
      previous !== this.#compositionWork &&
      previous.changes.every(isCoalescibleTextUpdate) &&
      (changes.every(isCoalescibleTextUpdate) || canJoinFollowingUpdateGesture);
    if (canExtendPendingTextBurst) {
      previous.changes = coalesceEditorUpdates([...previous.changes, ...changes]);
      previous.document = [...document];
      return;
    }
    this.#pending.push({ type: "changes", changes: [...changes], document: [...document] });
  }

  #whenIdle(): Promise<void> {
    if (!this.#draining && !this.#composing && this.#pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #resolveIdleWaiters(): void {
    if (this.#draining || this.#composing || this.#pending.length > 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#pending.length > 0) {
        const pending = this.#pending[0];
        if (pending === this.#compositionWork && this.#composing) break;
        this.#pending.shift();
        if (pending !== undefined) {
          if (pending.document === null) {
            throw new Error("editor change batch lost its document projection");
          }
          for (const transaction of editorTransactions(pending.changes)) {
            await this.#publish(transaction, pending.document);
          }
        }
      }
    } finally {
      this.#draining = false;
      // A push can occur after the loop observes an empty queue but before its
      // awaited continuation clears `draining`. Recheck once so that narrow
      // event-loop window cannot strand visible input in memory.
      const next = this.#pending[0];
      if (next !== undefined && !(next === this.#compositionWork && this.#composing)) {
        void this.#drain();
      } else {
        this.#resolveIdleWaiters();
      }
    }
  }
}
