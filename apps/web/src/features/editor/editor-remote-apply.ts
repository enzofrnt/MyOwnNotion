import type { PartialBlock } from "@blocknote/core";
import { canonicalDocumentJsonV3, type Uuid } from "@myownnotion/domain";
import { blockNoteDocumentToCanonical } from "./blocknote-conversion.ts";
import type { EditorBlock, EditorInstance } from "./blocknote-schema.ts";

export type EditorChangeOrigin = "local" | "remote" | "recovery";

export class EditorOriginGuard {
  #origin: EditorChangeOrigin = "local";

  get origin(): EditorChangeOrigin {
    return this.#origin;
  }

  get acceptLocalChanges(): boolean {
    return this.#origin === "local";
  }

  run<T>(origin: Exclude<EditorChangeOrigin, "local">, apply: () => T): T {
    const previous = this.#origin;
    this.#origin = origin;
    try {
      return apply();
    } finally {
      this.#origin = previous;
    }
  }
}

export type RemoteEditorChange =
  | {
      readonly type: "insert";
      readonly block: EditorBlock;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | {
      readonly type: "move";
      readonly blockId: Uuid;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | { readonly type: "update"; readonly block: EditorBlock }
  | { readonly type: "delete"; readonly blockId: Uuid };

interface IndexedBlock {
  readonly block: EditorBlock;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
  readonly order: number;
}

function indexBlocks(blocks: readonly EditorBlock[]): Map<string, IndexedBlock> {
  const index = new Map<string, IndexedBlock>();
  let order = 0;
  const visit = (siblings: readonly EditorBlock[], parentBlockId: Uuid | null): void => {
    for (const [position, block] of siblings.entries()) {
      const next = siblings[position + 1];
      index.set(block.id, {
        block,
        parentBlockId,
        beforeBlockId: next === undefined ? null : (next.id as Uuid),
        order,
      });
      order += 1;
      visit(block.children as EditorBlock[], block.id as Uuid);
    }
  };
  visit(blocks, null);
  return index;
}

function equalBlockContent(left: EditorBlock, right: EditorBlock): boolean {
  return (
    JSON.stringify({ type: left.type, props: left.props, content: left.content }) ===
    JSON.stringify({ type: right.type, props: right.props, content: right.content })
  );
}

function longestCommonSubsequence(left: readonly string[], right: readonly string[]): Set<string> {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const row = lengths[leftIndex];
      if (row === undefined) continue;
      row[rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + (lengths[leftIndex + 1]?.[rightIndex + 1] ?? 0)
          : Math.max(
              lengths[leftIndex + 1]?.[rightIndex] ?? 0,
              lengths[leftIndex]?.[rightIndex + 1] ?? 0,
            );
    }
  }
  const kept = new Set<string>();
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      kept.add(left[leftIndex] as string);
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      (lengths[leftIndex + 1]?.[rightIndex] ?? 0) > (lengths[leftIndex]?.[rightIndex + 1] ?? 0)
    ) {
      leftIndex += 1;
    } else {
      // On a tie keep the earlier block from the old order. For a simple swap
      // this yields one move (the new leading block), not two reciprocal moves.
      rightIndex += 1;
    }
  }
  return kept;
}

function movedBlockIds(
  before: ReadonlyMap<string, IndexedBlock>,
  after: ReadonlyMap<string, IndexedBlock>,
): Set<string> {
  const moved = new Set<string>();
  const parentKeys = new Set<string>();
  for (const entry of after.values()) {
    const previous = before.get(entry.block.id);
    if (previous === undefined) continue;
    if (previous.parentBlockId !== entry.parentBlockId) {
      moved.add(entry.block.id);
    } else {
      parentKeys.add(entry.parentBlockId ?? "__root__");
    }
  }
  for (const parentKey of parentKeys) {
    const parentId = parentKey === "__root__" ? null : parentKey;
    const oldOrder = [...before.values()]
      .filter(
        (entry) =>
          entry.parentBlockId === parentId && after.get(entry.block.id)?.parentBlockId === parentId,
      )
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.block.id);
    const newOrder = [...after.values()]
      .filter(
        (entry) =>
          entry.parentBlockId === parentId &&
          before.get(entry.block.id)?.parentBlockId === parentId,
      )
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.block.id);
    const stable = longestCommonSubsequence(oldOrder, newOrder);
    for (const id of newOrder) {
      if (!stable.has(id)) moved.add(id);
    }
  }
  return moved;
}

/** Plans only identity-addressed mutations; a full replacement is a caller-owned fallback. */
export function planRemoteEditorChanges(
  current: readonly EditorBlock[],
  next: readonly EditorBlock[],
): RemoteEditorChange[] {
  const before = indexBlocks(current);
  const after = indexBlocks(next);
  const moved = movedBlockIds(before, after);
  const changes: RemoteEditorChange[] = [];

  for (const entry of [...before.values()].sort((left, right) => right.order - left.order)) {
    if (!after.has(entry.block.id)) {
      changes.push({ type: "delete", blockId: entry.block.id as Uuid });
    }
  }
  for (const entry of [...after.values()].sort((left, right) => right.order - left.order)) {
    const previous = before.get(entry.block.id);
    if (previous === undefined) {
      changes.push({
        type: "insert",
        block: entry.block,
        parentBlockId: entry.parentBlockId,
        beforeBlockId: entry.beforeBlockId,
      });
      continue;
    }
    if (moved.has(entry.block.id)) {
      changes.push({
        type: "move",
        blockId: entry.block.id as Uuid,
        parentBlockId: entry.parentBlockId,
        beforeBlockId: entry.beforeBlockId,
      });
    }
    if (!equalBlockContent(previous.block, entry.block)) {
      changes.push({ type: "update", block: entry.block });
    }
  }
  return changes;
}

export interface StableEditorSelection {
  readonly activeBlockId: Uuid;
  readonly placement: "start" | "end";
}

function flattenedIds(blocks: readonly EditorBlock[]): Uuid[] {
  const result: Uuid[] = [];
  const visit = (entries: readonly EditorBlock[]): void => {
    for (const block of entries) {
      result.push(block.id as Uuid);
      visit(block.children as EditorBlock[]);
    }
  };
  visit(blocks);
  return result;
}

export function restoreStableSelection(
  selection: StableEditorSelection,
  next: readonly EditorBlock[],
  previous: readonly EditorBlock[] = next,
): StableEditorSelection | null {
  const nextIds = flattenedIds(next);
  if (nextIds.includes(selection.activeBlockId)) return selection;
  const oldIds = flattenedIds(previous);
  const oldIndex = oldIds.indexOf(selection.activeBlockId);
  if (oldIndex < 0 || nextIds.length === 0) return null;
  for (let distance = 1; distance <= oldIds.length; distance += 1) {
    const after = oldIds[oldIndex + distance];
    if (after !== undefined && nextIds.includes(after)) {
      return { activeBlockId: after, placement: "start" };
    }
    const before = oldIds[oldIndex - distance];
    if (before !== undefined && nextIds.includes(before)) {
      return { activeBlockId: before, placement: "end" };
    }
  }
  return { activeBlockId: nextIds[0] as Uuid, placement: "start" };
}

function visibleProjection(blocks: readonly EditorBlock[]): string {
  return canonicalDocumentJsonV3(blockNoteDocumentToCanonical(blocks));
}

function blockUpdate(block: EditorBlock): PartialBlock {
  const update: Record<string, unknown> = {
    type: block.type,
    props: structuredClone(block.props),
  };
  if (block.content !== undefined) update["content"] = structuredClone(block.content);
  return update as PartialBlock;
}

function insertAtPlacement(
  editor: EditorInstance,
  block: EditorBlock,
  parentBlockId: Uuid | null,
  beforeBlockId: Uuid | null,
): void {
  const partial = structuredClone(block) as unknown as PartialBlock;
  if (beforeBlockId !== null && editor.getBlock(beforeBlockId) !== undefined) {
    editor.insertBlocks([partial], beforeBlockId, "before");
    return;
  }

  if (parentBlockId !== null) {
    const parent = editor.getBlock(parentBlockId) as EditorBlock | undefined;
    if (parent === undefined) throw new Error(`remote parent ${parentBlockId} is unavailable`);
    const lastChild = (parent.children as EditorBlock[]).at(-1);
    if (lastChild !== undefined) {
      editor.insertBlocks([partial], lastChild.id, "after");
      return;
    }

    // BlockNote has no public "insert as first child" primitive. Insert next
    // to the empty parent, then use its ordinary nesting command in the same
    // transaction; the stable UUID and the whole subtree are preserved.
    editor.insertBlocks([partial], parentBlockId, "after");
    editor.setTextCursorPosition(block.id, "start");
    editor.nestBlock();
    return;
  }

  const lastRoot = (editor.document as EditorBlock[]).at(-1);
  if (lastRoot === undefined) throw new Error("the visible document has no insertion anchor");
  editor.insertBlocks([partial], lastRoot.id, "after");
}

function applyTargetedChanges(
  editor: EditorInstance,
  changes: readonly RemoteEditorChange[],
): void {
  editor.transact(() => {
    for (const change of changes) {
      switch (change.type) {
        case "delete":
          if (editor.getBlock(change.blockId) !== undefined) editor.removeBlocks([change.blockId]);
          break;
        case "insert":
          insertAtPlacement(editor, change.block, change.parentBlockId, change.beforeBlockId);
          break;
        case "move": {
          const block = editor.getBlock(change.blockId) as EditorBlock | undefined;
          if (block === undefined) throw new Error(`remote block ${change.blockId} is unavailable`);
          editor.removeBlocks([change.blockId]);
          insertAtPlacement(editor, block, change.parentBlockId, change.beforeBlockId);
          break;
        }
        case "update":
          if (editor.getBlock(change.block.id) === undefined) {
            throw new Error(`remote block ${change.block.id} is unavailable`);
          }
          editor.updateBlock(change.block.id, blockUpdate(change.block));
          break;
      }
    }
  });
}

export interface RemoteEditorApplyResult {
  readonly targetedChanges: readonly RemoteEditorChange[];
  readonly repairedProjection: boolean;
  readonly restoredSelection: StableEditorSelection | null;
}

/** Applies a remote projection by UUID, suppresses echo, and repairs only if the targeted plan diverges. */
export function applyRemoteEditorProjection(input: {
  readonly editor: EditorInstance;
  readonly origin: EditorOriginGuard;
  readonly next: readonly EditorBlock[];
}): RemoteEditorApplyResult {
  const previous = input.editor.document as EditorBlock[];

  // An identical projection must not touch the surface at all. A handover or
  // echoed merge often replays exactly what is already visible; reasserting
  // even the selection would collapse an open range and dismiss
  // selection-driven UI (toolbars, link pickers) mid-gesture.
  if (
    planRemoteEditorChanges(previous, input.next).length === 0 &&
    visibleProjection(previous) === visibleProjection(input.next)
  ) {
    return { targetedChanges: [], repairedProjection: false, restoredSelection: null };
  }

  let selection: StableEditorSelection | null = null;
  try {
    selection = {
      activeBlockId: input.editor.getTextCursorPosition().block.id as Uuid,
      placement: "end",
    };
  } catch {
    selection = null;
  }

  const targetedChanges = planRemoteEditorChanges(previous, input.next);
  let repairedProjection = false;
  try {
    input.origin.run("remote", () => applyTargetedChanges(input.editor, targetedChanges));
  } catch {
    repairedProjection = true;
  }

  if (
    repairedProjection ||
    visibleProjection(input.editor.document as EditorBlock[]) !== visibleProjection(input.next)
  ) {
    repairedProjection = true;
    input.origin.run("recovery", () => {
      input.editor.replaceBlocks(
        input.editor.document,
        input.next.map((block) => structuredClone(block)) as unknown as PartialBlock[],
      );
    });
  }

  const restoredSelection =
    selection === null
      ? null
      : restoreStableSelection(selection, input.editor.document as EditorBlock[], previous);
  if (restoredSelection !== null) {
    input.editor.setTextCursorPosition(
      restoredSelection.activeBlockId,
      restoredSelection.placement,
    );
  }

  return { targetedChanges, repairedProjection, restoredSelection };
}
