import {
  endpointAvailability,
  generateUuidV7,
  isValidRelationType,
  validateCreateRelationship,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("relationship validation", () => {
  it("accepts stable endpoints and applies empty metadata by default", () => {
    const graph = new MemoryGraph();
    const sourceItemId = graph.addItem("page", "source");
    const targetItemId = graph.addItem("page", "target");
    const result = validateCreateRelationship(graph.getItem.bind(graph), {
      id: generateUuidV7(),
      sourceItemId,
      targetItemId,
      relationType: "link:references",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata).toEqual({});
    }
  });

  it("rejects malformed identities, vocabulary, metadata, and unavailable endpoints", () => {
    const graph = new MemoryGraph();
    const sourceItemId = graph.addItem("page", "source");
    const targetItemId = graph.addItem("page", "target");
    const purgedId = graph.addItem("page", "purged", "purged");
    const valid = {
      id: generateUuidV7(),
      sourceItemId,
      targetItemId,
      relationType: "link:references",
    };
    const cases = [
      { ...valid, id: "invalid" },
      { ...valid, relationType: "references" },
      { ...valid, relationType: `link:${"x".repeat(129)}` },
      { ...valid, sourceItemId: generateUuidV7() },
      { ...valid, sourceItemId: purgedId },
      { ...valid, targetItemId: generateUuidV7() },
      { ...valid, targetItemId: purgedId },
      { ...valid, metadata: [] },
    ];
    for (const command of cases) {
      const result = validateCreateRelationship(
        graph.getItem.bind(graph),
        command as Parameters<typeof validateCreateRelationship>[1],
      );
      expect(result.ok).toBe(false);
    }
  });

  it("reports active, trashed, and unavailable endpoints without redirection", () => {
    const graph = new MemoryGraph();
    const active = graph.addItem("page", "active");
    const trashed = graph.addItem("page", "trashed", "trashed");
    const purged = graph.addItem("page", "purged", "purged");

    expect(endpointAvailability(graph.getItem(active))).toBe("active");
    expect(endpointAvailability(graph.getItem(trashed))).toBe("trashed");
    expect(endpointAvailability(graph.getItem(purged))).toBe("unavailable");
    expect(endpointAvailability(null)).toBe("unavailable");
    expect(isValidRelationType("embed:file")).toBe(true);
  });
});
