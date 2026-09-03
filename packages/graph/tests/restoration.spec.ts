import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  defaultGraphQuery,
  normalizeGraphSource,
  projectGraph,
  type RawGraphEdge,
  type RawGraphNode,
  type RawGraphSource,
} from "../src/index.ts";

function stableUuid(run: number, index: number): Uuid {
  const suffix = (run * 1_000 + index).toString(16).padStart(12, "0");
  return `00000000-0000-7000-8000-${suffix}` as Uuid;
}

function referenceSource(run: number): RawGraphSource {
  const nodes: RawGraphNode[] = Array.from({ length: 24 }, (_, index) => ({
    id: stableUuid(run, index + 1),
    canonicalKind: index % 7 === 0 ? "folder" : "page",
    kind: index % 7 === 0 ? "folder" : index % 5 === 0 ? "task" : "page",
    lifecycle: index === run % 24 ? "trashed" : "active",
    name: `Restored ${run}-${index}`,
    icon: index % 3 === 0 ? "🧭" : null,
    mediaType: null,
    parentIds: index === 0 ? [] : [stableUuid(run, 1)],
    structured: index % 5 === 0 ? { status: index % 2 === 0 ? "Done" : "Todo" } : {},
  }));
  const edges: RawGraphEdge[] = Array.from({ length: 36 }, (_, index) => {
    const source = nodes[index % nodes.length];
    const target = nodes[(index * 5 + 3) % nodes.length];
    if (source === undefined || target === undefined) {
      throw new Error("The restoration fixture must contain its reference nodes.");
    }
    return {
      id: `restore-${run}-${index}`,
      sourceId: source.id,
      targetId: target.id,
      relationType: index % 9 === 0 ? "future:semantic" : "page:link",
      origin: "relationship",
    };
  });
  return { nodes, edges, coverage: { state: "complete", cursor: `restore-${run}` } };
}

describe("knowledge graph restoration", () => {
  it("reconstructs identical identities, directions, types, availability and multiplicities for 100 reference restores", () => {
    for (let run = 1; run <= 100; run += 1) {
      const before = referenceSource(run);
      const restored = JSON.parse(JSON.stringify(before)) as RawGraphSource;
      const query = defaultGraphQuery({ kind: "workspace" });
      query.filters.lifecycle = "including-trashed";
      query.filters.includeIsolated = true;
      const expected = projectGraph(normalizeGraphSource(before), query);
      const actual = projectGraph(normalizeGraphSource(restored), query);
      expect(actual).toEqual(expected);
    }
  });
});
