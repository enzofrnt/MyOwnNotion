/**
 * File placement and relationship endpoint rules (T055/T065, US2/US3).
 *
 * One canonical file may be shown through many placements (FR-028/FR-029).
 * Removing a non-final placement must leave the file and every other
 * placement untouched; removing the final one must trash the file with
 * metadata sufficient to restore that placement (FR-031/FR-032). Relationship
 * endpoints are identified by stable identity and their availability stays
 * diagnosable rather than silently redirected (FR-011/FR-014).
 */

import {
  type CanonicalItem,
  endpointAvailability,
  generateUuidV7,
  isValidRelationType,
  type Placement,
  planRemoveFilePlacement,
  TRASH_RETENTION_MS,
  type Uuid,
  validateAddFilePlacement,
  validateCreateRelationship,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const now = () => NOW;

describe("validateAddFilePlacement", () => {
  it("accepts an extra hierarchy placement beneath a folder", () => {
    const graph = new MemoryGraph();
    const folder = graph.addItem("folder", "Folder");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(folder, null, "V");
    graph.addPlacement(file, null, "V");

    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: folder,
      positionKey: "W",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a hierarchy placement at the workspace root", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an attachment placement on a page", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(page, null, "V");

    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "attachment",
      parentItemId: page,
      positionKey: "V",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("attachment");
      expect(result.value.item.id).toBe(file);
    }
  });

  it("rejects an unknown file", () => {
    const result = validateAddFilePlacement(new MemoryGraph(), {
      itemId: generateUuidV7(),
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects extra placements for a page (single-membership cardinality)", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const result = validateAddFilePlacement(graph, {
      itemId: page,
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.cardinality-violation");
    }
  });

  it("rejects placements for a trashed file", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png", "trashed");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });

  it("rejects an invalid position key", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it("rejects an attachment without a parent page", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "attachment",
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.attachment-parent-must-be-page");
    }
  });

  it("rejects an attachment on a folder", () => {
    const graph = new MemoryGraph();
    const folder = graph.addItem("folder", "Folder");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(folder, null, "V");

    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "attachment",
      parentItemId: folder,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.attachment-parent-must-be-page");
    }
  });

  it("rejects an attachment on a missing page", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "attachment",
      parentItemId: generateUuidV7(),
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("rejects a hierarchy placement beneath a missing parent", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: generateUuidV7(),
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("rejects a hierarchy placement beneath another file", () => {
    const graph = new MemoryGraph();
    const parentFile = graph.addItem("file", "parent.png");
    const file = graph.addItem("file", "child.png");
    graph.addPlacement(parentFile, null, "V");

    const result = validateAddFilePlacement(graph, {
      itemId: file,
      kind: "hierarchy",
      parentItemId: parentFile,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.file-cannot-contain");
    }
  });
});

describe("planRemoveFilePlacement", () => {
  function placementOf(graph: MemoryGraph, placementId: Uuid): Placement {
    return graph.placements.get(placementId) as Placement;
  }

  it("removes only that placement while another remains active", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(page, null, "V");
    const first = graph.addPlacement(file, page, "V");
    graph.addPlacement(file, page, "W", "attachment");

    const result = planRemoveFilePlacement(graph, placementOf(graph, first), now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("placement-removed");
    }
  });

  it("trashes the file with restorable metadata when the last placement goes", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(page, null, "V");
    const only = graph.addPlacement(file, page, "V", "attachment");

    const result = planRemoveFilePlacement(graph, placementOf(graph, only), now);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "file-trashed") {
      expect(result.value.fileItemId).toBe(file);
      expect(result.value.trashedAt).toBe(NOW.toISOString());
      expect(result.value.purgeAfter).toBe(
        new Date(NOW.getTime() + TRASH_RETENTION_MS).toISOString(),
      );
      // Enough to put the file back exactly where it was (FR-032/FR-033).
      expect(result.value.restorablePlacement).toEqual({
        kind: "attachment",
        parentItemId: page,
        positionKey: "V",
      });
    } else {
      expect.unreachable("expected the file to be trashed");
    }
  });

  it("rejects a missing placement", () => {
    expect(planRemoveFilePlacement(new MemoryGraph(), null, now).ok).toBe(false);
  });

  it("rejects an already removed placement", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const placementId = graph.addPlacement(file, null, "V");
    const placement = placementOf(graph, placementId);

    const result = planRemoveFilePlacement(
      graph,
      { ...placement, removedAt: NOW.toISOString() },
      now,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.already-removed");
    }
  });

  it("rejects a placement whose item is gone", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "diagram.png");
    const placementId = graph.addPlacement(file, null, "V");
    const placement = placementOf(graph, placementId);
    graph.items.delete(file);

    const result = planRemoveFilePlacement(graph, placement, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("refuses to de-place a page: pages are trashed instead", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "Page");
    const placementId = graph.addPlacement(page, null, "V");

    const result = planRemoveFilePlacement(graph, placementOf(graph, placementId), now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.cardinality-violation");
    }
  });
});

describe("relation type vocabulary", () => {
  it.each(["link:references", "embed:file", "db.relation:row-link"])("accepts %s", (value) => {
    expect(isValidRelationType(value)).toBe(true);
  });

  it.each([
    "link", // no namespace separator
    ":references", // empty namespace
    "link:", // empty name
    "Link:References", // uppercase
    "1link:references", // must start with a letter
    `link:${"a".repeat(200)}`, // over the length limit
  ])("rejects %s", (value) => {
    expect(isValidRelationType(value)).toBe(false);
  });
});

describe("validateCreateRelationship", () => {
  const graph = new MemoryGraph();
  const source = graph.addItem("page", "Source");
  const target = graph.addItem("page", "Target");
  const getItem = (id: Uuid) => graph.getItem(id);

  it("accepts a valid typed relationship and defaults metadata", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata).toEqual({});
    }
  });

  it("preserves supplied metadata", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
      metadata: { label: "see also" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata).toEqual({ label: "see also" });
    }
  });

  it("rejects a non-UUID identifier", () => {
    const result = validateCreateRelationship(getItem, {
      id: "not-a-uuid" as Uuid,
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-identifier");
    }
  });

  it("rejects an unnamespaced relation type", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "references",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it("reserves page:link for atomic page-document reconciliation", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "page:link",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it("rejects a missing source", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: generateUuidV7(),
      targetItemId: target,
      relationType: "link:references",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("relationship.endpoint-unavailable");
    }
  });

  it("rejects a missing target", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: generateUuidV7(),
      relationType: "link:references",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("relationship.endpoint-unavailable");
    }
  });

  it("rejects a purged endpoint", () => {
    const purged = graph.addItem("page", "Purged", "purged");
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: purged,
      relationType: "link:references",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("relationship.endpoint-unavailable");
    }
  });

  it("rejects array metadata", () => {
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
      metadata: [] as unknown as Readonly<Record<string, unknown>>,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it("allows a relationship to a trashed target so the reference stays recoverable", () => {
    const trashed = graph.addItem("page", "Trashed", "trashed");
    const result = validateCreateRelationship(getItem, {
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: trashed,
      relationType: "link:references",
    });
    expect(result.ok).toBe(true);
  });
});

describe("endpointAvailability", () => {
  function item(lifecycle: CanonicalItem["lifecycle"]): CanonicalItem {
    return {
      id: generateUuidV7(),
      workspaceId: generateUuidV7(),
      kind: "page",
      name: "Endpoint",
      lifecycle,
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: generateUuidV7(),
    };
  }

  it("reports an active endpoint", () => {
    expect(endpointAvailability(item("active"))).toBe("active");
  });

  it("reports a trashed endpoint as recoverable rather than gone", () => {
    expect(endpointAvailability(item("trashed"))).toBe("trashed");
  });

  it("reports a purged endpoint as unavailable", () => {
    expect(endpointAvailability(item("purged"))).toBe("unavailable");
  });

  it("reports a missing endpoint as unavailable instead of redirecting", () => {
    expect(endpointAvailability(null)).toBe("unavailable");
  });
});
