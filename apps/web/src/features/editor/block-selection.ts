import type { PartialBlock } from "@blocknote/core";
import { generateUuidV7 } from "@myownnotion/domain";
import type { EditorBlock, EditorInstance, EditorPartialBlock } from "./blocknote-schema.ts";

export class BlockSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockSelectionError";
  }
}

export interface ContiguousBlockSelection {
  readonly blocks: readonly EditorBlock[];
  readonly parentId: string | null;
  readonly siblings: readonly EditorBlock[];
  readonly startIndex: number;
  readonly endIndex: number;
}

function selectedBlocks(editor: EditorInstance): EditorBlock[] {
  const selection = editor.getSelection();
  if (selection !== undefined && selection.blocks.length > 0) {
    return selection.blocks as EditorBlock[];
  }
  return [editor.getTextCursorPosition().block as EditorBlock];
}

function rootSelectedBlocks(editor: EditorInstance, blocks: readonly EditorBlock[]): EditorBlock[] {
  const selectedIds = new Set(blocks.map((block) => block.id));
  return blocks.filter((block) => {
    let parent = editor.getParentBlock(block.id) as EditorBlock | undefined;
    while (parent !== undefined) {
      if (selectedIds.has(parent.id)) return false;
      parent = editor.getParentBlock(parent.id) as EditorBlock | undefined;
    }
    return true;
  });
}

/** Resolves a selection to sibling roots so every group action has one unambiguous placement. */
export function resolveContiguousBlockSelection(editor: EditorInstance): ContiguousBlockSelection {
  const blocks = rootSelectedBlocks(editor, selectedBlocks(editor));
  if (blocks.length === 0) {
    throw new BlockSelectionError("Aucun bloc n’est sélectionné.");
  }

  const parents = blocks.map(
    (block) => (editor.getParentBlock(block.id) as EditorBlock | undefined)?.id ?? null,
  );
  const parentId = parents[0] ?? null;
  if (parents.some((candidate) => candidate !== parentId)) {
    throw new BlockSelectionError(
      "Cette action demande une sélection de blocs voisins au même niveau.",
    );
  }

  const parent =
    parentId === null ? undefined : (editor.getBlock(parentId) as EditorBlock | undefined);
  const siblings = (parent?.children ?? editor.document) as EditorBlock[];
  const selectedIds = new Set(blocks.map((block) => block.id));
  const ordered = siblings.filter((block) => selectedIds.has(block.id));
  if (ordered.length !== blocks.length) {
    throw new BlockSelectionError("La sélection contient un bloc qui n’est plus disponible.");
  }

  const startIndex = siblings.findIndex((block) => block.id === ordered[0]?.id);
  const endIndex = siblings.findIndex((block) => block.id === ordered.at(-1)?.id);
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex - startIndex + 1 !== ordered.length ||
    siblings.slice(startIndex, endIndex + 1).some((block) => !selectedIds.has(block.id))
  ) {
    throw new BlockSelectionError("Sélectionnez des blocs contigus pour cette action.");
  }

  return { blocks: ordered, parentId, siblings, startIndex, endIndex };
}

function cloneBlockWithFreshIds(block: EditorBlock): EditorPartialBlock {
  const clone: Record<string, unknown> = {
    id: generateUuidV7(),
    type: block.type,
    props: structuredClone(block.props),
    children: (block.children as EditorBlock[]).map(cloneBlockWithFreshIds),
  };
  if (block.content !== undefined) clone["content"] = structuredClone(block.content);
  return clone as unknown as EditorPartialBlock;
}

function focusBlock(editor: EditorInstance, blockId: string): void {
  try {
    editor.setTextCursorPosition(blockId, "start");
  } catch {
    editor.setSelection(blockId, blockId);
  }
}

export function selectBlockForAction(editor: EditorInstance, blockId: string): void {
  const current = editor.getSelection()?.blocks ?? [];
  if (current.some((block) => block.id === blockId)) return;
  focusBlock(editor, blockId);
}

/** Duplicates a whole sibling group in one BlockNote transaction and gives every copy a fresh UUID. */
export function duplicateSelectedBlocks(editor: EditorInstance): readonly string[] {
  const selection = resolveContiguousBlockSelection(editor);
  const copies = selection.blocks.map(cloneBlockWithFreshIds);
  const referenceId = selection.blocks.at(-1)?.id;
  if (referenceId === undefined) throw new BlockSelectionError("Aucun bloc à dupliquer.");
  editor.transact(() => {
    editor.insertBlocks(copies as unknown as PartialBlock[], referenceId, "after");
  });
  const ids = copies.map((block) => block.id).filter((id): id is string => id !== undefined);
  const firstId = ids[0];
  const lastId = ids.at(-1);
  if (firstId !== undefined && lastId !== undefined) {
    if (firstId === lastId) focusBlock(editor, firstId);
    else editor.setSelection(firstId, lastId);
  }
  return ids;
}

/** Deletes a sibling group atomically while ensuring the editor never becomes structurally empty. */
export function deleteSelectedBlocks(editor: EditorInstance): void {
  const selection = resolveContiguousBlockSelection(editor);
  const selectedIds = selection.blocks.map((block) => block.id);
  const fallbackNeeded = selectedIds.length === selection.siblings.length;
  const fallbackId = fallbackNeeded ? generateUuidV7() : null;
  const referenceId = selection.blocks.at(-1)?.id;
  if (referenceId === undefined) throw new BlockSelectionError("Aucun bloc à supprimer.");

  editor.transact(() => {
    if (fallbackId !== null) {
      editor.insertBlocks([{ id: fallbackId, type: "paragraph" }], referenceId, "after");
    }
    editor.removeBlocks(selectedIds);
  });

  if (fallbackId !== null) {
    focusBlock(editor, fallbackId);
    return;
  }
  const neighbour =
    selection.siblings[selection.endIndex + 1] ?? selection.siblings[selection.startIndex - 1];
  if (neighbour !== undefined) focusBlock(editor, neighbour.id);
}

export function insertParagraphAfterSelection(editor: EditorInstance): string {
  const selection = resolveContiguousBlockSelection(editor);
  const referenceId = selection.blocks.at(-1)?.id;
  if (referenceId === undefined)
    throw new BlockSelectionError("Aucun point d’insertion disponible.");
  const id = generateUuidV7();
  editor.transact(() => {
    editor.insertBlocks([{ id, type: "paragraph" }], referenceId, "after");
  });
  focusBlock(editor, id);
  return id;
}

export type BlockTransform =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "numbered-list"
  | "check-list"
  | "quote"
  | "code";

function transformUpdate(transform: BlockTransform): EditorPartialBlock {
  switch (transform) {
    case "paragraph":
      return { type: "paragraph" };
    case "heading-1":
      return { type: "heading", props: { level: 1 } };
    case "heading-2":
      return { type: "heading", props: { level: 2 } };
    case "heading-3":
      return { type: "heading", props: { level: 3 } };
    case "bullet-list":
      return { type: "bulletListItem" };
    case "numbered-list":
      return { type: "numberedListItem" };
    case "check-list":
      return { type: "checkListItem" };
    case "quote":
      return { type: "quote" };
    case "code":
      return { type: "codeBlock" };
  }
}

export function transformSelectedBlocks(editor: EditorInstance, transform: BlockTransform): void {
  const selection = resolveContiguousBlockSelection(editor);
  if (selection.blocks.some((block) => block.type === "unknown")) {
    throw new BlockSelectionError(
      "Un bloc non pris en charge ne peut pas être transformé sans risquer de perdre son contenu.",
    );
  }
  const update = transformUpdate(transform);
  editor.transact(() => {
    for (const block of selection.blocks) {
      editor.updateBlock(block.id, update as unknown as PartialBlock);
    }
  });
}

export function moveSelectedBlocks(editor: EditorInstance, direction: "up" | "down"): boolean {
  const selection = resolveContiguousBlockSelection(editor);
  const canMove =
    direction === "up"
      ? selection.startIndex > 0 || selection.parentId !== null
      : selection.endIndex < selection.siblings.length - 1 || selection.parentId !== null;
  if (!canMove) return false;
  const first = selection.blocks[0];
  const last = selection.blocks.at(-1);
  if (first === undefined || last === undefined) return false;
  if (first.id === last.id) focusBlock(editor, first.id);
  else editor.setSelection(first.id, last.id);
  editor.transact(() => {
    if (direction === "up") editor.moveBlocksUp();
    else editor.moveBlocksDown();
  });
  return true;
}
