import { generateUuidV7 } from "@myownnotion/domain";
import type { AggregatedGraphEdge, GraphNode } from "@myownnotion/graph";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphInspector } from "../src/features/knowledge-graph/graph-inspector.tsx";

function graphNode(name: string): GraphNode {
  return {
    id: generateUuidV7(),
    canonicalKind: "page",
    kind: "page",
    lifecycle: "active",
    name,
    icon: null,
    mediaType: null,
    parentIds: [],
    structured: {},
    incomingRelationCount: 0,
    outgoingRelationCount: 0,
    incomingOccurrenceCount: 0,
    outgoingOccurrenceCount: 0,
    depth: 0,
  };
}

describe("graph inspector", () => {
  it("separates backlinks and outgoing relations with multiplicity", () => {
    const selected = graphNode("Cible");
    const incoming = graphNode("Source");
    const outgoing = graphNode("Destination");
    const edges: AggregatedGraphEdge[] = [
      {
        key: "incoming",
        sourceId: incoming.id,
        targetId: selected.id,
        relationType: "page:link",
        occurrenceIds: ["one", "two"],
        multiplicity: 2,
        origins: ["relationship"],
        availability: "active",
      },
      {
        key: "outgoing",
        sourceId: selected.id,
        targetId: outgoing.id,
        relationType: "database:property",
        occurrenceIds: ["three"],
        multiplicity: 1,
        origins: ["relationship"],
        availability: "active",
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(GraphInspector, {
        node: selected,
        nodes: [selected, incoming, outgoing],
        edges,
        onOpen: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain("Référencé par");
    expect(markup).toContain("Pointe vers");
    expect(markup).toContain("Source");
    expect(markup).toContain("2 occurrences");
    expect(markup).toContain("Propriété reliée");
  });
});
