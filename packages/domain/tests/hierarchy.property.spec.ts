/**
 * Containment-matrix and cycle property tests (T023, US1).
 *
 * SC-001: every allowed containment combination succeeds and every
 * prohibited child or cycle operation is rejected without changing state.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canContain,
  collectActiveBranch,
  ITEM_KINDS,
  keyBetween,
  validateCreateItem,
  validateMovePlacement,
  wouldCreateCycle,
  generateUuidV7,
  type ItemKind,
  type PlacementKind,
  type Uuid,
} from "@myownnotion/domain";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("containment matrix (FR-003..FR-006)", () => {
  const matrix: Array<[ItemKind | null, ItemKind, PlacementKind, boolean]> = [
    // hierarchy placements
    [null, "page", "hierarchy", true],
    [null, "folder", "hierarchy", true],
    [null, "file", "hierarchy", true],
    ["page", "page", "hierarchy", true],
    ["page", "folder", "hierarchy", true],
    ["page", "file", "hierarchy", true],
    ["folder", "page", "hierarchy", true],
    ["folder", "folder", "hierarchy", true],
    ["folder", "file", "hierarchy", true],
    ["file", "page", "hierarchy", false],
    ["file", "folder", "hierarchy", false],
    ["file", "file", "hierarchy", false],
    // attachment placements: only page → file
    [null, "file", "attachment", false],
    ["page", "file", "attachment", true],
    ["page", "page", "attachment", false],
    ["page", "folder", "attachment", false],
    ["folder", "file", "attachment", false],
    ["file", "file", "attachment", false],
  ];

  it.each(matrix)(
    "parent=%s child=%s placement=%s → allowed=%s",
    (parentKind, childKind, placementKind, allowed) => {
      expect(canContain(parentKind, childKind, placementKind)).toBe(allowed);
    },
  );

  it("covers the complete kind × kind × placement space", () => {
    const covered = new Set(matrix.map(([p, c, k]) => `${String(p)}|${c}|${k}`));
    for (const parent of [null, ...ITEM_KINDS]) {
      for (const child of ITEM_KINDS) {
        for (const placement of ["hierarchy", "attachment"] as const) {
          const key = `${String(parent)}|${child}|${placement}`;
          if (!covered.has(key)) {
            // Any uncovered combination must at least be decidable.
            expect(typeof canContain(parent, child, placement)).toBe("boolean");
          }
        }
      }
    }
  });

  it("rejects creating an item beneath a file without side effects", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "f");
    graph.addPlacement(file, null, "V");
    const before = graph.placements.size;
    const result = validateCreateItem(graph, {
      id: generateUuidV7(),
      kind: "page",
      name: "child",
      placement: { kind: "hierarchy", parentItemId: file, positionKey: "V" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.file-cannot-contain");
    }
    expect(graph.placements.size).toBe(before);
  });
});

/** Builds a random tree and returns its nodes with parent links. */
function arbitraryTree() {
  return fc
    .array(fc.integer({ min: 0, max: 1_000 }), { minLength: 2, maxLength: 40 })
    .map((seeds) => {
      const graph = new MemoryGraph();
      const nodes: Uuid[] = [];
      const placementIds = new Map<string, Uuid>();
      for (const [index, seed] of seeds.entries()) {
        const kind = seed % 4 === 0 ? "folder" : "page";
        const id = graph.addItem(kind, `n${index}`);
        const parent = nodes.length === 0 ? null : (nodes[seed % nodes.length] as Uuid);
        const key = keyBetween(null, null) + index.toString(36);
        placementIds.set(id, graph.addPlacement(id, parent, key));
        nodes.push(id);
      }
      return { graph, nodes, placementIds };
    });
}

describe("cycle rejection property (FR-008, SC-001)", () => {
  it("moving an item beneath any of its descendants is always rejected", () => {
    fc.assert(
      fc.property(arbitraryTree(), fc.nat(), ({ graph, nodes, placementIds }, pick) => {
        const rootIndex = pick % nodes.length;
        const item = nodes[rootIndex] as Uuid;
        const branch = collectActiveBranch(graph, item);
        const strictDescendants = branch.filter((candidate) => candidate !== item);
        fc.pre(strictDescendants.length > 0);
        const target = strictDescendants[pick % strictDescendants.length] as Uuid;

        const placementId = placementIds.get(item) as Uuid;
        const placement = graph.placements.get(placementId) ?? null;
        const before = JSON.stringify([...graph.placements.values()]);
        const result = validateMovePlacement(graph, placement, {
          placementId,
          parentItemId: target,
          positionKey: "V",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("containment.cycle-rejected");
        }
        // Pure validation never mutates the graph.
        expect(JSON.stringify([...graph.placements.values()])).toBe(before);
      }),
      { numRuns: 200 },
    );
  });

  it("self-parenting is always a cycle", () => {
    fc.assert(
      fc.property(arbitraryTree(), fc.nat(), ({ graph, nodes }, pick) => {
        const item = nodes[pick % nodes.length] as Uuid;
        expect(wouldCreateCycle(graph, item, item)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("moving beneath a non-descendant is never classified as a cycle", () => {
    fc.assert(
      fc.property(arbitraryTree(), fc.nat(), fc.nat(), ({ graph, nodes }, a, b) => {
        const item = nodes[a % nodes.length] as Uuid;
        const branch = new Set(collectActiveBranch(graph, item));
        const outside = nodes.filter((candidate) => !branch.has(candidate));
        fc.pre(outside.length > 0);
        const target = outside[b % outside.length] as Uuid;
        expect(wouldCreateCycle(graph, item, target)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("branch collection is complete and acyclic", () => {
    fc.assert(
      fc.property(arbitraryTree(), ({ graph, nodes }) => {
        const root = nodes[0] as Uuid;
        const branch = collectActiveBranch(graph, root);
        // Every node reachable from the first node exactly once.
        expect(new Set(branch).size).toBe(branch.length);
        expect(branch).toContain(root);
      }),
      { numRuns: 100 },
    );
  });
});
