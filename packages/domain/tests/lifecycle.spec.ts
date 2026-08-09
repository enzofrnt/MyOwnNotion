/**
 * Trash, restore, and purge-eligibility planning (T031, US1/US4).
 *
 * Trash plans must cover the complete active branch and remember every
 * placement needed to restore it (FR-013/FR-032). Restore plans must refuse a
 * destination that is no longer valid instead of silently relocating content,
 * and must demand an explicit owner-selected parent in that case (FR-033).
 */

import {
  type CanonicalItem,
  generateUuidV7,
  isPurgeEligible,
  planRestore,
  planTrash,
  TRASH_RETENTION_MS,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const now = () => NOW;

function trashedItem(id: Uuid, overrides: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    id,
    workspaceId: generateUuidV7(),
    kind: "page",
    name: "Trashed",
    lifecycle: "trashed",
    trashedAt: NOW.toISOString(),
    purgeAfter: new Date(NOW.getTime() + TRASH_RETENTION_MS).toISOString(),
    currentRevisionId: generateUuidV7(),
    ...overrides,
  };
}

describe("planTrash", () => {
  it("covers the whole active branch and records its placements", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("folder", "Root");
    const child = graph.addItem("folder", "Child");
    const grandchild = graph.addItem("page", "Grandchild");
    const rootPlacement = graph.addPlacement(root, null, "V");
    graph.addPlacement(child, root, "V");
    graph.addPlacement(grandchild, child, "V");

    const result = planTrash(graph, root, now);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rootItemId).toBe(root);
    expect(result.value.itemIds).toEqual([root, child, grandchild]);
    expect(result.value.trashedAt).toBe(NOW.toISOString());
    // 30-day recovery deadline.
    expect(result.value.purgeAfter).toBe(new Date("2026-09-08T12:00:00.000Z").toISOString());
    expect(result.value.placementSnapshots.length).toBe(3);
    expect(
      result.value.placementSnapshots.find((snapshot) => snapshot.placementId === rootPlacement),
    ).toMatchObject({ itemId: root, parentItemId: null, positionKey: "V" });
  });

  it("excludes an already trashed descendant from the branch", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("folder", "Root");
    const active = graph.addItem("page", "Active child");
    const alreadyTrashed = graph.addItem("page", "Trashed child", "trashed");
    graph.addPlacement(root, null, "V");
    graph.addPlacement(active, root, "V");
    graph.addPlacement(alreadyTrashed, root, "W");

    const result = planTrash(graph, root, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemIds).toEqual([root, active]);
    }
  });

  it("records every placement of a multiply placed file", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(page, null, "V");
    graph.addPlacement(file, page, "V");
    graph.addPlacement(file, page, "W", "attachment");

    const result = planTrash(graph, file, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both placements are remembered so restore can put the file back.
      expect(result.value.placementSnapshots.length).toBe(2);
      expect(result.value.placementSnapshots.map((snapshot) => snapshot.kind).sort()).toEqual([
        "attachment",
        "hierarchy",
      ]);
    }
  });

  it("rejects an unknown item", () => {
    const result = planTrash(new MemoryGraph(), generateUuidV7(), now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects an item that is not active", () => {
    const graph = new MemoryGraph();
    const item = graph.addItem("page", "Already trashed", "trashed");
    const result = planTrash(graph, item, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });
});

describe("planRestore", () => {
  it("restores into a remembered parent that is still active", () => {
    const graph = new MemoryGraph();
    const parent = graph.addItem("folder", "Parent");
    graph.addPlacement(parent, null, "V");
    const rootId = generateUuidV7();
    const placementId = generateUuidV7();

    const result = planRestore(
      graph,
      [trashedItem(rootId)],
      [{ placementId, itemId: rootId, kind: "hierarchy", parentItemId: parent, positionKey: "V" }],
      { itemId: rootId },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rootItemId).toBe(rootId);
      expect(result.value.restoredPlacements[0]?.parentItemId).toBe(parent);
    }
  });

  it("restores a root that was placed at the workspace root", () => {
    const rootId = generateUuidV7();
    const result = planRestore(
      new MemoryGraph(),
      [trashedItem(rootId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
      ],
      { itemId: rootId },
    );
    expect(result.ok).toBe(true);
  });

  it("keeps descendant placements untouched inside the branch", () => {
    const rootId = generateUuidV7();
    const childId = generateUuidV7();
    const childPlacementId = generateUuidV7();

    const result = planRestore(
      new MemoryGraph(),
      [trashedItem(rootId), trashedItem(childId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
        {
          placementId: childPlacementId,
          itemId: childId,
          kind: "hierarchy",
          parentItemId: rootId,
          positionKey: "V",
        },
      ],
      { itemId: rootId },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemIds).toEqual([rootId, childId]);
      const child = result.value.restoredPlacements.find(
        (placement) => placement.placementId === childPlacementId,
      );
      expect(child?.parentItemId).toBe(rootId);
    }
  });

  it("demands an explicit fallback when the remembered parent is gone", () => {
    const rootId = generateUuidV7();
    const result = planRestore(
      new MemoryGraph(),
      [trashedItem(rootId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: generateUuidV7(), // never existed in the view
          positionKey: "V",
        },
      ],
      { itemId: rootId },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("uses an owner-selected fallback parent when one is supplied", () => {
    const graph = new MemoryGraph();
    const fallback = graph.addItem("folder", "Fallback");
    graph.addPlacement(fallback, null, "V");
    const rootId = generateUuidV7();

    const result = planRestore(
      graph,
      [trashedItem(rootId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: generateUuidV7(),
          positionKey: "V",
        },
      ],
      { itemId: rootId, fallbackParentItemId: fallback },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.restoredPlacements[0]?.parentItemId).toBe(fallback);
    }
  });

  it("rejects a fallback parent that is not active", () => {
    const graph = new MemoryGraph();
    const trashedParent = graph.addItem("folder", "Trashed parent", "trashed");
    const rootId = generateUuidV7();

    const result = planRestore(
      graph,
      [trashedItem(rootId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
      ],
      { itemId: rootId, fallbackParentItemId: trashedParent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("rejects restoring beneath a file", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const rootId = generateUuidV7();

    const result = planRestore(
      graph,
      [trashedItem(rootId)],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
      ],
      { itemId: rootId, fallbackParentItemId: file },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.file-cannot-contain");
    }
  });

  it("rejects restoring an attachment beneath a folder", () => {
    const graph = new MemoryGraph();
    const folder = graph.addItem("folder", "Folder");
    graph.addPlacement(folder, null, "V");
    const rootId = generateUuidV7();

    const result = planRestore(
      graph,
      [trashedItem(rootId, { kind: "file" })],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "attachment",
          parentItemId: null,
          positionKey: "V",
        },
      ],
      { itemId: rootId, fallbackParentItemId: folder },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.attachment-parent-must-be-page");
    }
  });

  it("rejects a restore that would create a cycle", () => {
    const graph = new MemoryGraph();
    // The restored root is an ancestor of the chosen fallback parent.
    const rootId = graph.addItem("folder", "Root");
    const descendant = graph.addItem("folder", "Descendant");
    graph.addPlacement(rootId, null, "V");
    graph.addPlacement(descendant, rootId, "V");

    const result = planRestore(
      graph,
      [trashedItem(rootId, { kind: "folder" })],
      [
        {
          placementId: generateUuidV7(),
          itemId: rootId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        },
      ],
      { itemId: rootId, fallbackParentItemId: descendant },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.cycle-rejected");
    }
  });

  it("rejects an unknown item", () => {
    const result = planRestore(new MemoryGraph(), [], [], { itemId: generateUuidV7() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects an item that is not trashed", () => {
    const rootId = generateUuidV7();
    const result = planRestore(
      new MemoryGraph(),
      [trashedItem(rootId, { lifecycle: "active" })],
      [],
      { itemId: rootId },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-trashed");
    }
  });
});

describe("isPurgeEligible", () => {
  const deadline = new Date("2026-09-08T12:00:00.000Z");

  it("is false before the recorded deadline", () => {
    const item = trashedItem(generateUuidV7(), { purgeAfter: deadline.toISOString() });
    expect(isPurgeEligible(item, () => new Date(deadline.getTime() - 1))).toBe(false);
  });

  it("is true once the deadline is reached", () => {
    const item = trashedItem(generateUuidV7(), { purgeAfter: deadline.toISOString() });
    expect(isPurgeEligible(item, () => deadline)).toBe(true);
  });

  it("is false for an active item even with a stale deadline", () => {
    const item = trashedItem(generateUuidV7(), {
      lifecycle: "active",
      purgeAfter: deadline.toISOString(),
    });
    expect(isPurgeEligible(item, () => new Date(deadline.getTime() + 1))).toBe(false);
  });

  it("is false when no deadline was recorded", () => {
    const item = trashedItem(generateUuidV7(), { purgeAfter: null });
    expect(isPurgeEligible(item, () => deadline)).toBe(false);
  });

  it("uses the real clock when no clock is supplied", () => {
    const past = trashedItem(generateUuidV7(), { purgeAfter: "2000-01-01T00:00:00.000Z" });
    const future = trashedItem(generateUuidV7(), { purgeAfter: "2999-01-01T00:00:00.000Z" });
    expect(isPurgeEligible(past)).toBe(true);
    expect(isPurgeEligible(future)).toBe(false);
  });
});

describe("default clock", () => {
  it("planTrash stamps the current time when no clock is supplied", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("folder", "Root");
    graph.addPlacement(root, null, "V");

    const before = Date.now();
    const result = planTrash(graph, root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trashedAt = Date.parse(result.value.trashedAt);
      expect(trashedAt).toBeGreaterThanOrEqual(before);
      // The deadline is still exactly the retention window away.
      expect(Date.parse(result.value.purgeAfter) - trashedAt).toBe(TRASH_RETENTION_MS);
    }
  });
});
