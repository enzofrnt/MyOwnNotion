import {
  asUuid,
  buildKnowledgeGraph,
  type KnowledgePage,
  type KnowledgeRelationship,
  layoutKnowledgeGraph,
  summarizePageKnowledge,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const id = (suffix: number) =>
  asUuid(`01900000-0000-7000-8000-${suffix.toString().padStart(12, "0")}`);
const pages: KnowledgePage[] = [
  { id: id(1), name: "Alpha", kind: "page", lifecycle: "active" },
  { id: id(2), name: "Beta", kind: "page", lifecycle: "active" },
  { id: id(3), name: "Gamma", kind: "page", lifecycle: "active" },
  { id: id(4), name: "Trashed", kind: "page", lifecycle: "trashed" },
  { id: id(5), name: "Folder", kind: "folder", lifecycle: "active" },
  { id: id(6), name: "Isolated", kind: "page", lifecycle: "active" },
];
const relationships: KnowledgeRelationship[] = [
  { id: id(101), sourceItemId: id(1), targetItemId: id(2), relationType: "link:references" },
  { id: id(102), sourceItemId: id(1), targetItemId: id(2), relationType: "link:references" },
  { id: id(103), sourceItemId: id(2), targetItemId: id(1), relationType: "link:references" },
  { id: id(104), sourceItemId: id(2), targetItemId: id(3), relationType: "link:references" },
  { id: id(105), sourceItemId: id(3), targetItemId: id(1), relationType: "link:references" },
  { id: id(106), sourceItemId: id(1), targetItemId: id(4), relationType: "link:references" },
  { id: id(107), sourceItemId: id(1), targetItemId: id(5), relationType: "database:relation" },
  {
    id: id(108),
    sourceItemId: id(1),
    targetItemId: id(3),
    relationType: "link:references",
    removedRevisionId: id(999),
  },
];

describe("knowledge summaries", () => {
  it("aggregates directed duplicates, reciprocal links, and lifecycle status", () => {
    const alpha = summarizePageKnowledge(pages, relationships, id(1));
    expect(alpha.outgoing).toEqual([
      expect.objectContaining({ targetItemId: id(2), targetName: "Beta", occurrenceCount: 2 }),
      expect.objectContaining({
        targetItemId: id(4),
        targetName: "Trashed",
        targetAvailability: "trashed",
        occurrenceCount: 1,
      }),
    ]);
    expect(alpha.incoming).toEqual([
      expect.objectContaining({ sourceItemId: id(2), sourceName: "Beta", occurrenceCount: 1 }),
      expect.objectContaining({ sourceItemId: id(3), sourceName: "Gamma", occurrenceCount: 1 }),
    ]);
  });
});

describe("knowledge graph", () => {
  it("builds a focused local graph including connections between visible neighbors", () => {
    const graph = buildKnowledgeGraph(pages, relationships, {
      mode: "local",
      selectedItemId: id(1),
      query: "bet",
    });
    expect(graph.nodes.map((node) => node.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(graph.edges).toHaveLength(4);
    expect(graph.nodes.find((node) => node.label === "Beta")?.matchesFilter).toBe(true);
    expect(graph.nodes.find((node) => node.label === "Alpha")?.selected).toBe(true);
  });

  it("builds a global graph from active linked pages only and lays it out deterministically", () => {
    const graph = buildKnowledgeGraph(pages, relationships, { mode: "global" });
    expect(graph.nodes.map((node) => node.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(graph.nodes.some((node) => node.label === "Isolated")).toBe(false);
    expect(graph.edges).toHaveLength(4);
    expect(layoutKnowledgeGraph(graph, 600, 400)).toEqual(layoutKnowledgeGraph(graph, 600, 400));
  });

  it("handles an empty local or global graph", () => {
    expect(buildKnowledgeGraph(pages, [], { mode: "global" }).nodes).toEqual([]);
    expect(
      buildKnowledgeGraph(pages, [], { mode: "local", selectedItemId: id(1) }).nodes.map(
        (node) => node.label,
      ),
    ).toEqual(["Alpha"]);
  });

  it("aggregates the 500-page and 1,000-occurrence reference fixture exactly", () => {
    const largePages: KnowledgePage[] = Array.from({ length: 500 }, (_, index) => ({
      id: id(10_000 + index),
      name: `Scale ${index.toString().padStart(3, "0")}`,
      kind: "page" as const,
      lifecycle: "active" as const,
    }));
    const largeRelationships: KnowledgeRelationship[] = Array.from(
      { length: 1_000 },
      (_, index) => ({
        id: id(20_000 + index),
        sourceItemId: largePages[index % 500]?.id as ReturnType<typeof id>,
        targetItemId: largePages[(index * 7 + 1) % 500]?.id as ReturnType<typeof id>,
        relationType: "link:references",
      }),
    );
    const graph = buildKnowledgeGraph(largePages, largeRelationships, { mode: "global" });
    expect(graph.nodes).toHaveLength(500);
    expect(graph.edges).toHaveLength(500);
    expect(graph.edges.every((edge) => edge.occurrenceCount === 2)).toBe(true);
  });
});
