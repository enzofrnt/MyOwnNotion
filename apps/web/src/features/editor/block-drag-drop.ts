import { isUuid } from "@myownnotion/domain";
import type { EditorBlock, EditorBlocksChanged } from "./blocknote-schema.ts";

function depthFirstOrder(blocks: readonly EditorBlock[]): Map<string, number> {
  const order = new Map<string, number>();
  let position = 0;
  const visit = (entries: readonly EditorBlock[]): void => {
    for (const block of entries) {
      if (order.has(block.id)) throw new TypeError(`duplicate editor block id ${block.id}`);
      order.set(block.id, position);
      position += 1;
      visit(block.children as EditorBlock[]);
    }
  };
  visit(blocks);
  return order;
}

function descendantIds(block: EditorBlock): Set<string> {
  const result = new Set<string>();
  const visit = (children: readonly EditorBlock[]): void => {
    for (const child of children) {
      result.add(child.id);
      visit(child.children as EditorBlock[]);
    }
  };
  visit(block.children as EditorBlock[]);
  return result;
}

/** Returns a French refusal reason only when a completed BlockNote drop is structurally unsafe. */
export function validateBlockDrop(
  changes: EditorBlocksChanged,
  document: readonly EditorBlock[],
): string | null {
  const moves = changes.filter((change) => change.type === "move");
  if (moves.length === 0) return null;
  let order: Map<string, number>;
  try {
    order = depthFirstOrder(document);
  } catch {
    return "Ce déplacement créerait deux blocs avec la même identité.";
  }

  const seen = new Set<string>();
  for (const move of moves) {
    if (!isUuid(move.block.id) || seen.has(move.block.id) || !order.has(move.block.id)) {
      return "La destination a changé pendant le déplacement. Le document est resté intact.";
    }
    seen.add(move.block.id);
    const parentId = move.currentParent?.id;
    if (
      parentId === move.block.id ||
      (parentId !== undefined && descendantIds(move.block).has(parentId))
    ) {
      return "Un bloc ne peut pas être déplacé à l’intérieur de lui-même.";
    }
  }
  return null;
}

/** Stable reverse final order: every `beforeBlockId` exists before its dependent move is applied. */
export function stableMoveChanges(
  changes: EditorBlocksChanged,
  document: readonly EditorBlock[],
): Extract<EditorBlocksChanged[number], { type: "move" }>[] {
  const order = depthFirstOrder(document);
  return changes
    .filter(
      (change): change is Extract<EditorBlocksChanged[number], { type: "move" }> =>
        change.type === "move",
    )
    .sort((left, right) => (order.get(right.block.id) ?? -1) - (order.get(left.block.id) ?? -1));
}
