import {
  canContain,
  generateUuidV7,
  validateCreateItem,
  validateMovePlacement,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("database hierarchy boundaries", () => {
  it("accepts only page and folder entries directly under a source owner", () => {
    expect(canContain("database", "page", "hierarchy")).toBe(true);
    expect(canContain("database", "folder", "hierarchy")).toBe(true);
    for (const kind of ["file", "database", "database_view"] as const) {
      expect(canContain("database", kind, "hierarchy")).toBe(false);
    }
  });

  it("keeps a linked view terminal while an entry can contain a database", () => {
    for (const kind of ["page", "folder", "database"] as const) {
      expect(canContain("database_view", kind, "hierarchy")).toBe(false);
    }
    expect(canContain("page", "database", "hierarchy")).toBe(true);
    expect(canContain("folder", "database", "hierarchy")).toBe(true);
  });

  it("validates creating page and folder entries with direct placement", () => {
    const graph = new MemoryGraph();
    const ownerId = graph.addItem("database", "Tasks");
    graph.addPlacement(ownerId, null, "V");
    for (const kind of ["page", "folder"] as const) {
      expect(
        validateCreateItem(graph, {
          id: generateUuidV7(),
          kind,
          name: kind,
          placement: { kind: "hierarchy", parentItemId: ownerId, positionKey: "V" },
        }),
      ).toMatchObject({ ok: true, value: { placement: { parentItemId: ownerId } } });
    }
  });

  it("rejects moving a database beneath another database without changing placement", () => {
    const graph = new MemoryGraph();
    const ownerId = graph.addItem("database", "Tasks");
    const otherId = graph.addItem("database", "Projects");
    graph.addPlacement(ownerId, null, "V");
    const placementId = graph.addPlacement(otherId, null, "W");
    const placement = graph.placements.get(placementId) ?? null;
    expect(
      validateMovePlacement(graph, placement, {
        placementId,
        parentItemId: ownerId,
        positionKey: "V",
      }),
    ).toMatchObject({ ok: false, error: { code: "containment.parent-not-container" } });
    expect(graph.placements.get(placementId)?.parentItemId).toBeNull();
  });
});
