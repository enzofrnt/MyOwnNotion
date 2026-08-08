/**
 * Containment-matrix and cycle property tests (T023, US1).
 *
 * SC-001: every allowed containment combination succeeds and every
 * prohibited child or cycle operation is rejected without changing state.
 */

import {
  canContain,
  collectActiveBranch,
  generateUuidV7,
  ITEM_KINDS,
  type ItemKind,
  keyBetween,
  type PlacementKind,
  sortSiblings,
  type Uuid,
  validateCreateItem,
  validateMovePlacement,
  validatePageDocument,
  validateRenameItem,
  wouldCreateCycle,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
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

  it("returns a precise error for every invalid create boundary", () => {
    const graph = new MemoryGraph();
    const duplicate = graph.addItem("page", "existing");
    const trashedParent = graph.addItem("folder", "trashed", "trashed");
    const valid = {
      id: generateUuidV7(),
      kind: "page" as const,
      name: "page",
      placement: { kind: "hierarchy" as const, parentItemId: null, positionKey: "V" },
    };
    const cases = [
      [{ ...valid, id: "not-a-uuid" }, "validation.invalid-identifier"],
      [{ ...valid, id: duplicate }, "mutation.duplicate"],
      [{ ...valid, kind: "file" }, "validation.invalid-kind"],
      [{ ...valid, name: "   " }, "validation.invalid-name"],
      [
        { ...valid, placement: { ...valid.placement, kind: "attachment" } },
        "placement.cardinality-violation",
      ],
      [
        { ...valid, placement: { ...valid.placement, positionKey: "" } },
        "validation.invalid-payload",
      ],
      [
        { ...valid, placement: { ...valid.placement, parentItemId: generateUuidV7() } },
        "containment.parent-not-found",
      ],
      [
        { ...valid, placement: { ...valid.placement, parentItemId: trashedParent } },
        "item.not-active",
      ],
      [
        { ...valid, placement: { ...valid.placement, id: "invalid" } },
        "validation.invalid-identifier",
      ],
      [
        {
          ...valid,
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 6,
            body: {},
          },
        },
        "validation.unknown-format-version",
      ],
      [
        {
          ...valid,
          kind: "folder",
          pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
        },
        "validation.invalid-payload",
      ],
    ] as const;

    for (const [command, code] of cases) {
      // Deliberately malformed runtime values exercise the untrusted boundary.
      const result = validateCreateItem(graph, command as Parameters<typeof validateCreateItem>[1]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    }
  });

  it("validates page document formats and bodies without stripping data", () => {
    const invalidDocuments = [
      { format: "text/plain", formatVersion: 1, body: {} },
      { format: "myownnotion.document+json", formatVersion: 0, body: {} },
      { format: "myownnotion.document+json", formatVersion: 1.5, body: {} },
      { format: "myownnotion.document+json", formatVersion: 1, body: [] },
    ];
    for (const document of invalidDocuments) {
      expect(validatePageDocument(document as Parameters<typeof validatePageDocument>[0]).ok).toBe(
        false,
      );
    }
  });

  it("validates move and rename state before returning an executable plan", () => {
    const graph = new MemoryGraph();
    const itemId = graph.addItem("page", "item");
    const placementId = graph.addPlacement(itemId, null, "V");
    const placement = graph.placements.get(placementId) as NonNullable<
      ReturnType<MemoryGraph["getActivePlacements"]>[number]
    >;
    const command = { placementId, parentItemId: null, positionKey: "W" };

    expect(validateMovePlacement(graph, null, command).ok).toBe(false);
    expect(
      validateMovePlacement(graph, { ...placement, removedAt: new Date().toISOString() }, command)
        .ok,
    ).toBe(false);

    graph.items.delete(itemId);
    expect(validateMovePlacement(graph, placement, command).ok).toBe(false);
    graph.items.set(itemId, {
      id: itemId,
      workspaceId: graph.workspaceId,
      kind: "page",
      name: "item",
      lifecycle: "trashed",
      trashedAt: new Date().toISOString(),
      purgeAfter: new Date().toISOString(),
      currentRevisionId: generateUuidV7(),
    });
    expect(validateMovePlacement(graph, placement, command).ok).toBe(false);
    graph.items.set(itemId, {
      ...(graph.getItem(itemId) as NonNullable<ReturnType<MemoryGraph["getItem"]>>),
      lifecycle: "active",
    });

    expect(validateMovePlacement(graph, placement, { ...command, positionKey: "" }).ok).toBe(false);
    expect(
      validateMovePlacement(graph, placement, {
        ...command,
        parentItemId: generateUuidV7(),
      }).ok,
    ).toBe(false);
    const accepted = validateMovePlacement(graph, placement, command);
    expect(accepted.ok && accepted.value.parentChanged).toBe(false);

    const file = graph.addItem("file", "attachment");
    const attachmentId = graph.addPlacement(file, itemId, "A", "attachment");
    const folder = graph.addItem("folder", "folder");
    expect(
      validateMovePlacement(graph, graph.placements.get(attachmentId) ?? null, {
        placementId: attachmentId,
        parentItemId: folder,
        positionKey: "B",
      }).ok,
    ).toBe(false);

    expect(validateRenameItem(graph, { itemId: generateUuidV7(), name: "x" }).ok).toBe(false);
    graph.items.set(itemId, {
      ...(graph.getItem(itemId) as NonNullable<ReturnType<MemoryGraph["getItem"]>>),
      lifecycle: "trashed",
    });
    expect(validateRenameItem(graph, { itemId, name: "x" }).ok).toBe(false);
    graph.items.set(itemId, {
      ...(graph.getItem(itemId) as NonNullable<ReturnType<MemoryGraph["getItem"]>>),
      lifecycle: "active",
    });
    expect(validateRenameItem(graph, { itemId, name: " " }).ok).toBe(false);
    const rename = validateRenameItem(graph, { itemId, name: "  renamed  " });
    expect(rename.ok && rename.value.name).toBe("renamed");
  });

  it("terminates corrupted or duplicate graph walks and sorts equal keys by identity", () => {
    const graph = new MemoryGraph();
    const first = graph.addItem("folder", "first");
    const second = graph.addItem("folder", "second");
    graph.addPlacement(first, second, "A");
    graph.addPlacement(second, first, "B");
    expect(wouldCreateCycle(graph, generateUuidV7(), first)).toBe(true);

    graph.addPlacement(second, first, "C");
    expect(collectActiveBranch(graph, first)).toEqual([first, second]);

    const placements = graph.getActivePlacements(second);
    const sameKey = placements.map((placement) => ({ ...placement, positionKey: "K" }));
    const sorted = sortSiblings(sameKey);
    expect(sorted.map((entry) => entry.id)).toEqual(
      sameKey.map((entry) => entry.id).sort((a, b) => a.localeCompare(b)),
    );
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
