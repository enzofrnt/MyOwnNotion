/**
 * Causal revision lineage (T081, US5).
 *
 * Ancestry is determined exclusively from parent edges. Timestamps are never
 * consulted, so skewed device clocks cannot corrupt classification, and
 * pruned snapshots do not affect results because headers and edges survive
 * pruning.
 */

import { type DomainResult, err, ok } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";
import type { LineageClassification, RevisionHeader } from "./types.ts";

/** Parent-edge lookup; must return an empty array for creation revisions. */
export type ParentLookup = (revisionId: Uuid) => ReadonlyArray<Uuid>;

/**
 * Walks ancestors of `startId` (exclusive) iteratively, returning true when
 * `targetId` is reached. A visited set guarantees termination on any graph.
 */
function isAncestor(targetId: Uuid, startId: Uuid, getParents: ParentLookup): boolean {
  const visited = new Set<string>();
  const queue: Uuid[] = [...getParents(startId)];
  while (queue.length > 0) {
    const current = queue.shift() as Uuid;
    if (current === targetId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const parent of getParents(current)) {
      queue.push(parent);
    }
  }
  return false;
}

export function classifyLineage(
  leftId: Uuid,
  rightId: Uuid,
  getParents: ParentLookup,
): LineageClassification {
  if (leftId === rightId) {
    return "identical";
  }
  if (isAncestor(leftId, rightId, getParents)) {
    return "left-ancestor";
  }
  if (isAncestor(rightId, leftId, getParents)) {
    return "right-ancestor";
  }
  return "concurrent";
}

/**
 * Finds the nearest common ancestors of two revisions (may be empty for
 * disjoint creation lineages, or contain several heads after merges).
 */
export function commonAncestors(leftId: Uuid, rightId: Uuid, getParents: ParentLookup): Uuid[] {
  const ancestorsOf = (startId: Uuid): Set<string> => {
    const seen = new Set<string>([startId]);
    const queue = [...getParents(startId)];
    while (queue.length > 0) {
      const current = queue.shift() as Uuid;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      queue.push(...getParents(current));
    }
    return seen;
  };
  const leftAncestors = ancestorsOf(leftId);
  const rightAncestors = ancestorsOf(rightId);
  const shared = [...leftAncestors].filter((id) => rightAncestors.has(id)) as Uuid[];
  // Keep only maximal elements (no shared ancestor that is an ancestor of another).
  return shared.filter(
    (candidate) =>
      !shared.some(
        (other) => other !== candidate && isAncestor(candidate as Uuid, other as Uuid, getParents),
      ),
  );
}

export interface NewRevisionInput {
  readonly id: Uuid;
  readonly itemId: Uuid;
  readonly mutationId: Uuid;
  readonly parentRevisionIds: ReadonlyArray<Uuid>;
}

/**
 * Validates an immutable revision header before persistence: parents must
 * exist, belong to the same item, and not duplicate; creation revisions have
 * no parents.
 */
export function validateNewRevision(
  input: NewRevisionInput,
  getHeader: (revisionId: Uuid) => RevisionHeader | null,
): DomainResult<NewRevisionInput> {
  if (getHeader(input.id) !== null) {
    return err("mutation.duplicate", "Revision identity already exists");
  }
  const seen = new Set<string>();
  for (const parentId of input.parentRevisionIds) {
    if (seen.has(parentId)) {
      return err("validation.invalid-payload", "Duplicate parent revision");
    }
    seen.add(parentId);
    const parent = getHeader(parentId);
    if (parent === null) {
      return err("revision.not-found", "Parent revision does not exist");
    }
    if (parent.itemId !== input.itemId) {
      return err("validation.invalid-payload", "Parent revision belongs to a different item");
    }
  }
  return ok(input);
}

/**
 * Computes a deterministic lineage digest over the owned header fields so
 * export and repair tooling can verify headers independently of snapshots.
 * (SHA-256 of the canonical header string, computed by adapters; this
 * function returns the canonical string to digest.)
 */
export function canonicalLineageString(input: NewRevisionInput): string {
  const parents = [...input.parentRevisionIds].sort().join(",");
  return `revision:${input.id};item:${input.itemId};mutation:${input.mutationId};parents:${parents}`;
}
