import type { Uuid } from "@myownnotion/domain";
import {
  defaultGraphQuery,
  layoutGraph,
  normalizeGraphSource,
  projectGraph,
  type RawGraphEdge,
  type RawGraphNode,
} from "@myownnotion/graph";
import { describe, expect, it } from "vitest";

const SCALE = 100_000;

function stableUuid(index: number): Uuid {
  return `00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}` as Uuid;
}

describe("knowledge graph reference volume", () => {
  it("projects and filters a 500-node two-level neighborhood in under one second", () => {
    const nodes: RawGraphNode[] = Array.from({ length: 500 }, (_, index) => ({
      id: stableUuid(index + 1),
      canonicalKind: "page",
      kind: index % 5 === 0 ? "task" : "page",
      lifecycle: "active",
      name: null,
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: { status: index % 2 === 0 ? "Done" : "Todo" },
    }));
    const root = nodes[0];
    if (root === undefined) throw new Error("The performance fixture requires a root node.");
    const edges: RawGraphEdge[] = nodes.slice(1).map((node, index) => ({
      id: `neighborhood-${index}`,
      sourceId: root.id,
      targetId: node.id,
      relationType: "page:link",
      origin: "relationship",
    }));
    const query = defaultGraphQuery({ kind: "neighborhood", centerId: root.id, depth: 2 });
    query.filters.structured = [{ field: "status", operator: "equals", value: "Done" }];
    query.filters.includeIsolated = true;
    const started = performance.now();
    const projection = projectGraph(
      normalizeGraphSource({
        nodes,
        edges,
        coverage: { state: "complete", cursor: "neighborhood" },
      }),
      query,
    );
    const duration = performance.now() - started;

    expect(projection.summary.candidateNodeCount).toBe(250);
    expect(projection.nodes).toHaveLength(200);
    expect(duration).toBeLessThan(1_000);
  });

  it("provides a bounded useful global projection for 100k items and 100k relations", () => {
    const nodes: RawGraphNode[] = Array.from({ length: SCALE }, (_, index) => ({
      id: stableUuid(index + 1),
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: null,
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: {},
    }));
    const edges: RawGraphEdge[] = Array.from({ length: SCALE }, (_, index) => ({
      id: `edge-${index.toString().padStart(6, "0")}`,
      sourceId: stableUuid(index + 1),
      targetId: stableUuid(((index + 1) % SCALE) + 1),
      relationType: "page:link",
      origin: "relationship",
    }));
    const started = performance.now();
    const source = normalizeGraphSource({
      nodes,
      edges,
      coverage: { state: "complete", cursor: "reference" },
    });
    const projection = projectGraph(source, defaultGraphQuery({ kind: "workspace" }));
    const duration = performance.now() - started;

    expect(projection.nodes).toHaveLength(200);
    expect(projection.summary.candidateNodeCount).toBe(SCALE);
    expect(projection.summary.candidateRelationCount).toBe(SCALE);
    expect(projection.truncation.truncated).toBe(true);
    expect(duration).toBeLessThan(2_000);
  });

  it("settles the maximum visible relation layout without blocking for 100 ms", () => {
    const nodes: RawGraphNode[] = Array.from({ length: 200 }, (_, index) => ({
      id: stableUuid(index + 1),
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: null,
      icon: null,
      mediaType: null,
      parentIds: [],
      structured: {},
    }));
    const edges: RawGraphEdge[] = Array.from({ length: 400 }, (_, index) => ({
      id: `layout-${index}`,
      sourceId: stableUuid((index % 200) + 1),
      targetId: stableUuid(((index * 17 + 31) % 200) + 1),
      relationType: "page:link",
      origin: "relationship",
    }));
    const projection = projectGraph(
      normalizeGraphSource({
        nodes,
        edges,
        coverage: { state: "complete", cursor: "layout" },
      }),
      defaultGraphQuery({ kind: "workspace" }),
    );
    const started = performance.now();
    const layout = layoutGraph(projection);
    const duration = performance.now() - started;
    expect(layout.positions).toHaveLength(200);
    expect(duration).toBeLessThan(100);
  });
});
