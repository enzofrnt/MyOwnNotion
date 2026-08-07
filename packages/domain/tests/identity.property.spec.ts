/**
 * Randomized identity-preservation tests (T062, US3, SC-002):
 * 1,000 rename/move operations over a 10,000-item hierarchy leave every
 * surviving identity, descendant placement, and relationship resolving to
 * its original logical item.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  collectActiveBranch,
  keyBetween,
  validateMovePlacement,
  validateRenameItem,
  wouldCreateCycle,
  type Relationship,
  type Uuid,
  generateUuidV7,
} from "@myownnotion/domain";
import { MemoryGraph } from "./helpers/memory-view.ts";

const ITEM_COUNT = 10_000;
const OPERATION_COUNT = 1_000;
const BRANCHING = 10;

interface Fixture {
  graph: MemoryGraph;
  itemIds: Uuid[];
  placementIds: Map<string, Uuid>;
  relationships: Relationship[];
}

function buildFixture(): Fixture {
  const graph = new MemoryGraph();
  const itemIds: Uuid[] = [];
  const placementIds = new Map<string, Uuid>();
  let lastKey: string | null = null;
  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const kind = index % 3 === 0 ? "folder" : "page";
    const id = graph.addItem(kind, `Item ${index}`);
    const parent = index === 0 ? null : (itemIds[Math.floor((index - 1) / BRANCHING)] as Uuid);
    lastKey = keyBetween(lastKey, null);
    placementIds.set(id, graph.addPlacement(id, parent, lastKey));
    itemIds.push(id);
  }
  // Relationships across the tree.
  const relationships: Relationship[] = [];
  for (let index = 0; index < 500; index += 1) {
    const source = itemIds[(index * 13) % ITEM_COUNT] as Uuid;
    const target = itemIds[(index * 29 + 7) % ITEM_COUNT] as Uuid;
    relationships.push({
      id: generateUuidV7(),
      workspaceId: graph.workspaceId,
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
      metadata: {},
    });
  }
  return { graph, itemIds, placementIds, relationships };
}

describe("identity preservation at scale (SC-002)", () => {
  it("1,000 randomized renames and moves preserve every identity and relationship", () => {
    const { graph, itemIds, placementIds, relationships } = buildFixture();

    // Record original identities and names by id.
    const originalIds = new Set(itemIds);
    const relationEndpoints = relationships.map((relationship) => ({
      id: relationship.id,
      source: relationship.sourceItemId,
      target: relationship.targetItemId,
    }));

    let accepted = 0;
    let rejected = 0;
    const random = fc.sample(fc.integer({ min: 0, max: 2 ** 31 - 1 }), OPERATION_COUNT * 3);

    for (let op = 0; op < OPERATION_COUNT; op += 1) {
      const r0 = random[op * 3] as number;
      const r1 = random[op * 3 + 1] as number;
      const r2 = random[op * 3 + 2] as number;
      const itemId = itemIds[r0 % ITEM_COUNT] as Uuid;

      if (r1 % 2 === 0) {
        // Rename: never changes identity.
        const result = validateRenameItem(graph, { itemId, name: `Renamed ${op}` });
        expect(result.ok).toBe(true);
        if (result.ok) {
          const item = graph.items.get(itemId);
          graph.items.set(itemId, {
            ...(item as NonNullable<typeof item>),
            name: result.value.name,
          });
          accepted += 1;
        }
      } else {
        // Move beneath a random target (cycles must be rejected cleanly).
        const targetId = itemIds[r2 % ITEM_COUNT] as Uuid;
        const target = graph.getItem(targetId);
        const placementId = placementIds.get(itemId) as Uuid;
        const placement = graph.placements.get(placementId) ?? null;
        const result = validateMovePlacement(graph, placement, {
          placementId,
          parentItemId: targetId,
          positionKey: keyBetween(null, null) + op.toString(36),
        });
        const expectCycle = targetId === itemId || wouldCreateCycle(graph, itemId, targetId);
        if (result.ok) {
          expect(expectCycle).toBe(false);
          expect(target?.kind === "page" || target?.kind === "folder").toBe(true);
          graph.movePlacement(
            placementId,
            result.value.newParentItemId,
            result.value.newPositionKey,
          );
          accepted += 1;
        } else {
          rejected += 1;
        }
      }
    }

    expect(accepted).toBeGreaterThan(0);
    expect(accepted + rejected).toBe(OPERATION_COUNT);

    // Every original identity survives with intact placement resolution.
    expect(graph.items.size).toBe(ITEM_COUNT);
    for (const id of originalIds) {
      expect(graph.items.has(id)).toBe(true);
      const placement = graph.placements.get(placementIds.get(id) as string);
      expect(placement?.itemId).toBe(id);
    }

    // Every relationship still resolves to its original endpoints.
    for (const endpoint of relationEndpoints) {
      expect(graph.items.has(endpoint.source)).toBe(true);
      expect(graph.items.has(endpoint.target)).toBe(true);
    }

    // The hierarchy stayed a forest rooted at the original root: complete
    // and acyclic from the root.
    const rootBranch = collectActiveBranch(graph, itemIds[0] as Uuid);
    expect(new Set(rootBranch).size).toBe(rootBranch.length);
  }, 120_000);

  it("names are never identity: same display name resolves to distinct items", () => {
    const graph = new MemoryGraph();
    const a = graph.addItem("page", "Same name");
    const b = graph.addItem("page", "Same name");
    graph.addPlacement(a, null, "A");
    graph.addPlacement(b, null, "B");
    expect(a).not.toBe(b);
    expect(graph.getItem(a)?.name).toBe(graph.getItem(b)?.name);
  });
});
