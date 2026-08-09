/**
 * Hierarchy command validation and page-document envelope rules
 * (T028/T054, US1/US2).
 *
 * Complements the containment property suite by pinning each individual
 * rejection reason: unknown document formats and versions are refused rather
 * than silently stripped (FR-002/FR-003), moves validate the destination and
 * reject cycles (FR-008), and renames preserve identity while normalizing the
 * display name (FR-009/FR-010).
 */

import {
  allowsPageDocument,
  EMPTY_PAGE_DOCUMENT,
  generateUuidV7,
  type PageDocument,
  type Placement,
  SUPPORTED_PAGE_DOCUMENT_VERSION,
  type Uuid,
  validateMovePlacement,
  validatePageDocument,
  validateRenameItem,
  validateReplacePageDocument,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

function document(overrides: Partial<PageDocument> = {}): PageDocument {
  return { ...EMPTY_PAGE_DOCUMENT, ...overrides };
}

describe("validatePageDocument", () => {
  it("accepts the canonical empty envelope", () => {
    expect(validatePageDocument(EMPTY_PAGE_DOCUMENT).ok).toBe(true);
  });

  it("accepts the highest supported format version", () => {
    const result = validatePageDocument(
      document({ formatVersion: SUPPORTED_PAGE_DOCUMENT_VERSION }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown format", () => {
    const result = validatePageDocument(
      document({ format: "text/markdown" as PageDocument["format"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it.each([0, -1, 1.5, SUPPORTED_PAGE_DOCUMENT_VERSION + 1])(
    "rejects format version %s rather than silently stripping it",
    (formatVersion) => {
      const result = validatePageDocument(document({ formatVersion }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation.unknown-format-version");
      }
    },
  );

  it.each([
    ["an array", [] as unknown as PageDocument["body"]],
    ["null", null as unknown as PageDocument["body"]],
    ["a string", "body" as unknown as PageDocument["body"]],
  ])("rejects a body that is %s", (_label, body) => {
    const result = validatePageDocument(document({ body }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });
});

describe("allowsPageDocument", () => {
  it("is true only for pages", () => {
    expect(allowsPageDocument("page")).toBe(true);
    expect(allowsPageDocument("folder")).toBe(false);
    expect(allowsPageDocument("file")).toBe(false);
  });
});

describe("validateReplacePageDocument", () => {
  const graph = new MemoryGraph();
  const pageId = graph.addItem("page", "Page");
  const page = graph.getItem(pageId);

  it("accepts a replacement whose base matches the accepted head", () => {
    const result = validateReplacePageDocument(page, {
      itemId: pageId,
      baseRevisionId: page?.currentRevisionId as Uuid,
      document: document({ body: { text: "new" } }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parentRevisionId).toBe(page?.currentRevisionId);
    }
  });

  it("rejects a missing item", () => {
    const result = validateReplacePageDocument(null, {
      itemId: generateUuidV7(),
      baseRevisionId: generateUuidV7(),
      document: EMPTY_PAGE_DOCUMENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects giving a folder page content", () => {
    const folderId = graph.addItem("folder", "Folder");
    const folder = graph.getItem(folderId);
    const result = validateReplacePageDocument(folder, {
      itemId: folderId,
      baseRevisionId: folder?.currentRevisionId as Uuid,
      document: EMPTY_PAGE_DOCUMENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.wrong-kind");
    }
  });

  it("rejects editing a trashed page", () => {
    const trashedId = graph.addItem("page", "Trashed", "trashed");
    const trashed = graph.getItem(trashedId);
    const result = validateReplacePageDocument(trashed, {
      itemId: trashedId,
      baseRevisionId: trashed?.currentRevisionId as Uuid,
      document: EMPTY_PAGE_DOCUMENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });

  it("propagates an invalid document envelope", () => {
    const result = validateReplacePageDocument(page, {
      itemId: pageId,
      baseRevisionId: page?.currentRevisionId as Uuid,
      document: document({ formatVersion: 99 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.unknown-format-version");
    }
  });

  it("reports the competing head for a stale base instead of overwriting", () => {
    const result = validateReplacePageDocument(page, {
      itemId: pageId,
      baseRevisionId: generateUuidV7(), // stale
      document: EMPTY_PAGE_DOCUMENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("revision.stale-base");
      expect(result.error.competingRevisionIds).toEqual([page?.currentRevisionId]);
    }
  });
});

describe("validateMovePlacement", () => {
  function setup() {
    const graph = new MemoryGraph();
    const folder = graph.addItem("folder", "Folder");
    const page = graph.addItem("page", "Page");
    graph.addPlacement(folder, null, "V");
    const pagePlacementId = graph.addPlacement(page, null, "W");
    return {
      graph,
      folder,
      page,
      placement: graph.placements.get(pagePlacementId) as Placement,
    };
  }

  it("accepts a move into an active folder and reports the parent change", () => {
    const { graph, folder, placement } = setup();
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: folder,
      positionKey: "V",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newParentItemId).toBe(folder);
      expect(result.value.parentChanged).toBe(true);
    }
  });

  it("reports parentChanged false for a pure reorder", () => {
    const { graph, placement } = setup();
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: null,
      positionKey: "Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parentChanged).toBe(false);
      expect(result.value.newPositionKey).toBe("Z");
    }
  });

  it("rejects a missing placement", () => {
    const { graph } = setup();
    const result = validateMovePlacement(graph, null, {
      placementId: generateUuidV7(),
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.not-found");
    }
  });

  it("rejects an already removed placement", () => {
    const { graph, placement } = setup();
    const result = validateMovePlacement(
      graph,
      { ...placement, removedAt: new Date().toISOString() },
      { placementId: placement.id, parentItemId: null, positionKey: "V" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.already-removed");
    }
  });

  it("rejects a placement whose item is gone", () => {
    const { graph, page, placement } = setup();
    graph.items.delete(page);
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects moving a trashed item", () => {
    const { graph, page, placement } = setup();
    const item = graph.getItem(page);
    if (item !== null) {
      graph.items.set(page, { ...item, lifecycle: "trashed" });
    }
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: null,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });

  it("rejects an invalid position key", () => {
    const { graph, placement } = setup();
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: null,
      positionKey: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.invalid-payload");
    }
  });

  it("rejects a destination that does not exist", () => {
    const { graph, placement } = setup();
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: generateUuidV7(),
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.parent-not-found");
    }
  });

  it("rejects a trashed destination", () => {
    const { graph, placement } = setup();
    const trashedFolder = graph.addItem("folder", "Trashed", "trashed");
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: trashedFolder,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });

  it("rejects moving beneath a file", () => {
    const { graph, placement } = setup();
    const file = graph.addItem("file", "diagram.png");
    graph.addPlacement(file, null, "X");
    const result = validateMovePlacement(graph, placement, {
      placementId: placement.id,
      parentItemId: file,
      positionKey: "V",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.file-cannot-contain");
    }
  });

  it("rejects moving an item beneath its own descendant", () => {
    const graph = new MemoryGraph();
    const root = graph.addItem("folder", "Root");
    const child = graph.addItem("folder", "Child");
    const rootPlacementId = graph.addPlacement(root, null, "V");
    graph.addPlacement(child, root, "V");

    const result = validateMovePlacement(
      graph,
      graph.placements.get(rootPlacementId) as Placement,
      { placementId: rootPlacementId, parentItemId: child, positionKey: "V" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.cycle-rejected");
    }
  });
});

describe("validateRenameItem", () => {
  it("normalizes the display name while preserving identity", () => {
    const graph = new MemoryGraph();
    const itemId = graph.addItem("page", "Before");
    const before = graph.getItem(itemId);

    const result = validateRenameItem(graph, { itemId, name: "  After  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("After");
      // Identity is independent of the name (FR-009).
      expect(result.value.item.id).toBe(itemId);
      expect(result.value.item.currentRevisionId).toBe(before?.currentRevisionId);
    }
  });

  it("allows a duplicate name under the same parent", () => {
    const graph = new MemoryGraph();
    const parent = graph.addItem("folder", "Parent");
    const first = graph.addItem("page", "Same name");
    const second = graph.addItem("page", "Other");
    graph.addPlacement(parent, null, "V");
    graph.addPlacement(first, parent, "V");
    graph.addPlacement(second, parent, "W");

    const result = validateRenameItem(graph, { itemId: second, name: "Same name" });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown item", () => {
    const result = validateRenameItem(new MemoryGraph(), {
      itemId: generateUuidV7(),
      name: "Ghost",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects renaming a trashed item", () => {
    const graph = new MemoryGraph();
    const itemId = graph.addItem("page", "Trashed", "trashed");
    const result = validateRenameItem(graph, { itemId, name: "New name" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }
  });

  it("rejects a blank name", () => {
    const graph = new MemoryGraph();
    const itemId = graph.addItem("page", "Named");
    const result = validateRenameItem(graph, { itemId, name: "   " });
    expect(result.ok).toBe(false);
  });
});
