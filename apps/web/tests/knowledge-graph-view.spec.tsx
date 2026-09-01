import { generateUuidV7 } from "@myownnotion/domain";
import type { GraphProjection } from "@myownnotion/graph";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphCanvas } from "../src/features/knowledge-graph/graph-canvas.tsx";
import { GraphInspector } from "../src/features/knowledge-graph/graph-inspector.tsx";
import { GraphList } from "../src/features/knowledge-graph/graph-list.tsx";

const id = generateUuidV7();
const projection: GraphProjection = {
  nodes: [
    {
      id,
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: "Page centrale",
      icon: "🧭",
      mediaType: null,
      parentIds: [],
      structured: {},
      incomingRelationCount: 1,
      outgoingRelationCount: 2,
      incomingOccurrenceCount: 1,
      outgoingOccurrenceCount: 2,
      depth: 0,
    },
  ],
  edges: [],
  focusId: id,
  coverage: { state: "complete", cursor: "42" },
  diagnostics: { invalidEdges: 0, invalidNodes: 0, missingEndpoints: 0, unknownRelationTypes: 0 },
  summary: {
    candidateNodeCount: 1,
    visibleNodeCount: 1,
    candidateRelationCount: 0,
    visibleRelationCount: 0,
    occurrenceCount: 0,
    componentCount: 1,
    isolatedNodeCount: 1,
  },
  truncation: { truncated: false, omittedNodes: 0, omittedEdges: 0 },
};

describe("graph representations", () => {
  it("exposes the same identity and counts in canvas and list", () => {
    const props = { projection, selectedId: id, onSelect: () => undefined };
    const canvas = renderToStaticMarkup(createElement(GraphCanvas, props));
    const list = renderToStaticMarkup(createElement(GraphList, props));
    expect(canvas).toContain(`data-graph-node="${id}"`);
    expect(list).toContain(`data-graph-node="${id}"`);
    expect(canvas).toContain("Page centrale");
    expect(list).toContain("1 entrante");
    expect(list).toContain("2 sortantes");
  });

  it("keeps lifecycle, unavailable relations and readable locations in the list and inspector", () => {
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const baseNode = projection.nodes[0];
    if (baseNode === undefined) throw new Error("The graph fixture requires its central node.");
    const nodes: GraphProjection["nodes"] = [
      {
        ...baseNode,
        id: parentId,
        name: "Dossier lisible",
        kind: "folder",
        canonicalKind: "folder",
        outgoingRelationCount: 1,
      },
      {
        ...baseNode,
        id: childId,
        name: "Page à la corbeille",
        lifecycle: "trashed",
        parentIds: [parentId],
        incomingRelationCount: 1,
        outgoingRelationCount: 0,
      },
    ];
    const edges: GraphProjection["edges"] = [
      {
        key: `${parentId}/${childId}`,
        sourceId: parentId,
        targetId: childId,
        relationType: "hierarchy:contains",
        occurrenceIds: ["placement"],
        multiplicity: 1,
        origins: ["hierarchy"],
        availability: "target-trashed",
      },
    ];
    const detailedProjection = { ...projection, nodes, edges };
    const inspectedNode = nodes[1];
    if (inspectedNode === undefined) throw new Error("The graph fixture requires its child node.");
    const list = renderToStaticMarkup(
      createElement(GraphList, {
        projection: detailedProjection,
        selectedId: childId,
        onSelect: () => undefined,
      }),
    );
    const inspector = renderToStaticMarkup(
      createElement(GraphInspector, {
        node: inspectedNode,
        nodes,
        edges,
        onOpen: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(list).toContain("Dans la corbeille");
    expect(list).toContain("Indisponible");
    expect(inspector).toContain("Emplacement : Dossier lisible");
  });
});
