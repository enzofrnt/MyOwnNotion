/**
 * Exhaustive ancestry/concurrency graph tests (T077, US5, SC-004):
 * classification uses parent edges only — deliberately skewed timestamps
 * must never change results, and pruned snapshots never affect headers.
 */

import {
  canPruneSnapshot,
  classifyLineage,
  commonAncestors,
  generateUuidV7,
  type RevisionHeader,
  type RevisionWithSnapshot,
  snapshotExpiry,
  type Uuid,
  validateNewRevision,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/** Builds a random DAG of revisions for one item. */
function arbitraryLineage() {
  return fc
    .array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { minLength: 2, maxLength: 60 })
    .map((seeds) => {
      const itemId = generateUuidV7();
      const parents = new Map<string, Uuid[]>();
      const order: Uuid[] = [];
      const root = generateUuidV7();
      parents.set(root, []);
      order.push(root);
      for (const [a, b, merge] of seeds) {
        const id = generateUuidV7();
        const parentA = order[a % order.length] as Uuid;
        if (merge && order.length > 1) {
          const parentB = order[b % order.length] as Uuid;
          parents.set(id, parentB === parentA ? [parentA] : [parentA, parentB]);
        } else {
          parents.set(id, [parentA]);
        }
        order.push(id);
      }
      return {
        itemId,
        order,
        getParents: (id: Uuid) => parents.get(id) ?? [],
      };
    });
}

function isAncestorOf(target: Uuid, start: Uuid, getParents: (id: Uuid) => Uuid[]): boolean {
  const queue = [...getParents(start)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as Uuid;
    if (current === target) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    queue.push(...getParents(current));
  }
  return false;
}

describe("lineage classification (SC-004)", () => {
  it("classifies every pair consistently with reachability", () => {
    fc.assert(
      fc.property(arbitraryLineage(), fc.nat(), fc.nat(), (lineage, a, b) => {
        const left = lineage.order[a % lineage.order.length] as Uuid;
        const right = lineage.order[b % lineage.order.length] as Uuid;
        const classification = classifyLineage(left, right, lineage.getParents);
        const leftIsAncestor = isAncestorOf(left, right, lineage.getParents);
        const rightIsAncestor = isAncestorOf(right, left, lineage.getParents);
        if (left === right) {
          expect(classification).toBe("identical");
        } else if (leftIsAncestor) {
          expect(classification).toBe("left-ancestor");
        } else if (rightIsAncestor) {
          expect(classification).toBe("right-ancestor");
        } else {
          expect(classification).toBe("concurrent");
        }
      }),
      { numRuns: 300 },
    );
  });

  it("sequential chains classify as ancestor/descendant", () => {
    const parents = new Map<string, Uuid[]>();
    const chain: Uuid[] = [];
    for (let index = 0; index < 50; index += 1) {
      const id = generateUuidV7();
      parents.set(id, index === 0 ? [] : [chain[index - 1] as Uuid]);
      chain.push(id);
    }
    const getParents = (id: Uuid) => parents.get(id) ?? [];
    expect(classifyLineage(chain[0] as Uuid, chain[49] as Uuid, getParents)).toBe("left-ancestor");
    expect(classifyLineage(chain[49] as Uuid, chain[0] as Uuid, getParents)).toBe("right-ancestor");
    // A device that is simply behind is "behind", not conflicting (FR spec US5-2).
    expect(classifyLineage(chain[30] as Uuid, chain[49] as Uuid, getParents)).toBe("left-ancestor");
  });

  it("two branches from one parent are concurrent and share the ancestor", () => {
    const root = generateUuidV7();
    const left = generateUuidV7();
    const right = generateUuidV7();
    const parents = new Map<string, Uuid[]>([
      [root, []],
      [left, [root]],
      [right, [root]],
    ]);
    const getParents = (id: Uuid) => parents.get(id) ?? [];
    expect(classifyLineage(left, right, getParents)).toBe("concurrent");
    expect(commonAncestors(left, right, getParents)).toEqual([root]);
  });

  it("timestamps are irrelevant: classification never reads clocks (SC-004)", () => {
    // The API takes no timestamps at all — construct revisions whose
    // "acceptedAt" order contradicts causality and verify classification
    // still follows parent edges.
    const older = generateUuidV7();
    const newer = generateUuidV7();
    const parents = new Map<string, Uuid[]>([
      [older, [newer]], // "older" wall-clock id is causally the child
      [newer, []],
    ]);
    const getParents = (id: Uuid) => parents.get(id) ?? [];
    expect(classifyLineage(newer, older, getParents)).toBe("left-ancestor");
  });
});

describe("revision header validation (T081)", () => {
  const itemId = generateUuidV7();
  const existing: RevisionHeader = {
    id: generateUuidV7(),
    itemId,
    mutationId: generateUuidV7(),
    parentRevisionIds: [],
    acceptedAt: new Date().toISOString(),
  };
  const lookup = (id: Uuid) => (id === existing.id ? existing : null);

  it("accepts a creation revision without parents", () => {
    const result = validateNewRevision(
      { id: generateUuidV7(), itemId, mutationId: generateUuidV7(), parentRevisionIds: [] },
      lookup,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unknown or cross-item parents and duplicate identities", () => {
    const unknownParent = validateNewRevision(
      {
        id: generateUuidV7(),
        itemId,
        mutationId: generateUuidV7(),
        parentRevisionIds: [generateUuidV7()],
      },
      lookup,
    );
    expect(unknownParent.ok).toBe(false);

    const crossItem = validateNewRevision(
      {
        id: generateUuidV7(),
        itemId: generateUuidV7(),
        mutationId: generateUuidV7(),
        parentRevisionIds: [existing.id],
      },
      lookup,
    );
    expect(crossItem.ok).toBe(false);

    const duplicate = validateNewRevision(
      {
        id: existing.id,
        itemId,
        mutationId: generateUuidV7(),
        parentRevisionIds: [],
      },
      lookup,
    );
    expect(duplicate.ok).toBe(false);
  });
});

describe("snapshot retention rules (T083, FR-026/FR-027)", () => {
  const revision = (
    snapshot: Record<string, unknown> | null,
    expiresAt: string | null,
  ): RevisionWithSnapshot => ({
    id: generateUuidV7(),
    itemId: generateUuidV7(),
    mutationId: generateUuidV7(),
    parentRevisionIds: [],
    acceptedAt: new Date("2026-08-07T00:00:00Z").toISOString(),
    snapshot,
    snapshotExpiresAt: expiresAt,
  });

  const context = {
    isCurrentHead: false,
    isConflictProtected: false,
    isRetentionProtected: false,
  };

  it("supersession starts a 24-hour clock", () => {
    const at = new Date("2026-08-07T00:00:00Z");
    expect(snapshotExpiry(at).toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("prunes only expired, unprotected, superseded snapshots", () => {
    const now = () => new Date("2026-08-09T00:00:00Z");
    expect(canPruneSnapshot(revision({ a: 1 }, "2026-08-08T00:00:00Z"), context, now)).toBe(true);
    // Still inside the window.
    expect(canPruneSnapshot(revision({ a: 1 }, "2026-08-10T00:00:00Z"), context, now)).toBe(false);
    // Current head never prunes.
    expect(
      canPruneSnapshot(
        revision({ a: 1 }, "2026-08-08T00:00:00Z"),
        { ...context, isCurrentHead: true },
        now,
      ),
    ).toBe(false);
    // Unresolved conflicts keep complete content beyond 24 hours (FR-016).
    expect(
      canPruneSnapshot(
        revision({ a: 1 }, "2026-08-08T00:00:00Z"),
        { ...context, isConflictProtected: true },
        now,
      ),
    ).toBe(false);
    // Trash/backup retention protection.
    expect(
      canPruneSnapshot(
        revision({ a: 1 }, "2026-08-08T00:00:00Z"),
        { ...context, isRetentionProtected: true },
        now,
      ),
    ).toBe(false);
    // Never-superseded snapshots have no expiry.
    expect(canPruneSnapshot(revision({ a: 1 }, null), context, now)).toBe(false);
    // Already pruned.
    expect(canPruneSnapshot(revision(null, "2026-08-08T00:00:00Z"), context, now)).toBe(false);
  });
});
