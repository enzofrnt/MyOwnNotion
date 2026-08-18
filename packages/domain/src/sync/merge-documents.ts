/**
 * Merging two documents that diverged (T024, US3, FR-013, FR-014).
 *
 * Pure and total, because this function decides what happens to an owner's
 * words. Everything about it is arranged so that being wrong is caught by a test
 * rather than by someone losing a paragraph.
 *
 * **The unit is the block**, which the document model makes possible: blocks
 * carry stable identities, so "the same block changed on both sides" is a fact
 * rather than a guess. Character-level merging would need operation history,
 * which the revision model deliberately does not keep.
 *
 * **What it refuses to decide is the interesting part.** Two obvious cases are
 * conflicts, and one is easy to get wrong:
 *
 *   - both sides edited the same block — obvious;
 *   - one side deleted a block and the other rewrote it — not obvious, and a
 *     naive merge picks a winner. Taking the deletion discards a rewrite; taking
 *     the rewrite resurrects something the owner removed. Both are intentions,
 *     and no rule can choose between them without being wrong half the time.
 */

import type { Block } from "../document/block.ts";
import type { BlockDocument } from "../document/document.ts";

export type MergeOutcome =
  /** Nothing changed on both sides: the result is safe to save unasked. */
  | { readonly kind: "merged"; readonly document: BlockDocument }
  /**
   * These blocks need the owner. The three states travel with the outcome so
   * the screen shows the same versions the decision was made against.
   */
  | {
      readonly kind: "needs-owner";
      readonly conflictedBlockIds: readonly string[];
      readonly ancestor: BlockDocument;
      readonly local: BlockDocument;
      readonly remote: BlockDocument;
    };

/** One block's fate on one side, relative to the common ancestor. */
type Change = "unchanged" | "edited" | "added" | "deleted";

export function mergeDocuments(
  ancestor: BlockDocument,
  local: BlockDocument,
  remote: BlockDocument,
): MergeOutcome {
  const ancestorBlocks = byId(ancestor);
  const localBlocks = byId(local);
  const remoteBlocks = byId(remote);

  const everyId = [
    ...new Set([...ancestorBlocks.keys(), ...localBlocks.keys(), ...remoteBlocks.keys()]),
  ];

  const conflicted: string[] = [];
  const resolved = new Map<string, Block | null>();

  for (const id of everyId) {
    const inAncestor = ancestorBlocks.get(id);
    const inLocal = localBlocks.get(id);
    const inRemote = remoteBlocks.get(id);

    const localChange = classify(inAncestor, inLocal);
    const remoteChange = classify(inAncestor, inRemote);

    if (localChange === "unchanged") {
      resolved.set(id, inRemote ?? null);
      continue;
    }
    if (remoteChange === "unchanged") {
      resolved.set(id, inLocal ?? null);
      continue;
    }

    // Both sides touched it. Identical outcomes are not a conflict — the owner
    // made the same change twice and does not need to be asked which they meant.
    if (sameBlock(inLocal, inRemote)) {
      resolved.set(id, inLocal ?? null);
      continue;
    }
    conflicted.push(id);
  }

  if (conflicted.length > 0) {
    return { kind: "needs-owner", conflictedBlockIds: conflicted, ancestor, local, remote };
  }

  return { kind: "merged", document: { blocks: assemble(local, remote, resolved) } };
}

/**
 * Puts the merged blocks back in an order the owner would recognise.
 *
 * Local order leads, because the device doing the merge is the one the owner is
 * looking at; blocks that exist only on the remote side are appended in their own
 * order rather than interleaved by guesswork. Interleaving would produce an
 * arrangement neither device had, which is the one outcome guaranteed to surprise
 * whoever is watching.
 */
function assemble(
  local: BlockDocument,
  remote: BlockDocument,
  resolved: ReadonlyMap<string, Block | null>,
): Block[] {
  const placed = new Set<string>();
  const blocks: Block[] = [];

  for (const block of local.blocks) {
    const outcome = resolved.get(block.id);
    placed.add(block.id);
    if (outcome != null) {
      blocks.push(outcome);
    }
  }
  for (const block of remote.blocks) {
    if (placed.has(block.id)) {
      continue;
    }
    const outcome = resolved.get(block.id);
    placed.add(block.id);
    if (outcome != null) {
      blocks.push(outcome);
    }
  }
  return blocks;
}

function byId(document: BlockDocument): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const block of document.blocks) {
    map.set(block.id, block);
  }
  return map;
}

function classify(inAncestor: Block | undefined, inSide: Block | undefined): Change {
  if (inAncestor === undefined) {
    return inSide === undefined ? "unchanged" : "added";
  }
  if (inSide === undefined) {
    return "deleted";
  }
  return sameBlock(inAncestor, inSide) ? "unchanged" : "edited";
}

/**
 * Whether two blocks are the same content.
 *
 * Compared by serialisation rather than field by field, so a block type added
 * later is compared correctly without this function being updated — and an
 * unknown block, whose shape this version does not understand, still compares
 * exactly.
 */
function sameBlock(left: Block | undefined, right: Block | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Applies the owner's per-block decisions to produce the resolved document.
 *
 * Separate from `mergeDocuments` because the merge answers "can this be done
 * without asking" and this answers "here is what they asked for". Keeping them
 * apart is what lets the first be exhaustively tested without simulating a
 * screen.
 */
export function applyResolution(input: {
  readonly outcome: Extract<MergeOutcome, { kind: "needs-owner" }>;
  /** Per conflicted block: whose version to keep, or both in that order. */
  readonly choices: ReadonlyMap<string, "local" | "remote" | "both">;
}): BlockDocument {
  const localBlocks = byId(input.outcome.local);
  const remoteBlocks = byId(input.outcome.remote);
  const conflicted = new Set(input.outcome.conflictedBlockIds);

  const blocks: Block[] = [];
  const placed = new Set<string>();

  const emit = (id: string): void => {
    if (placed.has(id)) {
      return;
    }
    placed.add(id);
    if (!conflicted.has(id)) {
      const block = localBlocks.get(id) ?? remoteBlocks.get(id);
      if (block !== undefined) {
        blocks.push(block);
      }
      return;
    }
    // An unanswered conflict keeps the local side rather than dropping the
    // block. Dropping it would destroy content the owner never chose to remove,
    // which is the one thing this whole path exists to prevent.
    const choice = input.choices.get(id) ?? "local";
    const localBlock = localBlocks.get(id);
    const remoteBlock = remoteBlocks.get(id);
    if (choice === "local" && localBlock !== undefined) {
      blocks.push(localBlock);
    } else if (choice === "remote" && remoteBlock !== undefined) {
      blocks.push(remoteBlock);
    } else if (choice === "both") {
      if (localBlock !== undefined) {
        blocks.push(localBlock);
      }
      if (remoteBlock !== undefined) {
        blocks.push(remoteBlock);
      }
    }
  };

  for (const block of input.outcome.local.blocks) {
    emit(block.id);
  }
  for (const block of input.outcome.remote.blocks) {
    emit(block.id);
  }
  return { blocks };
}
