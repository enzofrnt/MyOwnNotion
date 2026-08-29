import type { PartialBlock } from "@blocknote/core";
import { canonicalDocumentJsonV3, type Uuid } from "@myownnotion/domain";
import { blockNoteDocumentToCanonical } from "./blocknote-conversion.ts";
import type { EditorBlock, EditorInstance } from "./blocknote-schema.ts";
import { captureScrollAnchor, restoreScrollAnchor } from "./editor-view-state.ts";

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

/**
 * Projects an adopted remote frontier before the next browser gesture can use
 * the stale visible tree as its editing baseline.
 *
 * A projection is delayed only while a local gesture still owns visible
 * offsets or while one of its commits is crossing the durable boundary. When
 * both are idle, applying synchronously closes the gap between the operational
 * replica adopting a remote update and BlockNote displaying that update.
 */
export function applyRemoteProjectionIfEditorIdle(input: {
  readonly localInputActive: boolean;
  readonly localCommitsInFlight: number;
  readonly apply: () => void;
}): boolean {
  if (input.localInputActive || input.localCommitsInFlight > 0) return false;
  input.apply();
  return true;
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

function childBlocks(block: EditorBlock): readonly EditorBlock[] {
  return Array.isArray(block.children) ? (block.children as EditorBlock[]) : [];
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
      visit(childBlocks(block), block.id as Uuid);
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
      visit(childBlocks(block));
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
): boolean {
  const partial = structuredClone(block) as unknown as PartialBlock;
  if (beforeBlockId !== null && editor.getBlock(beforeBlockId) !== undefined) {
    editor.insertBlocks([partial], beforeBlockId, "before");
    return false;
  }

  if (parentBlockId !== null) {
    const parent = editor.getBlock(parentBlockId) as EditorBlock | undefined;
    if (parent === undefined) throw new Error(`remote parent ${parentBlockId} is unavailable`);
    const lastChild = childBlocks(parent).at(-1);
    if (lastChild !== undefined) {
      editor.insertBlocks([partial], lastChild.id, "after");
      return false;
    }

    // BlockNote has no public "insert as first child" primitive. Insert next
    // to the empty parent, then use its ordinary nesting command in the same
    // transaction; the stable UUID and the whole subtree are preserved.
    editor.insertBlocks([partial], parentBlockId, "after");
    editor.setTextCursorPosition(block.id, "start");
    editor.nestBlock();
    return true;
  }

  const lastRoot = (editor.document as EditorBlock[]).at(-1);
  if (lastRoot === undefined) throw new Error("the visible document has no insertion anchor");
  editor.insertBlocks([partial], lastRoot.id, "after");
  return false;
}

function applyTargetedChanges(
  editor: EditorInstance,
  changes: readonly RemoteEditorChange[],
): boolean {
  let commandMovedCursor = false;
  editor.transact(() => {
    for (const change of changes) {
      switch (change.type) {
        case "delete":
          if (editor.getBlock(change.blockId) !== undefined) editor.removeBlocks([change.blockId]);
          break;
        case "insert":
          commandMovedCursor =
            insertAtPlacement(editor, change.block, change.parentBlockId, change.beforeBlockId) ||
            commandMovedCursor;
          break;
        case "move": {
          const block = editor.getBlock(change.blockId) as EditorBlock | undefined;
          if (block === undefined) throw new Error(`remote block ${change.blockId} is unavailable`);
          editor.removeBlocks([change.blockId]);
          commandMovedCursor =
            insertAtPlacement(editor, block, change.parentBlockId, change.beforeBlockId) ||
            commandMovedCursor;
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
  return commandMovedCursor;
}

interface EditorInteractionSnapshot {
  readonly focused: boolean;
  readonly root: HTMLDivElement | undefined;
  readonly scrollAnchor: ReturnType<typeof captureScrollAnchor>;
}

function captureEditorInteraction(editor: EditorInstance): EditorInteractionSnapshot {
  const root = editor.domElement;
  if (root === undefined) {
    // BlockNote's headless mode is used by unit tests and import tools. There
    // is no browser focus to preserve, so retain the historical cursor-safe
    // behaviour without touching DOM globals.
    return { focused: true, root, scrollAnchor: null };
  }
  let focused = false;
  try {
    focused = editor.isFocused();
  } catch {
    focused = false;
  }
  const scrollAnchor =
    typeof document === "undefined" || typeof window === "undefined"
      ? null
      : captureScrollAnchor(root);
  return { focused, root, scrollAnchor };
}

function restoreEditorInteraction(
  editor: EditorInstance,
  snapshot: EditorInteractionSnapshot,
): void {
  if (snapshot.focused && snapshot.root !== undefined) {
    let stillFocused = false;
    try {
      stillFocused = editor.isFocused();
    } catch {
      stillFocused = false;
    }
    if (!stillFocused && snapshot.root.isConnected) editor.focus();
  }
  if (snapshot.scrollAnchor !== null && snapshot.root?.isConnected === true) {
    // Restoring after cursor/focus avoids their browser scroll side effects.
    // A block anchor, unlike a raw pixel, also survives inserts above the fold.
    restoreScrollAnchor(snapshot.scrollAnchor, snapshot.root);
  }
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

  // A canonically identical projection must not touch the surface at all. The
  // editor may carry transient/default props or a different inline-node
  // segmentation that the durable document intentionally ignores. Treating
  // those representation details as a remote edit can move focus in the
  // middle of typing even though no user-authored content changed.
  if (visibleProjection(previous) === visibleProjection(input.next)) {
    return { targetedChanges: [], repairedProjection: false, restoredSelection: null };
  }

  const interaction = captureEditorInteraction(input.editor);
  let selection: StableEditorSelection | null = null;
  if (interaction.focused) {
    try {
      selection = {
        activeBlockId: input.editor.getTextCursorPosition().block.id as Uuid,
        placement: "end",
      };
    } catch {
      selection = null;
    }
  }

  const targetedChanges = planRemoteEditorChanges(previous, input.next);
  let repairedProjection = false;
  let commandMovedCursor = false;
  try {
    commandMovedCursor = input.origin.run("remote", () =>
      applyTargetedChanges(input.editor, targetedChanges),
    );
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

  const stableSelection =
    selection === null
      ? null
      : restoreStableSelection(selection, input.editor.document as EditorBlock[], previous);
  const selectedBlockWasRecreated =
    selection !== null &&
    targetedChanges.some(
      (change) =>
        (change.type === "delete" || change.type === "move") &&
        change.blockId === selection.activeBlockId,
    );
  const needsExplicitSelectionRestore =
    repairedProjection || commandMovedCursor || selectedBlockWasRecreated;
  const restoredSelection = needsExplicitSelectionRestore ? stableSelection : null;
  if (restoredSelection !== null) {
    input.editor.setTextCursorPosition(
      restoredSelection.activeBlockId,
      restoredSelection.placement,
    );
  }
  restoreEditorInteraction(input.editor, interaction);

  return { targetedChanges, repairedProjection, restoredSelection };
}
