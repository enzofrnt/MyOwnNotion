/**
 * Page/folder/file type and placement cardinality property tests (T048, US2).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allowsPageDocument,
  planRemoveFilePlacement,
  validateAddFilePlacement,
  validateCreateItem,
  validateReplacePageDocument,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("content roles (FR-002..FR-006)", () => {
  it("only pages carry page documents", () => {
    expect(allowsPageDocument("page")).toBe(true);
    expect(allowsPageDocument("folder")).toBe(false);
    expect(allowsPageDocument("file")).toBe(false);
  });

  it("replacing a document on a folder or file is rejected", () => {
    const graph = new MemoryGraph();
    for (const kind of ["folder", "file"] as const) {
      const id = graph.addItem(kind, kind);
      const item = graph.getItem(id);
      const result = validateReplacePageDocument(item, {
        itemId: id,
        baseRevisionId: (item as NonNullable<typeof item>).currentRevisionId,
        document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("item.wrong-kind");
      }
    }
  });

  it("rejects unknown document format versions without stripping (FR)", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "p");
    const item = graph.getItem(page);
    const result = validateReplacePageDocument(item, {
      itemId: page,
      baseRevisionId: (item as NonNullable<typeof item>).currentRevisionId,
      document: { format: "myownnotion.document+json", formatVersion: 999, body: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation.unknown-format-version");
    }
  });

  it("direct creation is limited to pages and folders; files are imported", () => {
    const graph = new MemoryGraph();
    const result = validateCreateItem(graph, {
      id: generateUuidV7(),
      // @ts-expect-error deliberately invalid kind at runtime boundary
      kind: "file",
      name: "f",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("file placement cardinality (FR-028..FR-032)", () => {
  it("pages and folders never accept additional placements", () => {
    fc.assert(
      fc.property(fc.constantFrom("page" as const, "folder" as const), (kind) => {
        const graph = new MemoryGraph();
        const id = graph.addItem(kind, kind);
        graph.addPlacement(id, null, "V");
        const result = validateAddFilePlacement(graph, {
          itemId: id,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "W",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("placement.cardinality-violation");
        }
      }),
    );
  });

  it("files accept arbitrarily many hierarchy and attachment placements", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), (count) => {
        const graph = new MemoryGraph();
        const file = graph.addItem("file", "shared");
        const page = graph.addItem("page", "host");
        graph.addPlacement(page, null, "A");
        for (let index = 0; index < count; index += 1) {
          const attachment = index % 2 === 0;
          const result = validateAddFilePlacement(graph, {
            itemId: file,
            kind: attachment ? "attachment" : "hierarchy",
            parentItemId: attachment ? page : null,
            positionKey: `V${index.toString(36)}x`,
          });
          expect(result.ok).toBe(true);
          graph.addPlacement(
            file,
            attachment ? page : null,
            `V${index.toString(36)}x`,
            attachment ? "attachment" : "hierarchy",
          );
        }
        expect(graph.getActivePlacements(file).length).toBe(count);
      }),
      { numRuns: 20 },
    );
  });

  it("attachments require an active page parent", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "f");
    const folder = graph.addItem("folder", "d");
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

  it("removing a non-final placement removes only that placement", () => {
    const graph = new MemoryGraph();
    const file = graph.addItem("file", "f");
    const first = graph.addPlacement(file, null, "A");
    graph.addPlacement(file, null, "B");
    const placement = graph.placements.get(first) ?? null;
    const result = planRemoveFilePlacement(graph, placement);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("placement-removed");
    }
  });

  it("removing the final placement trashes the file with restorable metadata", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "host");
    graph.addPlacement(page, null, "A");
    const file = graph.addItem("file", "f");
    const only = graph.addPlacement(file, page, "B", "attachment");
    const placement = graph.placements.get(only) ?? null;
    const now = new Date("2026-08-07T12:00:00Z");
    const result = planRemoveFilePlacement(graph, placement, () => now);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "file-trashed") {
      expect(result.value.fileItemId).toBe(file);
      expect(result.value.restorablePlacement).toEqual({
        kind: "attachment",
        parentItemId: page,
        positionKey: "B",
      });
      expect(Date.parse(result.value.purgeAfter) - Date.parse(result.value.trashedAt)).toBe(
        30 * 24 * 60 * 60 * 1000,
      );
    } else {
      expect.fail("expected file-trashed effect");
    }
  });

  it("pages and folders are never de-placed through placement removal", () => {
    const graph = new MemoryGraph();
    const page = graph.addItem("page", "p");
    const placementId = graph.addPlacement(page, null, "V");
    const result = planRemoveFilePlacement(graph, graph.placements.get(placementId) ?? null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.cardinality-violation");
    }
  });

  it("property: the trash decision depends only on the remaining active placements", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (total) => {
        const graph = new MemoryGraph();
        const file = graph.addItem("file", "f");
        const placementIds: Uuid[] = [];
        for (let index = 0; index < total; index += 1) {
          placementIds.push(graph.addPlacement(file, null, `K${index.toString(36)}x`));
        }
        // Remove all but one: each is a plain placement removal.
        for (let index = 0; index < total - 1; index += 1) {
          const placement = graph.placements.get(placementIds[index] as string) ?? null;
          const result = planRemoveFilePlacement(graph, placement);
          expect(result.ok && result.value.type === "placement-removed").toBe(true);
          graph.placements.delete(placementIds[index] as string);
        }
        const last = graph.placements.get(placementIds[total - 1] as string) ?? null;
        const result = planRemoveFilePlacement(graph, last);
        expect(result.ok && result.value.type === "file-trashed").toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
