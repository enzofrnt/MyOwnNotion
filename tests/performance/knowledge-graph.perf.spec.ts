import { performance } from "node:perf_hooks";
import { buildKnowledgeGraph, type KnowledgePage } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildKnowledgeFixture } from "../fixtures/knowledge.ts";

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

describe("knowledge graph performance", () => {
  it("builds and filters 500 pages and 1,000 occurrences within one second", () => {
    const fixture = buildKnowledgeFixture(500, 1_000);
    const pages: KnowledgePage[] = fixture.pages.map((page) => ({
      ...page,
      kind: "page",
    }));
    const durations: number[] = [];
    for (let sample = 0; sample < 30; sample += 1) {
      const started = performance.now();
      const graph = buildKnowledgeGraph(pages, fixture.relationships, {
        mode: "global",
        query: sample % 2 === 0 ? "page 4" : "",
      });
      durations.push(performance.now() - started);
      expect(graph.nodes).toHaveLength(500);
      expect(graph.edges).toHaveLength(500);
    }
    const p95 = percentile(durations, 0.95);
    expect(p95, `knowledge graph p95 ${p95.toFixed(1)}ms`).toBeLessThan(1_000);
  });
});
