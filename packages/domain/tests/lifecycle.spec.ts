import {
  type CanonicalItem,
  generateUuidV7,
  isPurgeEligible,
  planRestore,
  planTrash,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

function item(graph: MemoryGraph, id: Uuid): CanonicalItem {
  return graph.getItem(id) as CanonicalItem;
}

function trashed(itemValue: CanonicalItem, at = "2026-08-07T12:00:00.000Z"): CanonicalItem {
  return {
    ...itemValue,
    lifecycle: "trashed",
    trashedAt: at,
    purgeAfter: "2026-09-06T12:00:00.000Z",
  };
}

describe("branch trash planning", () => {
  it("rejects missing and inactive roots", () => {
    const graph = new MemoryGraph();
    expect(planTrash(graph, generateUuidV7()).ok).toBe(false);
    const inactive = graph.addItem("folder", "inactive", "trashed");
    expect(planTrash(graph, inactive).ok).toBe(false);
  });

  it("captures a complete branch, placements, and deterministic retention", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("folder", "root");
    const child = graph.addItem("page", "child");
    graph.addPlacement(root, null, "A");
    graph.addPlacement(child, root, "B");
    const now = () => new Date("2026-08-07T12:00:00.000Z");

    const result = planTrash(graph, root, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemIds).toEqual([root, child]);
      expect(result.value.placementSnapshots).toHaveLength(2);
      expect(result.value.trashedAt).toBe("2026-08-07T12:00:00.000Z");
      expect(result.value.purgeAfter).toBe("2026-09-06T12:00:00.000Z");
    }
    expect(planTrash(graph, root).ok).toBe(true);
  });
});

describe("branch restore planning", () => {
  it("rejects a missing or non-trashed root", () => {
    const graph = new MemoryGraph();
    const active = graph.addItem("page", "active");
    expect(planRestore(graph, [], [], { itemId: generateUuidV7() }).ok).toBe(false);
    expect(planRestore(graph, [item(graph, active)], [], { itemId: active }).ok).toBe(false);
  });

  it("requires an explicit fallback when the remembered parent disappeared", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("page", "root");
    const missingParent = generateUuidV7();
    const placementId = generateUuidV7();
    const result = planRestore(
      graph,
      [trashed(item(graph, root))],
      [
        {
          placementId,
          itemId: root,
          kind: "hierarchy",
          parentItemId: missingParent,
          positionKey: "A",
        },
      ],
      { itemId: root },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("rejects invalid, file, attachment-folder, and cyclic fallback targets", () => {
    const cases = ["missing", "file", "attachment", "cycle"] as const;
    for (const testCase of cases) {
      const graph = new MemoryGraph();
      const root = graph.addItem(testCase === "attachment" ? "file" : "page", "root");
      const target =
        testCase === "missing"
          ? generateUuidV7()
          : graph.addItem(testCase === "file" ? "file" : "folder", "target");
      if (testCase === "cycle") {
        graph.addPlacement(target, root, "B");
      }
      const placementId = generateUuidV7();
      const result = planRestore(
        graph,
        [trashed(item(graph, root))],
        [
          {
            placementId,
            itemId: root,
            kind: testCase === "attachment" ? "attachment" : "hierarchy",
            parentItemId: null,
            positionKey: "A",
          },
        ],
        { itemId: root, fallbackParentItemId: target },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(
          testCase === "file"
            ? "containment.file-cannot-contain"
            : testCase === "attachment"
              ? "containment.attachment-parent-must-be-page"
              : testCase === "cycle"
                ? "containment.cycle-rejected"
                : "containment.parent-not-found",
        );
      }
    }
  });

  it("restores root and descendant placements with valid remembered destinations", () => {
    const graph = new MemoryGraph();
    const parent = graph.addItem("folder", "parent");
    const root = graph.addItem("folder", "root");
    const child = graph.addItem("page", "child");
    const rootPlacement = generateUuidV7();
    const childPlacement = generateUuidV7();
    const result = planRestore(
      graph,
      [trashed(item(graph, root)), trashed(item(graph, child))],
      [
        {
          placementId: rootPlacement,
          itemId: root,
          kind: "hierarchy",
          parentItemId: parent,
          positionKey: "A",
        },
        {
          placementId: childPlacement,
          itemId: child,
          kind: "hierarchy",
          parentItemId: root,
          positionKey: "B",
        },
      ],
      { itemId: root },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemIds).toEqual([root, child]);
      expect(result.value.restoredPlacements).toHaveLength(2);
    }
  });
});

describe("purge eligibility", () => {
  it("requires trash state, a deadline, and an elapsed retention window", () => {
    const graph = new MemoryGraph();
    const active = item(graph, graph.addItem("page", "active"));
    const expired = { ...trashed(active), purgeAfter: "2026-08-07T11:59:59.000Z" };
    const now = () => new Date("2026-08-07T12:00:00.000Z");

    expect(isPurgeEligible(active, now)).toBe(false);
    expect(isPurgeEligible({ ...expired, purgeAfter: null }, now)).toBe(false);
    expect(isPurgeEligible({ ...expired, purgeAfter: "2026-08-07T12:00:01.000Z" }, now)).toBe(
      false,
    );
    expect(isPurgeEligible(expired, now)).toBe(true);
    expect(isPurgeEligible({ ...expired, purgeAfter: "2000-01-01T00:00:00.000Z" })).toBe(true);
  });
});
