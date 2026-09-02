// @vitest-environment jsdom
import { generateUuidV7 } from "@myownnotion/domain";
import type { GraphProjection } from "@myownnotion/graph";
import { describe, expect, it } from "vitest";
import {
  graphNeighborhood,
  graphViewBox,
  paintGraphCamera,
  paintGraphLayout,
  shortGraphLabel,
} from "../src/features/knowledge-graph/graph-canvas-paint.ts";

const id = generateUuidV7();
const neighbour = generateUuidV7();

const projection: GraphProjection = {
  nodes: [
    {
      id,
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: "Centre",
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: {},
      incomingRelationCount: 0,
      outgoingRelationCount: 1,
      incomingOccurrenceCount: 0,
      outgoingOccurrenceCount: 1,
      depth: 0,
    },
    {
      id: neighbour,
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: "Voisine",
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: {},
      incomingRelationCount: 1,
      outgoingRelationCount: 0,
      incomingOccurrenceCount: 1,
      outgoingOccurrenceCount: 0,
      depth: 1,
    },
  ],
  edges: [
    {
      key: `${id}/${neighbour}`,
      sourceId: id,
      targetId: neighbour,
      relationType: "page:link",
      occurrenceIds: ["link"],
      multiplicity: 1,
      origins: ["relationship"],
      availability: "active",
    },
  ],
  focusId: id,
  coverage: { state: "complete", cursor: "1" },
  diagnostics: { invalidEdges: 0, invalidNodes: 0, missingEndpoints: 0, unknownRelationTypes: 0 },
  summary: {
    candidateNodeCount: 2,
    visibleNodeCount: 2,
    candidateRelationCount: 1,
    visibleRelationCount: 1,
    occurrenceCount: 1,
    componentCount: 1,
    isolatedNodeCount: 0,
  },
  truncation: { truncated: false, omittedNodes: 0, omittedEdges: 0 },
};

describe("graph canvas paint", () => {
  it("updates the camera and neighbourhood without replacing the SVG tree", () => {
    expect(shortGraphLabel("A very long title that should be cut")).toMatch(/…$/u);
    expect(graphViewBox(10, 20, 800, 400, 2)).toBe("10 20 400 200");
    expect(graphNeighborhood(projection, id)).toEqual(new Set([id, neighbour]));

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const edge = document.createElementNS("http://www.w3.org/2000/svg", "g");
    edge.dataset["graphEdge"] = `${id}/${neighbour}`;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    edge.append(line);
    const node = document.createElementNS("http://www.w3.org/2000/svg", "g");
    node.dataset["graphNode"] = id;
    node.setAttribute("transform", "translate(0 0)");
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    node.append(label);
    svg.append(edge, node);
    const zoom = document.createElement("output");
    paintGraphCamera(svg, zoom, 4, 8, 800, 400, 2);
    expect(svg.getAttribute("viewBox")).toBe("4 8 400 200");
    expect(zoom.textContent).toBe("200 %");
    paintGraphLayout(
      svg,
      projection,
      new Map([
        [id, { x: 12, y: 24, radius: 8 }],
        [neighbour, { x: 40, y: 48, radius: 6 }],
      ]),
      id,
      id,
      1,
    );
    expect(node.getAttribute("transform")).toBe("translate(12 24)");
    expect(node.getAttribute("data-emphasis")).toBe("active");
    expect(line.getAttribute("x1")).toBe("12");
    expect(line.getAttribute("y1")).toBe("24");
  });
});
