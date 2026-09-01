import { describe, expect, it } from "vitest";
import { normalizeGraphSource, relationshipsForNode } from "../src/index.ts";
import { edge, node, source } from "./fixtures.ts";

describe("backlinks", () => {
  it("separates directions and aggregates distinct canonical occurrences", () => {
    const a = node("A");
    const b = node("B");
    const c = node("C");
    const graph = normalizeGraphSource(
      source([a, b, c], [edge(a.id, b.id), edge(a.id, b.id), edge(c.id, b.id), edge(b.id, a.id)]),
    );

    const relations = relationshipsForNode(graph, b.id);
    expect(
      relations.backlinks.map(({ sourceId, multiplicity }) => [sourceId, multiplicity]),
    ).toEqual([
      [a.id, 2],
      [c.id, 1],
    ]);
    expect(relations.outgoing).toHaveLength(1);
    expect(relations.outgoing[0]).toMatchObject({ targetId: a.id, multiplicity: 1 });
  });

  it("deduplicates redelivery by occurrence identity but preserves reciprocal types", () => {
    const a = node("A");
    const b = node("B");
    const occurrence = edge(a.id, b.id);
    const graph = normalizeGraphSource(
      source(
        [a, b],
        [occurrence, occurrence, edge(a.id, b.id, { relationType: "database:property" })],
      ),
    );
    const relations = relationshipsForNode(graph, b.id);
    expect(relations.backlinks).toHaveLength(2);
    expect(relations.backlinks.map(({ multiplicity }) => multiplicity)).toEqual([1, 1]);
  });

  it("keeps a trashed endpoint explicit when requested", () => {
    const sourceNode = node("Source");
    const target = node("Cible", { lifecycle: "trashed" });
    const graph = normalizeGraphSource(
      source([sourceNode, target], [edge(sourceNode.id, target.id)]),
    );
    expect(relationshipsForNode(graph, sourceNode.id).outgoing).toEqual([]);
    expect(relationshipsForNode(graph, sourceNode.id, true).outgoing[0]).toMatchObject({
      availability: "target-trashed",
    });
  });
});
